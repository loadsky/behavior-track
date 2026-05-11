export interface WorkerResult {
    is_tampered: boolean;
    is_cdp: boolean;
    signals: string[];
}
export declare function detectWorkerConsistency(): Promise<WorkerResult>;
