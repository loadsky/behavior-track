export interface AutomationResult {
    is_webdriver: boolean;
    signals: string[];
}
export declare function detectAutomation(): AutomationResult;
