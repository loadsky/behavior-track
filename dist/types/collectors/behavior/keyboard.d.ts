import type { KeyboardEvent as KBEvent } from '../../types/reports';
export declare class KeyboardTracker {
    private stream;
    private lastKeyTime;
    private keyCount;
    private trustedCount;
    private intervalSum;
    private holdStart;
    private holdSum;
    private handlers;
    private flushTimer;
    start(): void;
    stop(): void;
    drain(): KBEvent[];
    private aggregate;
}
