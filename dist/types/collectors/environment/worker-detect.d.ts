export interface WorkerResult {
    is_consistent: boolean;
    is_cdp: boolean;
    signals: string[];
}
export declare function detectWorkerConsistency(): Promise<WorkerResult>;
