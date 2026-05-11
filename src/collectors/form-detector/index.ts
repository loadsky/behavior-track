import type {
  FormDetectConfig,
  FormDetectionResult,
  FieldState,
  ClickRecord,
  KeyRecord,
  TypingCadence,
  IssueCode,
} from './types';
import { ScbCodes, ShsCodes, CdpCodes, EnvCodes } from './types';
import type { EnvRiskSnapshot } from './types';
import { safeExec } from '../../utils/safe-exec';

const SCOPE = 'form_detector';

type DocObserverSub = (root: Document) => void;
// 全局共享的 DOM 变更观察器，多个 FormDetector 实例复用同一个 MutationObserver 以降低开销
let sharedDocObserver: MutationObserver | null = null;
const docObserverSubs = new Set<DocObserverSub>();

// 订阅 document 级 DOM 变更，返回取消订阅函数；最后一个订阅者取消时自动断开 observer
function subscribeDocObserver(sub: DocObserverSub): () => void {
  docObserverSubs.add(sub);
  if (!sharedDocObserver && typeof MutationObserver !== 'undefined') {
    sharedDocObserver = new MutationObserver(() => {
      for (const s of docObserverSubs) {
        safeExec(() => s(document), undefined, SCOPE);
      }
    });
    sharedDocObserver.observe(document.documentElement, { childList: true, subtree: true });
  }
  return () => {
    docObserverSubs.delete(sub);
    if (docObserverSubs.size === 0 && sharedDocObserver) {
      sharedDocObserver.disconnect();
      sharedDocObserver = null;
    }
  };
}

/**
 * 表单行为检测器：监听表单内的用户交互行为，通过多维度信号分析判断是否为自动化操作。
 * 检测维度：可疑客户端行为(SCB)、超人类速度(SHS)、CDP 鼠标指纹(CDP)、环境风险(ENV)。
 */
export class FormDetector {
  private config: FormDetectConfig;
  // 表单容器元素
  private container: HTMLElement | null = null;
  // 提交按钮等 action 元素
  private actionEl: HTMLElement | null = null;
  private destroyed = false;

  // 每个表单字段的交互状态
  private fieldStates = new Map<Element, FieldState>();
  private clickRecords: ClickRecord[] = [];
  private keyRecords: KeyRecord[] = [];
  // 最近一次鼠标移动的坐标和时间戳，用于判断点击前是否有真实鼠标轨迹
  private lastMouseMove: { x: number; y: number; t: number } | null = null;
  // IME 组合输入进行中标记，composing 期间忽略 input 事件以避免中文/日文输入误判
  private composing = false;

  private firstInputTime = 0;
  private lastInputTime = 0;
  private lastResult: FormDetectionResult | null = null;
  private analyzeScheduled = false;

  private boundHandlers: Array<{
    target: EventTarget;
    type: string;
    handler: EventListenerOrEventListenerObject;
    options?: AddEventListenerOptions;
  }> = [];

  private containerObserver: MutationObserver | null = null;
  private unsubscribeDoc: (() => void) | null = null;
  private envRisk: EnvRiskSnapshot | null = null;

  // action 按钮的点击行为统计，用于决定是否启用全局点击检测
  private actionClickState = {
    count: 0,
    // 点击落在元素正中心（±3px）
    centered: false,
    // 点击落在元素四角（±3px）
    corner: false,
    // 点击前无鼠标移动轨迹的次数
    noPrecedingMove: 0,
    // 坐标为 (0,0) 的合成点击
    zeroCoord: false,
  };

  // action 按钮有点击且存在至少一种可疑模式时，允许所有点击检测项进入分析
  private isActionClickSuspicious(): boolean {
    const s = this.actionClickState;
    return s.count >= 1 && (s.centered || s.corner || s.noPrecedingMove > 0 || s.zeroCoord);
  }

  private resetActionClickState(): void {
    this.actionClickState = { count: 0, centered: false, corner: false, noPrecedingMove: 0, zeroCoord: false };
  }

  constructor(config: FormDetectConfig) {
    this.config = config;
    if (config.envRisk) this.envRisk = config.envRisk;
    this.resolveAndBind();
  }

  // 注入环境风险快照，若已有分析结果则立即重新计算
  setEnvRisk(snapshot: EnvRiskSnapshot): void {
    this.envRisk = snapshot;
    if (this.lastResult) {
      this.analyze();
    }
  }

  // 获取当前检测信号摘要，供外部消费
  getSignals(): {
    is_suspicious_form: boolean;
    is_form_super_human: boolean;
    is_form_cdp_mouse: boolean;
    signalStrings: string[];
  } {
    if (!this.lastResult) {
      return { is_suspicious_form: false, is_form_super_human: false, is_form_cdp_mouse: false, signalStrings: [] };
    }
    const s = this.lastResult.signals;
    const strs: string[] = [];
    if (s.suspicious_client_side_behavior) strs.push('form:suspicious_behavior');
    if (s.super_human_speed) strs.push('form:super_human_speed');
    if (s.has_cdp_mouse_leak) strs.push('form:cdp_mouse_leak');
    return {
      is_suspicious_form: s.suspicious_client_side_behavior,
      is_form_super_human: s.super_human_speed,
      is_form_cdp_mouse: s.has_cdp_mouse_leak,
      signalStrings: strs,
    };
  }

  // 销毁实例，移除所有事件监听和 observer
  destroy(): void {
    this.destroyed = true;
    this.detachAll();
    if (this.containerObserver) {
      this.containerObserver.disconnect();
      this.containerObserver = null;
    }
    if (this.unsubscribeDoc) {
      this.unsubscribeDoc();
      this.unsubscribeDoc = null;
    }
    this.fieldStates.clear();
    this.clickRecords = [];
    this.keyRecords = [];
    this.lastResult = null;
    this.resetActionClickState();
  }

  // ========== DOM 解析 ==========

  // 查找容器和 action 元素并绑定事件，若容器暂不存在则通过 document observer 延迟绑定
  private resolveAndBind(): void {
    safeExec(() => {
      this.container = document.querySelector(this.config.containerSelector) as HTMLElement | null;
      this.actionEl = document.querySelector(this.config.actionSelector) as HTMLElement | null;

      if (this.container) {
        this.bindContainer(this.container);
      }

      this.observeDocument();
    }, undefined);
  }

  // 绑定容器内所有表单事件和全局事件监听，并启动容器内 DOM 变更观察
  private bindContainer(container: HTMLElement): void {
    this.scanFields();

    this.on(container, 'click', this.handleFieldClick, { passive: true });
    this.on(container, 'input', this.handleFieldInput, { passive: true });
    this.on(container, 'keydown', this.handleFieldKeydown, { passive: true });
    this.on(container, 'compositionstart', this.handleCompositionStart, { passive: true });
    this.on(container, 'compositionend', this.handleCompositionEnd, { passive: true });
    this.on(container, 'paste', this.handleFieldPaste, { passive: true });
    this.on(document, 'keydown', this.handleGlobalKeydown, { passive: true });
    this.on(document, 'keyup', this.handleGlobalKeyup, { passive: true });
    this.on(document, 'mousemove', this.handleGlobalMouseMove, { passive: true });

    if (this.actionEl) {
      this.on(this.actionEl, 'click', this.handleAction, { passive: true });
    }
    this.on(container, 'keydown', this.handleEnterSubmit, { passive: true });

    this.containerObserver = new MutationObserver(() => {
      this.scanFields();
    });
    this.containerObserver.observe(container, { childList: true, subtree: true });
  }

  // 监听 document DOM 变更，容器尚未挂载时延迟发现并绑定
  private observeDocument(): void {
    this.unsubscribeDoc = subscribeDocObserver(() => {
      if (this.destroyed) return;
      if (!this.container) {
        const c = document.querySelector(this.config.containerSelector) as HTMLElement | null;
        if (c) {
          this.container = c;
          this.actionEl = document.querySelector(this.config.actionSelector) as HTMLElement | null;
          this.bindContainer(c);
        }
      }
    });
  }

  // 扫描容器内所有表单字段，为新出现的字段初始化状态（跳过 hidden/submit/button/reset）
  private scanFields(): void {
    if (!this.container) return;
    const fields = this.container.querySelectorAll('input, textarea, select');
    fields.forEach((el) => {
      if (el.tagName === 'INPUT') {
        const inp = el as HTMLInputElement;
        if (inp.type === 'hidden' || inp.type === 'submit' || inp.type === 'button' || inp.type === 'reset') return;
      }
      if (!this.fieldStates.has(el)) {
        this.fieldStates.set(el, {
          fieldName: (el as HTMLInputElement).name || (el as HTMLInputElement).id || el.tagName,
          element: el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
          hadClick: false,
          hadInput: false,
          hadKeydown: false,
          hadPaste: false,
          inputTrusted: true,
          firstInputTime: 0,
          lastInputTime: 0,
          clickCount: 0,
          clickCentered: false,
          clickCorner: false,
          clickOffsetKey: '',
          tabPressed: false,
          totalChars: 0,
        });
      }
    });
  }

  // ========== 事件绑定/解绑 ==========

  // 注册事件监听并记录引用，destroy 时统一移除
  private on(target: EventTarget, type: string, handler: EventListener, options?: AddEventListenerOptions): void {
    target.addEventListener(type, handler, options);
    this.boundHandlers.push({ target, type, handler, options });
  }

  private detachAll(): void {
    for (const { target, type, handler, options } of this.boundHandlers) {
      if (type === '__doc_observer__' || type === '__container_observer__') {
        (handler as () => void)();
      } else {
        target.removeEventListener(type, handler, options);
      }
    }
    this.boundHandlers = [];
  }

  // ========== 事件处理 ==========

  // 字段点击处理：记录点击坐标、判断是否点击前有真实鼠标移动、检测中心/四角点击
  private handleFieldClick = (e: Event): void => {
    const me = e as MouseEvent;
    const target = e.target as Element;
    const state = this.fieldStates.get(target);

    const rect = target.getBoundingClientRect();
    // 50px: 鼠标移动到点击位置的容许偏差; 200ms: 移动与点击的最大时间差
    const hadMove = this.lastMouseMove !== null &&
      Math.abs(this.lastMouseMove.x - me.clientX) < 50 &&
      Math.abs(this.lastMouseMove.y - me.clientY) < 50 &&
      (performance.now() - this.lastMouseMove.t) < 200;

    const record: ClickRecord = {
      x: me.clientX,
      y: me.clientY,
      t: Date.now(),
      isTrusted: me.isTrusted,
      offsetX: me.offsetX,
      offsetY: me.offsetY,
      pageX: me.pageX,
      pageY: me.pageY,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      target: (target as HTMLElement).tagName,
      hadPrecedingMove: hadMove,
    };

    this.clickRecords.push(record);
    // 最多保留 100 条点击记录，防止长时间运行导致内存增长
    if (this.clickRecords.length > 100) {
      this.clickRecords.splice(0, this.clickRecords.length - 100);
    }

    if (state) {
      state.hadClick = true;
      state.clickCount++;

      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = Math.abs(me.clientX - cx);
      const dy = Math.abs(me.clientY - cy);

      // 3px: 点击距元素中心的容许误差，真实用户几乎不会精确点中中心
      if (dx <= 3 && dy <= 3) state.clickCentered = true;

      // 3px: 点击距元素四角的容许误差，自动化工具常使用角落坐标
      const cornerThreshold = 3;
      const nearTL = me.clientX <= rect.left + cornerThreshold && me.clientY <= rect.top + cornerThreshold;
      const nearTR = me.clientX >= rect.right - cornerThreshold && me.clientY <= rect.top + cornerThreshold;
      const nearBL = me.clientX <= rect.left + cornerThreshold && me.clientY >= rect.bottom - cornerThreshold;
      const nearBR = me.clientX >= rect.right - cornerThreshold && me.clientY >= rect.bottom - cornerThreshold;
      if (nearTL || nearTR || nearBL || nearBR) state.clickCorner = true;

      state.clickOffsetKey = `${Math.round(dx)},${Math.round(dy)}`;
    }
  };

  // 字段输入处理：跟踪首次/末次输入时间、isTrusted 状态、字符数；忽略 IME composing 阶段
  private handleFieldInput = (e: Event): void => {
    const target = e.target as HTMLInputElement | HTMLTextAreaElement;
    const state = this.fieldStates.get(target);
    if (!state) return;

    const ie = e as InputEvent;
    if (this.composing || ie.isComposing) return;

    const now = performance.now();

    if (!state.hadInput) {
      state.hadInput = true;
      state.inputTrusted = e.isTrusted;
      state.firstInputTime = now;
      if (this.firstInputTime === 0) this.firstInputTime = now;
    } else if (!e.isTrusted) {
      state.inputTrusted = false;
    }

    state.lastInputTime = now;
    this.lastInputTime = now;
    state.totalChars = target.value?.length ?? 0;
  };

  private handleFieldKeydown = (e: Event): void => {
    const ke = e as KeyboardEvent;
    const target = e.target as Element;
    const state = this.fieldStates.get(target);

    if (state) {
      state.hadKeydown = true;
      if (ke.key === 'Tab') state.tabPressed = true;
    }
  };

  private handleCompositionStart = (): void => {
    this.composing = true;
  };

  private handleCompositionEnd = (): void => {
    this.composing = false;
  };

  private handleFieldPaste = (e: Event): void => {
    const target = e.target as Element;
    const state = this.fieldStates.get(target);
    if (state) state.hadPaste = true;
  };

  // 全局键盘按下：记录按键时序用于节奏分析；keyCode 229 为 IME 合成键需跳过
  private handleGlobalKeydown = (e: Event): void => {
    const ke = e as KeyboardEvent;
    if (this.composing || ke.isComposing || ke.keyCode === 229) return;
    this.keyRecords.push({ t: Date.now(), isTrusted: ke.isTrusted, key: ke.key, hadKeyup: false });
    // 最多保留 300 条按键记录
    if (this.keyRecords.length > 300) {
      this.keyRecords.splice(0, this.keyRecords.length - 300);
    }
  };

  // 全局键盘抬起：反向查找对应 keydown 记录并标记，用于检测孤立 keydown（自动化常只发 keydown 不发 keyup）
  private handleGlobalKeyup = (e: Event): void => {
    const ke = e as KeyboardEvent;
    for (let i = this.keyRecords.length - 1; i >= 0; i--) {
      const r = this.keyRecords[i];
      if (r.key === ke.key && !r.hadKeyup) {
        r.hadKeyup = true;
        break;
      }
    }
  };

  private handleGlobalMouseMove = (e: Event): void => {
    const me = e as MouseEvent;
    this.lastMouseMove = { x: me.clientX, y: me.clientY, t: performance.now() };
  };

  // action 按钮点击处理：统计点击特征并触发分析
  private handleAction = (e: Event): void => {
    this.resetActionClickState();

    const me = e as MouseEvent;
    const target = e.target as Element;
    const rect = target.getBoundingClientRect();

    const hadMove = this.lastMouseMove !== null &&
      Math.abs(this.lastMouseMove.x - me.clientX) < 50 &&
      Math.abs(this.lastMouseMove.y - me.clientY) < 50 &&
      (performance.now() - this.lastMouseMove.t) < 200;

    const record: ClickRecord = {
      x: me.clientX,
      y: me.clientY,
      t: Date.now(),
      isTrusted: me.isTrusted,
      offsetX: me.offsetX,
      offsetY: me.offsetY,
      pageX: me.pageX,
      pageY: me.pageY,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      target: (target as HTMLElement).tagName,
      hadPrecedingMove: hadMove,
    };

    this.clickRecords.push(record);
    if (this.clickRecords.length > 100) {
      this.clickRecords.splice(0, this.clickRecords.length - 100);
    }

    this.actionClickState.count++;

    if (!hadMove && !me.isTrusted) this.actionClickState.noPrecedingMove++;
    if (me.clientX === 0 && me.clientY === 0 && !me.isTrusted) this.actionClickState.zeroCoord = true;

    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = Math.abs(me.clientX - cx);
    const dy = Math.abs(me.clientY - cy);

    if (dx <= 3 && dy <= 3) this.actionClickState.centered = true;

    const cornerThreshold = 3;
    const nearTL = me.clientX <= rect.left + cornerThreshold && me.clientY <= rect.top + cornerThreshold;
    const nearTR = me.clientX >= rect.right - cornerThreshold && me.clientY <= rect.top + cornerThreshold;
    const nearBL = me.clientX <= rect.left + cornerThreshold && me.clientY >= rect.bottom - cornerThreshold;
    const nearBR = me.clientX >= rect.right - cornerThreshold && me.clientY >= rect.bottom - cornerThreshold;
    if (nearTL || nearTR || nearBL || nearBR) this.actionClickState.corner = true;

    this.scheduleAnalyze();
  };

  // 表单内 Enter 键提交处理，排除 Shift/Ctrl/Meta 组合键
  private handleEnterSubmit = (e: Event): void => {
    const ke = e as KeyboardEvent;
    if (ke.key === 'Enter' && !ke.shiftKey && !ke.ctrlKey && !ke.metaKey) {
      const target = e.target as Element;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        this.scheduleAnalyze();
      }
    }
  };

  // 调度分析任务，优先使用 requestIdleCallback 避免阻塞主线程，200ms 超时兜底
  private scheduleAnalyze(): void {
    if (this.destroyed || this.analyzeScheduled) return;
    this.analyzeScheduled = true;
    const run = () => {
      this.analyzeScheduled = false;
      this.analyze();
    };
    const ric = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
    if (typeof ric === 'function') {
      ric(run, { timeout: 200 });
    } else {
      setTimeout(run, 0);
    }
  }

  // ========== 分析入口 ==========

  // 核心分析入口：汇总三类信号，结合环境风险计算综合风险分
  private analyze(): void {
    if (this.destroyed) return;

    this.scanFields();

    for (const [el, state] of this.fieldStates) {
      const input = el as HTMLInputElement | HTMLTextAreaElement;
      state.totalChars = input.value?.length ?? 0;
    }

    const scb = this.analyzeSuspiciousBehavior();
    const shs = this.analyzeSuperHumanSpeed();
    const cdpm = this.analyzeCDPMouseLeak();

    const formIssues = this.collectIssues();
    const envIssues = this.collectEnvIssues();
    const issues = [...formIssues, ...envIssues];

    // 各信号权重：SCB(40) > SHS(35) > CDP(25)，按权重降序排列
    const formSignals: { weight: number }[] = [];
    if (scb) formSignals.push({ weight: 40 });
    if (shs) formSignals.push({ weight: 35 });
    if (cdpm) formSignals.push({ weight: 25 });
    formSignals.sort((a, b) => b.weight - a.weight);

    // 基础分 = 环境风险分，每增加一个信号按 0.6 衰减叠加（避免多信号简单相加超 100）
    let riskScore = this.envRisk?.risk_score ?? 0;
    for (let i = 0; i < formSignals.length; i++) {
      riskScore += formSignals[i].weight * Math.pow(0.6, i);
    }
    riskScore = Math.min(Math.round(riskScore), 100);

    const result: FormDetectionResult = {
      // 40 分为风险阈值，低于此值视为通过
      is_pass: riskScore < 40,
      risk_score: riskScore,
      signals: {
        suspicious_client_side_behavior: scb,
        super_human_speed: shs,
        has_cdp_mouse_leak: cdpm,
      },
      issues,
      timestamp: Date.now(),
    };

    this.lastResult = result;

    safeExec(() => {
      this.config.onResult(result);
    }, undefined, SCOPE);
  }

  // ----- suspiciousClientSideBehavior -----

  private _scbCodes: IssueCode[] = [];

  /**
   * 可疑客户端行为检测，需命中 >=2 项才判定为可疑：
   * 1. 有值但无键盘事件
   * 2. 中心/四角点击比例过高
   * 3. 不同元素点击偏移一致
   * 4. 点击前无鼠标移动
   * 5. 多字段无 Tab/点击切换
   * 6. 并行填充
   * 7. 存在两个以上非受信事件
   */
  private analyzeSuspiciousBehavior(): boolean {
    this._scbCodes = [];
    const checks: boolean[] = [];

    // 1. 有值但无键盘事件（排除浏览器自动填充和粘贴）
    const noKbdFields: string[] = [];
    for (const [, state] of this.fieldStates) {
      if (state.hadInput && !state.hadKeydown && !state.inputTrusted && !state.hadPaste && state.totalChars > 0) {
        noKbdFields.push(state.fieldName);
      }
    }
    if (noKbdFields.length > 0) {
      this._scbCodes.push(ScbCodes.NO_KEYBOARD_BUT_VALUE);
      checks.push(true);
    }

    // 2. 点击在正中/四角比例过高
    if (this.isActionClickSuspicious()) {
      let centerOrCornerClicks = 0;
      let totalClicks = 0;
      if (this.actionClickState.count > 0) {
        totalClicks += this.actionClickState.count;
        if (this.actionClickState.centered || this.actionClickState.corner) {
          centerOrCornerClicks += this.actionClickState.count;
        }
      }
      for (const [, state] of this.fieldStates) {
        if (state.clickCount > 0) {
          totalClicks += state.clickCount;
          if (state.clickCentered || state.clickCorner) centerOrCornerClicks += state.clickCount;
        }
      }
      // 2/3: 中心/四角点击占比阈值，>=2 次点击中超过 2/3 命中则可疑
      if (totalClicks >= 2 && centerOrCornerClicks / totalClicks > 2 / 3) {
        this._scbCodes.push(ScbCodes.CENTER_CORNER_CLICK);
        checks.push(true);
      }
    }

    // 3. 不同元素的点击偏移一致
    if (this.isActionClickSuspicious()) {
      const offsetKeys = new Set<string>();
      for (const [, state] of this.fieldStates) {
        if (state.clickOffsetKey) offsetKeys.add(state.clickOffsetKey);
      }
      if (offsetKeys.size === 1 && this.fieldStates.size >= 2) {
        this._scbCodes.push(ScbCodes.SAME_CLICK_OFFSET);
        checks.push(true);
      }
    }

    // 4. 点击前无鼠标移动
    if (this.isActionClickSuspicious()) {
      const noPrecedingMove = this.clickRecords.filter(r => !r.hadPrecedingMove && !r.isTrusted).length;
      // >=3 次点击中超过半数无前置鼠标移动，说明可能是程序合成点击
      if (this.clickRecords.length >= 3 && noPrecedingMove / this.clickRecords.length > 0.5) {
        this._scbCodes.push(ScbCodes.NO_MOUSE_BEFORE_CLICK);
        checks.push(true);
      }
    }

    // 5. 多字段无 Tab 且无鼠标点击切换（仅非可信 input 视为可疑）
    const fieldsWithInput: FieldState[] = [];
    for (const [, state] of this.fieldStates) {
      if (state.hadInput && state.totalChars > 0) fieldsWithInput.push(state);
    }
    const untrustedFields = fieldsWithInput.filter(s => !s.inputTrusted);
    if (untrustedFields.length >= 2) {
      let hasTabOrClick = false;
      for (const s of untrustedFields) {
        if (s.tabPressed || s.hadClick) hasTabOrClick = true;
      }
      if (!hasTabOrClick) {
        this._scbCodes.push(ScbCodes.NO_TAB_NO_CLICK_SWITCH);
        checks.push(true);
      }
    }

    // 6. 并行填充（仅非可信 input 视为可疑）
    const untrustedInputTimes = fieldsWithInput
      .filter(s => !s.inputTrusted)
      .map(s => s.firstInputTime)
      .filter(t => t > 0)
      .sort((a, b) => a - b);
    // 100ms: 两个字段首次输入间隔 <100ms 说明近乎同时填充，非人类操作
    if (untrustedInputTimes.length >= 2) {
      const minInterval = untrustedInputTimes[1] - untrustedInputTimes[0];
      if (minInterval < 100) {
        this._scbCodes.push(ScbCodes.PARALLEL_FILL);
        checks.push(true);
      }
    }

    // 7. 存在两个以上非受信事件
    if (this.isActionClickSuspicious()) {
      const trustedClicks = this.clickRecords.filter(r => r.isTrusted).length;
      if (trustedClicks === 0 && this.clickRecords.length >= 2) {
        this._scbCodes.push(ScbCodes.UNTRUSTED_EVENTS);
        checks.push(true);
      }
    }

    // 需命中 >=2 项才判定
    return checks.length >= 2;
  }

  /**
   * 超人类速度检测，需命中 >=2 项才判定：
   * 1. 批量赋值（填充时长为 0）  2. 打字速度 >20 字符/秒
   * 3. 按键间隔变异系数 <0.1（机器般均匀）  4. 孤立 keydown >=5 次
   */
  private _shsCodes: IssueCode[] = [];

  private analyzeSuperHumanSpeed(): boolean {
    this._shsCodes = [];
    const checks: boolean[] = [];

    const fieldsWithInput: FieldState[] = [];
    let totalChars = 0;
    let pasteChars = 0;
    for (const [, state] of this.fieldStates) {
      if (state.hadInput && state.totalChars > 0) {
        fieldsWithInput.push(state);
        if (state.hadPaste) {
          pasteChars += state.totalChars;
        } else {
          totalChars += state.totalChars;
        }
      }
    }

    if (fieldsWithInput.length === 0) return false;

    const fillDuration = this.lastInputTime - this.firstInputTime;

    // 1. 极速填写（批量赋值；排除纯粘贴场景）
    const untrustedInputCount = fieldsWithInput.filter(s => !s.inputTrusted && !s.hadPaste).length;
    if (fillDuration === 0 && totalChars > 0 && untrustedInputCount > 0) {
      this._shsCodes.push(ShsCodes.BATCH_ASSIGN);
      checks.push(true);
    }

    // 2. 打字速度超人类（粘贴字段字符不计入）
    if (fillDuration > 0) {
      const cps = totalChars / (fillDuration / 1000);
      // 20 字符/秒: 人类极限打字速度约 12-15 cps，超过 20 cps 几乎不可能
      if (cps > 20) {
        this._shsCodes.push(ShsCodes.TYPING_TOO_FAST);
        checks.push(true);
      }
    }

    // 3. 按键间隔均匀度
    const cadence = this.buildTypingCadence();
    // CV(变异系数) <0.1 表示按键间隔极度均匀，人类打字自然抖动 CV 通常 >0.2
    if (cadence.totalKeys > 10 && cadence.intervalCV < 0.1) {
      this._shsCodes.push(ShsCodes.UNIFORM_INTERVALS);
      checks.push(true);
    }

    // 4. 孤立 keydown（阈值 >=5，避免 IME/修饰键/快速提交误报）
    // 阈值 >=5: 少量孤立 keydown 可能由 IME/修饰键/快速提交产生，>=5 才有统计意义
    if (cadence.orphanKeydowns >= 5) {
      this._shsCodes.push(ShsCodes.ORPHAN_KEYDOWN);
      checks.push(true);
    }

    return checks.length >= 2;
  }

  // ----- hasCDPMouseLeak -----

  /**
   * CDP 鼠标指纹检测：识别 Chrome DevTools Protocol 注入的合成鼠标事件。
   * 零坐标点击直接判定；其余需命中 >=2 项：整数坐标比例、坐标不一致、offset 异常、untrusted 事件。
   */
  private _cdpCodes: IssueCode[] = [];

  private analyzeCDPMouseLeak(): boolean {
    this._cdpCodes = [];
    if (this.clickRecords.length === 0) return false;
    if (!this.isActionClickSuspicious()) return false;

    const checks: boolean[] = [];

    // 1. 零坐标点击
    const zeroClicks = this.clickRecords.filter(r => r.x === 0 && r.y === 0 && !r.isTrusted);
    if (zeroClicks.length > 0) {
      this._cdpCodes.push(CdpCodes.ZERO_COORD_CLICK);
      return true;
    }

    // 2. 整数坐标比例（非 Retina 屏幕真实鼠标也产整数坐标；需多组不同坐标排除重复点击同一位置）
    const intCoords = this.clickRecords.filter(r => r.x === Math.floor(r.x) && r.y === Math.floor(r.y));
    const uniqueIntCoords = new Set(intCoords.map(r => `${r.x},${r.y}`));
    // 95%: 非 Retina 屏幕真实鼠标也可能产生整数坐标，需同时满足 >=3 个不同坐标排除重复点击
    if (this.clickRecords.length >= 5 && intCoords.length / this.clickRecords.length > 0.95 && uniqueIntCoords.size >= 3) {
      this._cdpCodes.push(CdpCodes.INTEGER_COORDS);
      checks.push(true);
    }

    // 3. clientX/Y vs pageX/Y 不一致（使用点击时捕获的 scroll 值）
    // clientX/Y + scrollX/Y 应等于 pageX/Y，差值 >1px 说明坐标可能是合成的
    const inconsistent = this.clickRecords.filter(r => {
      const dx = Math.abs(r.pageX - r.x - r.scrollX);
      const dy = Math.abs(r.pageY - r.y - r.scrollY);
      return dx > 1 || dy > 1;
    });
    if (inconsistent.length > 0) {
      this._cdpCodes.push(CdpCodes.COORD_INCONSISTENT);
      checks.push(true);
    }

    // 4. offsetX/Y 异常
    // offsetX/Y 为 0 但 clientX/Y >10 说明 offset 未被正确计算（CDP dispatchMouseEvent 的特征）
    let offsetMismatch = 0;
    for (const r of this.clickRecords) {
      if (r.offsetX === 0 && r.offsetY === 0 && r.x > 10 && r.y > 10) {
        offsetMismatch++;
      }
    }
    if (offsetMismatch > 0 && offsetMismatch / this.clickRecords.length > 0.3) {
      this._cdpCodes.push(CdpCodes.OFFSET_ANOMALY);
      checks.push(true);
    }

    // 5. isTrusted: false
    const untrustedClicks = this.clickRecords.filter(r => !r.isTrusted);
    if (untrustedClicks.length > 0 && untrustedClicks.length / this.clickRecords.length > 0.3) {
      checks.push(true);
    }

    return checks.length >= 2;
  }

  // ========== 辅助 ==========

  /**
   * 构建打字节奏统计：计算按键间隔均值、变异系数(CV)、untrusted 按键数和孤立 keydown 数。
   * CV = 标准差/均值，值越小表示间隔越均匀。
   */
  private buildTypingCadence(): TypingCadence {
    const keydowns = this.keyRecords;
    if (keydowns.length < 2) {
      return { intervals: [], intervalAvg: 0, intervalCV: 0, totalKeys: keydowns.length, untrustedKeys: 0, orphanKeydowns: 0 };
    }

    const intervals: number[] = [];
    for (let i = 1; i < keydowns.length; i++) {
      const gap = keydowns[i].t - keydowns[i - 1].t;
      // 2000ms: 超过 2 秒的间隔视为停顿/切换，不纳入打字节奏计算
      if (gap > 0 && gap < 2000) intervals.push(gap);
    }

    let avg = 0;
    let cv = 0;
    if (intervals.length > 0) {
      avg = intervals.reduce((s, v) => s + v, 0) / intervals.length;
      if (avg > 0) {
        const std = Math.sqrt(intervals.reduce((s, v) => s + (v - avg) ** 2, 0) / intervals.length);
        cv = std / avg;
      }
    }

    const untrustedKeys = keydowns.filter(r => !r.isTrusted).length;
    const orphanKeydowns = keydowns.filter(r => !r.hadKeyup).length;

    return { intervals, intervalAvg: avg, intervalCV: cv, totalKeys: keydowns.length, untrustedKeys, orphanKeydowns };
  }

  // 汇总表单维度的所有 issue code
  private collectIssues(): IssueCode[] {
    const issues: IssueCode[] = [];
    issues.push(...this._scbCodes);
    issues.push(...this._shsCodes);
    issues.push(...this._cdpCodes);
    return issues;
  }

  // 将环境风险快照转换为对应的 issue code 列表
  private collectEnvIssues(): IssueCode[] {
    const issues: IssueCode[] = [];
    if (!this.envRisk) return issues;
    if (this.envRisk.is_cdp) issues.push(EnvCodes.ENV_CDP_DETECTED);
    if (this.envRisk.is_devtools_open) issues.push(EnvCodes.ENV_DEVTOOLS_OPEN);
    if (this.envRisk.is_webdriver) issues.push(EnvCodes.ENV_WEBDRIVER);
    if (this.envRisk.is_headless) issues.push(EnvCodes.ENV_HEADLESS);
    if (this.envRisk.worker_cdp) issues.push(EnvCodes.ENV_WORKER_CDP);
    if (this.envRisk.is_tampered) issues.push(EnvCodes.ENV_TAMPERED);
    if (!this.envRisk.ua_consistent) issues.push(EnvCodes.ENV_UA_INCONSISTENT);
    return issues;
  }
}
