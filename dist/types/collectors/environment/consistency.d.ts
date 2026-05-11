export interface ConsistencyResult {
    is_mismatch: boolean;
    signals: string[];
}
export declare function detectConsistency(): ConsistencyResult;
