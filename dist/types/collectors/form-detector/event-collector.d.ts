import type { CollectedData } from './analyzers';
/**
 * 事件收集器：绑定容器内所有表单事件和全局事件，积累原始交互数据。
 * 通过 snapshot() 输出只读数据供分析函数消费。
 */
export declare class EventCollector {
    private fieldStates;
    private clickRecords;
    private keyRecords;
    private lastMouseMove;
    private composing;
    private firstInputTime;
    private lastInputTime;
    private actionClickState;
    private boundHandlers;
    private containerObserver;
    private onSubmitAction;
    constructor(callbacks: {
        onSubmitAction: () => void;
    });
    bind(container: HTMLElement, actionEl: HTMLElement | null): void;
    scanFields(container: HTMLElement): void;
    snapshot(container: HTMLElement): CollectedData;
    destroy(): void;
    private isActionClickSuspicious;
    private resetActionClickState;
    private on;
    private detachAll;
    private pushClickRecord;
    private handleFieldClick;
    private handleFieldInput;
    private handleFieldKeydown;
    private handleCompositionStart;
    private handleCompositionEnd;
    private handleFieldPaste;
    private handleGlobalKeydown;
    private handleGlobalKeyup;
    private handleGlobalMouseMove;
    private handleAction;
    private handleEnterSubmit;
}
