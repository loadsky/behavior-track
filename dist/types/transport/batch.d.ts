import type { EnvStaticReport, BehaviorStreamReport } from '../types/reports';
export type Report = EnvStaticReport | BehaviorStreamReport;
export interface BatchOptions {
    maxSize: number;
    interval: number;
    onFlush: (batch: Report[]) => void;
}
export declare class BatchQueue {
    private queue;
    private timer;
    private options;
    constructor(options: BatchOptions);
    add(report: Report): void;
    flush(): void;
    drain(): Report[];
    destroy(): void;
    get size(): number;
    private startTimer;
    private tick;
    private resetTimer;
    private stopTimer;
}
