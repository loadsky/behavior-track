export interface HeadlessResult {
    is_headless: boolean;
    signals: string[];
}
export declare function detectHeadless(): HeadlessResult;
