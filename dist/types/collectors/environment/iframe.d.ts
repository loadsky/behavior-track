export interface IframeResult {
    is_overridden: boolean;
    is_webdriver: boolean;
    is_cdp: boolean;
    is_tampered: boolean;
    signals: string[];
}
export declare function detectIframe(): IframeResult;
