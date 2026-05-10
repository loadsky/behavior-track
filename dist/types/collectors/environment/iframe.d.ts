export interface IframeResult {
    is_overridden: boolean;
    is_webdriver: boolean;
    signals: string[];
}
export declare function detectIframe(): IframeResult;
