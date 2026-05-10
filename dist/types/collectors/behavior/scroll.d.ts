import type { ScrollSummary, RawScrollEvent } from '../../types/reports';
export interface ScrollDrainResult {
    summary: ScrollSummary;
    rawEvents?: RawScrollEvent[];
}
export declare class ScrollTracker {
    private events;
    private lastTop;
    private lastTime;
    private handler;
    start(): void;
    stop(): void;
    drain(includeRaw?: boolean): ScrollDrainResult;
    private computeSummary;
}
