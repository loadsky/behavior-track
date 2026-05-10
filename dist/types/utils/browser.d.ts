export interface BrowserInfo {
    browser: string;
    browser_version: string;
    os: string;
    device_type: 'PC' | 'Mobile' | 'Tablet';
}
export interface PageContext {
    url: string;
    host: string;
    title: string;
    referrer: string;
    lang: string;
    timezone: number;
    cookie_enabled: boolean;
}
export declare function parseBrowser(): Promise<BrowserInfo>;
export declare function getPageContext(): PageContext;
