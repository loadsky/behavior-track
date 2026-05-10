export interface ConsistencyResult {
    ua_consistent: boolean;
    signals: string[];
}
export declare function detectConsistency(): ConsistencyResult;
