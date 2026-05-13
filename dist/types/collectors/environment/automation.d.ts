export interface AutomationResult {
    is_automation: boolean;
    signals: string[];
}
export declare function detectAutomation(): AutomationResult;
