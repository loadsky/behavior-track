export type SDKState = 'idle' | 'active' | 'paused' | 'destroyed';
export declare class Lifecycle {
    private _state;
    get state(): SDKState;
    activate(): void;
    pause(): void;
    resume(): void;
    destroy(): void;
    reset(): void;
    isActive(): boolean;
}
