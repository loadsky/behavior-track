import type { FieldState, ClickRecord, KeyRecord, ActionClickState } from './types';
import { buildClickRecord, isCenterClick, isCornerClick, centerOffset } from './click-geometry';
import type { MouseMoveSnapshot } from './click-geometry';
import type { CollectedData } from './analyzers';

// 防止长时间运行导致内存增长的记录上限
const MAX_CLICK_RECORDS = 100;
const MAX_KEY_RECORDS = 300;
const ACTION_CLICK_DEFAULTS: ActionClickState = { count: 0, centered: false, corner: false, noPrecedingMove: 0, zeroCoord: false };

/**
 * 事件收集器：绑定容器内所有表单事件和全局事件，积累原始交互数据。
 * 通过 snapshot() 输出只读数据供分析函数消费。
 */
export class EventCollector {
  private fieldStates = new Map<Element, FieldState>();
  private clickRecords: ClickRecord[] = [];
  private keyRecords: KeyRecord[] = [];
  private lastMouseMove: MouseMoveSnapshot | null = null;
  // IME 组合输入进行中标记，composing 期间忽略 input 事件以避免中文/日文输入误判
  private composing = false;

  private firstInputTime = 0;
  private lastInputTime = 0;

  private actionClickState: ActionClickState = { ...ACTION_CLICK_DEFAULTS };

  private boundHandlers: Array<{
    target: EventTarget;
    type: string;
    handler: EventListenerOrEventListenerObject;
    options?: AddEventListenerOptions;
  }> = [];

  private actionEl: HTMLElement | null = null;
  private containerObserver: MutationObserver | null = null;

  // 绑定容器内所有表单事件和全局事件监听，启动容器内 DOM 变更观察
  bind(container: HTMLElement, actionEl: HTMLElement | null): void {
    this.actionEl = actionEl;
    this.scanFields(container);

    this.on(container, 'click', this.handleFieldClick, { passive: true, capture: true }); // 在捕获阶段监听 便于尽早获取点击事件特征
    this.on(container, 'input', this.handleFieldInput, { passive: true });
    this.on(container, 'keydown', this.handleFieldKeydown, { passive: true });
    this.on(container, 'compositionstart', this.handleCompositionStart, { passive: true });
    this.on(container, 'compositionend', this.handleCompositionEnd, { passive: true });
    this.on(container, 'paste', this.handleFieldPaste, { passive: true });
    this.on(document, 'keydown', this.handleGlobalKeydown, { passive: true });
    this.on(document, 'keyup', this.handleGlobalKeyup, { passive: true });
    this.on(document, 'mousemove', this.handleGlobalMouseMove, { passive: true });

    this.containerObserver = new MutationObserver(() => {
      this.scanFields(container);
    });
    this.containerObserver.observe(container, { childList: true, subtree: true });
  }

  // 扫描容器内所有表单字段，为新出现的字段初始化状态（跳过 hidden/submit/button/reset）
  scanFields(container: HTMLElement): void {
    const fields = container.querySelectorAll('input, textarea, select');
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

  // 刷新字段当前值长度并返回只读数据快照供分析函数消费
  snapshot(container: HTMLElement): CollectedData {
    this.scanFields(container);
    for (const [el, state] of this.fieldStates) {
      const input = el as HTMLInputElement | HTMLTextAreaElement;
      state.totalChars = input.value?.length ?? 0;
    }
    return {
      fieldStates: this.fieldStates,
      clickRecords: this.clickRecords,
      keyRecords: this.keyRecords,
      actionClickSuspicious: this.isActionClickSuspicious(),
      actionClickState: this.actionClickState,
      firstInputTime: this.firstInputTime,
      lastInputTime: this.lastInputTime,
    };
  }

  // 移除所有事件监听和 observer，清空状态
  destroy(): void {
    this.detachAll();
    if (this.containerObserver) {
      this.containerObserver.disconnect();
      this.containerObserver = null;
    }
    this.fieldStates.clear();
    this.clickRecords = [];
    this.keyRecords = [];
    this.resetActionClickState();
  }

  // action 按钮有点击且存在至少一种可疑模式时为 true，作为点击类检测项的前置条件
  private isActionClickSuspicious(): boolean {
    const s = this.actionClickState;
    return s.count >= 1 && (s.centered || s.corner || s.noPrecedingMove > 0 || s.zeroCoord);
  }

  private resetActionClickState(): void {
    this.actionClickState = { ...ACTION_CLICK_DEFAULTS };
  }

  // 注册事件监听并记录引用，destroy 时统一移除
  private on(target: EventTarget, type: string, handler: EventListener, options?: AddEventListenerOptions): void {
    target.addEventListener(type, handler, options);
    this.boundHandlers.push({ target, type, handler, options });
  }

  private detachAll(): void {
    for (const { target, type, handler, options } of this.boundHandlers) {
      target.removeEventListener(type, handler, options);
    }
    this.boundHandlers = [];
  }

  private pushClickRecord(record: ClickRecord): void {
    this.clickRecords.push(record);
    if (this.clickRecords.length > MAX_CLICK_RECORDS) {
      this.clickRecords.splice(0, this.clickRecords.length - MAX_CLICK_RECORDS);
    }
  }

  // 字段点击处理：记录点击坐标特征（中心/四角/偏移 key）
  private handleFieldClick = (e: Event): void => {
    const me = e as MouseEvent;
    const target = e.target as Element;
    const state = this.fieldStates.get(target);
    const now = performance.now();

    const record = buildClickRecord(me, target, this.lastMouseMove, now);
    this.pushClickRecord(record);

    const isActionClick = this.actionEl !== null && this.actionEl.contains(target);
    if (isActionClick) {
      this.resetActionClickState();
      this.actionClickState.count++;
      if (!record.hadPrecedingMove && !me.isTrusted) this.actionClickState.noPrecedingMove++;
      if (me.clientX === 0 && me.clientY === 0 && !me.isTrusted) this.actionClickState.zeroCoord = true;
      const rect = target.getBoundingClientRect();
      if (isCenterClick(me.clientX, me.clientY, rect)) this.actionClickState.centered = true;
      if (isCornerClick(me.clientX, me.clientY, rect)) this.actionClickState.corner = true;
    }

    if (state) {
      state.hadClick = true;
      state.clickCount++;

      const rect = target.getBoundingClientRect();
      if (isCenterClick(me.clientX, me.clientY, rect)) state.clickCentered = true;
      if (isCornerClick(me.clientX, me.clientY, rect)) state.clickCorner = true;

      const offset = centerOffset(me.clientX, me.clientY, rect);
      state.clickOffsetKey = `${Math.round(offset.dx)},${Math.round(offset.dy)}`;
    }
  };

  // 字段输入处理：跟踪首次/末次输入时间、isTrusted 状态；忽略 IME composing 阶段
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
    if (this.keyRecords.length > MAX_KEY_RECORDS) {
      this.keyRecords.splice(0, this.keyRecords.length - MAX_KEY_RECORDS);
    }
  };

  // 反向查找对应 keydown 记录并标记 hadKeyup，用于检测孤立 keydown
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

}
