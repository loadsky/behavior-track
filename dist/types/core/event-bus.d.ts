type Handler = (...args: unknown[]) => void;
export declare class EventBus {
    private listeners;
    on(event: string, handler: Handler): void;
    emit(event: string, ...args: unknown[]): void;
    clear(): void;
}
export {};
