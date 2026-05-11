export interface DevtoolsResult {
    is_open: boolean;
    is_cdp: boolean;
    is_tampered: boolean;
    signals: string[];
}
export declare function detectDevtools(): DevtoolsResult;
