import type {
  FormDetectConfig,
  FormDetectionResult,
  FieldState,
  ClickRecord,
  KeyRecord,
  TypingCadence,
  IssueCode,
} from './types';
import { ScbCodes, ShsCodes, CdpCodes } from './types';
import { safeExec } from '../../utils/safe-exec';

export class FormDetector {
  private config: FormDetectConfig;
  private container: HTMLElement | null = null;
  private actionEl: HTMLElement | null = null;
  private destroyed = false;

  private fieldStates = new Map<Element, FieldState>();
  private clickRecords: ClickRecord[] = [];
  private keyRecords: KeyRecord[] = [];
  private lastMouseMove: { x: number; y: number; t: number } | null = null;

  private firstInputTime = 0;
  private lastInputTime = 0;
  private lastResult: FormDetectionResult | null = null;

  private boundHandlers: Array<{
    target: EventTarget;
    type: string;
    handler: EventListenerOrEventListenerObject;
    options?: AddEventListenerOptions;
  }> = [];

  private containerObserver: MutationObserver | null = null;

  constructor(config: FormDetectConfig) {
    this.config = config;
    this.resolveAndBind();
  }

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
    if (s.suspicious_client_side_behavior) strs.push('form_suspicious_behavior');
    if (s.super_human_speed) strs.push('form_super_human_speed');
    if (s.has_cdp_mouse_leak) strs.push('form_cdp_mouse_leak');
    for (const issue of this.lastResult.issues) {
      strs.push(`form:${issue}`);
    }
    return {
      is_suspicious_form: s.suspicious_client_side_behavior,
      is_form_super_human: s.super_human_speed,
      is_form_cdp_mouse: s.has_cdp_mouse_leak,
      signalStrings: strs,
    };
  }

  destroy(): void {
    this.destroyed = true;
    this.detachAll();
    if (this.containerObserver) {
      this.containerObserver.disconnect();
      this.containerObserver = null;
    }
    this.fieldStates.clear();
    this.clickRecords = [];
    this.keyRecords = [];
    this.lastResult = null;
  }

  // ========== DOM 解析 ==========

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

  private bindContainer(container: HTMLElement): void {
    this.scanFields();

    this.on(container, 'focusin', this.handleFieldFocus);
    this.on(container, 'click', this.handleFieldClick);
    this.on(container, 'input', this.handleFieldInput);
    this.on(container, 'keydown', this.handleFieldKeydown);
    this.on(container, 'keyup', this.handleFieldKeyup);
    this.on(container, 'mousemove', this.handleMouseMove);
    this.on(document, 'keydown', this.handleGlobalKeydown);
    this.on(document, 'keyup', this.handleGlobalKeyup);
    this.on(document, 'mousemove', this.handleGlobalMouseMove);

    if (this.actionEl) {
      this.on(this.actionEl, 'click', this.handleAction);
    }
    this.on(container, 'keydown', this.handleEnterSubmit);

    this.containerObserver = new MutationObserver(() => {
      this.scanFields();
    });
    this.containerObserver.observe(container, { childList: true, subtree: true });
  }

  private observeDocument(): void {
    const docObserver = new MutationObserver(() => {
      if (this.destroyed) {
        docObserver.disconnect();
        return;
      }
      if (!this.container) {
        const c = document.querySelector(this.config.containerSelector) as HTMLElement | null;
        if (c) {
          this.container = c;
          this.actionEl = document.querySelector(this.config.actionSelector) as HTMLElement | null;
          this.bindContainer(c);
        }
      }
    });
    docObserver.observe(document.documentElement, { childList: true, subtree: true });

    this.boundHandlers.push({
      target: document.documentElement,
      type: '__doc_observer__',
      handler: () => docObserver.disconnect(),
    });
  }

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
          hadFocus: false,
          hadClick: false,
          hadInput: false,
          hadKeydown: false,
          hadKeyup: false,
          firstInputTime: 0,
          lastInputTime: 0,
          clickCount: 0,
          clickCentered: false,
          clickCorner: false,
          clickOffsetKey: '',
          tabPressed: false,
          modifierUsed: false,
          totalChars: 0,
        });
      }
    });
  }

  // ========== 事件绑定/解绑 ==========

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

  private handleFieldFocus = (_e: Event): void => {
  };

  private handleFieldClick = (e: Event): void => {
    const me = e as MouseEvent;
    const target = e.target as Element;
    const state = this.fieldStates.get(target);

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

    if (state) {
      state.hadClick = true;
      state.clickCount++;

      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = Math.abs(me.clientX - cx);
      const dy = Math.abs(me.clientY - cy);

      if (dx <= 3 && dy <= 3) state.clickCentered = true;

      const cornerThreshold = 3;
      const nearTL = me.clientX <= rect.left + cornerThreshold && me.clientY <= rect.top + cornerThreshold;
      const nearTR = me.clientX >= rect.right - cornerThreshold && me.clientY <= rect.top + cornerThreshold;
      const nearBL = me.clientX <= rect.left + cornerThreshold && me.clientY >= rect.bottom - cornerThreshold;
      const nearBR = me.clientX >= rect.right - cornerThreshold && me.clientY >= rect.bottom - cornerThreshold;
      if (nearTL || nearTR || nearBL || nearBR) state.clickCorner = true;

      state.clickOffsetKey = `${Math.round(dx)},${Math.round(dy)}`;
    }
  };

  private handleFieldInput = (e: Event): void => {
    const target = e.target as HTMLInputElement | HTMLTextAreaElement;
    const state = this.fieldStates.get(target);
    if (!state) return;

    const now = performance.now();

    if (!state.hadInput) {
      state.hadInput = true;
      state.firstInputTime = now;
      if (this.firstInputTime === 0) this.firstInputTime = now;
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
      if (ke.shiftKey || ke.altKey || ke.ctrlKey || ke.metaKey) state.modifierUsed = true;
    }
  };

  private handleFieldKeyup = (e: Event): void => {
    const target = e.target as Element;
    const state = this.fieldStates.get(target);
    if (state) state.hadKeyup = true;
  };

  private handleGlobalKeydown = (e: Event): void => {
    const ke = e as KeyboardEvent;
    this.keyRecords.push({ t: Date.now(), isTrusted: ke.isTrusted, key: ke.key, hadKeyup: false });
    if (this.keyRecords.length > 300) {
      this.keyRecords.splice(0, this.keyRecords.length - 300);
    }
  };

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

  private handleMouseMove = (_e: Event): void => {
  };

  private handleGlobalMouseMove = (e: Event): void => {
    const me = e as MouseEvent;
    this.lastMouseMove = { x: me.clientX, y: me.clientY, t: performance.now() };
  };

  private handleAction = (): void => {
    this.analyze();
  };

  private handleEnterSubmit = (e: Event): void => {
    const ke = e as KeyboardEvent;
    if (ke.key === 'Enter' && !ke.shiftKey && !ke.ctrlKey && !ke.metaKey) {
      const target = e.target as Element;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        this.analyze();
      }
    }
  };

  // ========== 分析入口 ==========

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

    const issues = this.collectIssues();

    let riskScore = 0;
    if (scb) riskScore += 40;
    if (shs) riskScore += 35;
    if (cdpm) riskScore += 25;
    riskScore = Math.min(riskScore, 100);

    const result: FormDetectionResult = {
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
    }, undefined);
  }

  // ----- suspiciousClientSideBehavior -----

  private _scbCodes: IssueCode[] = [];

  private analyzeSuspiciousBehavior(): boolean {
    this._scbCodes = [];
    const checks: boolean[] = [];

    // 1. 有值但无键盘事件
    const noKbdFields: string[] = [];
    for (const [, state] of this.fieldStates) {
      if (state.hadInput && !state.hadKeydown && state.totalChars > 0) {
        noKbdFields.push(state.fieldName);
      }
    }
    if (noKbdFields.length > 0) {
      this._scbCodes.push(ScbCodes.NO_KEYBOARD_BUT_VALUE);
      checks.push(true);
    }

    // 2. 点击在正中/四角比例过高
    let centerOrCornerClicks = 0;
    let totalClicks = 0;
    for (const [, state] of this.fieldStates) {
      if (state.clickCount > 0) {
        totalClicks += state.clickCount;
        if (state.clickCentered || state.clickCorner) centerOrCornerClicks += state.clickCount;
      }
    }
    if (totalClicks >= 2 && centerOrCornerClicks / totalClicks > 2 / 3) {
      this._scbCodes.push(ScbCodes.CENTER_CORNER_CLICK);
      checks.push(true);
    }

    // 3. 不同元素的点击偏移一致
    const offsetKeys = new Set<string>();
    for (const [, state] of this.fieldStates) {
      if (state.clickOffsetKey) offsetKeys.add(state.clickOffsetKey);
    }
    if (offsetKeys.size === 1 && totalClicks >= 2 && this.fieldStates.size >= 2) {
      this._scbCodes.push(ScbCodes.SAME_CLICK_OFFSET);
      checks.push(true);
    }

    // 4. 点击前无鼠标移动
    const noPrecedingMove = this.clickRecords.filter(r => !r.hadPrecedingMove && !r.isTrusted).length;
    const trustedClicks = this.clickRecords.filter(r => r.isTrusted).length;
    if (this.clickRecords.length >= 3 && noPrecedingMove / this.clickRecords.length > 0.5) {
      this._scbCodes.push(ScbCodes.NO_MOUSE_BEFORE_CLICK);
      checks.push(true);
    }

    // 5. 多字段无 Tab 且无鼠标点击切换
    const fieldsWithInput: FieldState[] = [];
    for (const [, state] of this.fieldStates) {
      if (state.hadInput && state.totalChars > 0) fieldsWithInput.push(state);
    }
    if (fieldsWithInput.length >= 2) {
      let hasTabOrClick = false;
      for (const s of fieldsWithInput) {
        if (s.tabPressed || s.hadClick) hasTabOrClick = true;
      }
      if (!hasTabOrClick) {
        this._scbCodes.push(ScbCodes.NO_TAB_NO_CLICK_SWITCH);
        checks.push(true);
      }
    }

    // 6. 并行填充
    const inputTimes = fieldsWithInput.map(s => s.firstInputTime).filter(t => t > 0).sort((a, b) => a - b);
    if (inputTimes.length >= 2) {
      const minInterval = inputTimes[1] - inputTimes[0];
      if (minInterval < 100) {
        this._scbCodes.push(ScbCodes.PARALLEL_FILL);
        checks.push(true);
      }
    }

    // 附加：isTrusted: false 事件
    if (trustedClicks === 0 && this.clickRecords.length >= 2) {
      this._scbCodes.push(ScbCodes.UNTRUSTED_EVENTS);
      checks.push(true);
    }

    return checks.length >= 2;
  }

  // ----- superHumanSpeed -----

  private _shsCodes: IssueCode[] = [];

  private analyzeSuperHumanSpeed(): boolean {
    this._shsCodes = [];
    const checks: boolean[] = [];

    const fieldsWithInput: FieldState[] = [];
    let totalChars = 0;
    for (const [, state] of this.fieldStates) {
      if (state.hadInput && state.totalChars > 0) {
        fieldsWithInput.push(state);
        totalChars += state.totalChars;
      }
    }

    if (fieldsWithInput.length === 0) return false;

    const fillDuration = this.lastInputTime - this.firstInputTime;

    // 1. 填写总时长过短
    if (fillDuration > 0 && fillDuration < 500 && totalChars > 10) {
      this._shsCodes.push(ShsCodes.FILL_TOO_FAST);
      checks.push(true);
    }

    // 2. 极速填写（无时间差=批量赋值）
    if (fillDuration === 0 && totalChars > 0) {
      this._shsCodes.push(ShsCodes.BATCH_ASSIGN);
      checks.push(true);
    }

    // 3. 打字速度超人类
    if (fillDuration > 0) {
      const cps = totalChars / (fillDuration / 1000);
      if (cps > 20) {
        this._shsCodes.push(ShsCodes.TYPING_TOO_FAST);
        checks.push(true);
      }
    }

    // 4. 按键间隔均匀度
    const cadence = this.buildTypingCadence();
    if (cadence.totalKeys > 10 && cadence.intervalCV < 0.1) {
      this._shsCodes.push(ShsCodes.UNIFORM_INTERVALS);
      checks.push(true);
    }

    // 5. 孤立 keydown（阈值 >=5，避免 IME/修饰键/快速提交误报）
    if (cadence.orphanKeydowns >= 5) {
      this._shsCodes.push(ShsCodes.ORPHAN_KEYDOWN);
      checks.push(true);
    }

    return checks.length >= 2;
  }

  // ----- hasCDPMouseLeak -----

  private _cdpCodes: IssueCode[] = [];

  private analyzeCDPMouseLeak(): boolean {
    this._cdpCodes = [];
    if (this.clickRecords.length === 0) return false;
    const checks: boolean[] = [];

    // 1. 零坐标点击
    const zeroClicks = this.clickRecords.filter(r => r.x === 0 && r.y === 0);
    if (zeroClicks.length > 0) {
      this._cdpCodes.push(CdpCodes.ZERO_COORD_CLICK);
      return true;
    }

    // 2. 整数坐标比例（非 Retina 屏幕真实鼠标也产整数坐标；需多组不同坐标排除重复点击同一位置）
    const intCoords = this.clickRecords.filter(r => r.x === Math.floor(r.x) && r.y === Math.floor(r.y));
    const uniqueIntCoords = new Set(intCoords.map(r => `${r.x},${r.y}`));
    if (this.clickRecords.length >= 5 && intCoords.length / this.clickRecords.length > 0.95 && uniqueIntCoords.size >= 3) {
      this._cdpCodes.push(CdpCodes.INTEGER_COORDS);
      checks.push(true);
    }

    // 3. clientX/Y vs pageX/Y 不一致（使用点击时捕获的 scroll 值）
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

  private buildTypingCadence(): TypingCadence {
    const keydowns = this.keyRecords;
    if (keydowns.length < 2) {
      return { intervals: [], intervalAvg: 0, intervalCV: 0, totalKeys: keydowns.length, untrustedKeys: 0, orphanKeydowns: 0 };
    }

    const intervals: number[] = [];
    for (let i = 1; i < keydowns.length; i++) {
      const gap = keydowns[i].t - keydowns[i - 1].t;
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

  private collectIssues(): IssueCode[] {
    const issues: IssueCode[] = [];
    issues.push(...this._scbCodes);
    issues.push(...this._shsCodes);
    issues.push(...this._cdpCodes);
    return issues;
  }
}
