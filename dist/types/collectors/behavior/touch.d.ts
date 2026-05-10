import type { TouchEvent as TouchEvt } from '../../types/reports';
export declare class TouchTracker {
    private events;
    private handlers;
    start(): void;
    stop(): void;
    drain(): TouchEvt[];
}
