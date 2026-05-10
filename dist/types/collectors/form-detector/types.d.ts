/** suspiciousClientSideBehavior 子信号 */
export declare const ScbCodes: {
    readonly NO_KEYBOARD_BUT_VALUE: "no_keyboard_but_value";
    readonly CENTER_CORNER_CLICK: "center_corner_click";
    readonly SAME_CLICK_OFFSET: "same_click_offset";
    readonly NO_MOUSE_BEFORE_CLICK: "no_mouse_before_click";
    readonly NO_TAB_NO_CLICK_SWITCH: "no_tab_no_click_switch";
    readonly PARALLEL_FILL: "parallel_fill";
    readonly UNTRUSTED_EVENTS: "untrusted_events";
};
/** superHumanSpeed 子信号 */
export declare const ShsCodes: {
    readonly BATCH_ASSIGN: "batch_assign";
    readonly TYPING_TOO_FAST: "typing_too_fast";
    readonly UNIFORM_INTERVALS: "uniform_intervals";
    readonly ORPHAN_KEYDOWN: "orphan_keydown";
};
/** hasCDPMouseLeak 子信号 */
export declare const CdpCodes: {
    readonly ZERO_COORD_CLICK: "zero_coord_click";
    readonly INTEGER_COORDS: "integer_coords";
    readonly COORD_INCONSISTENT: "coord_inconsistent";
    readonly OFFSET_ANOMALY: "offset_anomaly";
};
/** 环境风险子信号 */
export declare const EnvCodes: {
    readonly ENV_CDP_DETECTED: "env_cdp_detected";
    readonly ENV_DEVTOOLS_OPEN: "env_devtools_open";
    readonly ENV_WEBDRIVER: "env_webdriver";
    readonly ENV_HEADLESS: "env_headless";
    readonly ENV_WORKER_CDP: "env_worker_cdp";
    readonly ENV_TAMPERED: "env_tampered";
    readonly ENV_UA_INCONSISTENT: "env_ua_inconsistent";
};
export type IssueCode = (typeof ScbCodes)[keyof typeof ScbCodes] | (typeof ShsCodes)[keyof typeof ShsCodes] | (typeof CdpCodes)[keyof typeof CdpCodes] | (typeof EnvCodes)[keyof typeof EnvCodes];
/** 传递给表单检测器的环境风险快照 */
export interface EnvRiskSnapshot {
    risk_score: number;
    signals: string[];
    is_cdp: boolean;
    is_devtools_open: boolean;
    is_webdriver: boolean;
    is_headless: boolean;
    worker_cdp: boolean;
    is_tampered: boolean;
    ua_consistent: boolean;
}
export interface FormDetectConfig {
    containerSelector: string;
    actionSelector: string;
    onResult: (result: FormDetectionResult) => void;
    envRisk?: EnvRiskSnapshot;
}
export interface FormDetectionResult {
    is_pass: boolean;
    risk_score: number;
    signals: FormSignalResults;
    issues: IssueCode[];
    timestamp: number;
}
export interface FormSignalResults {
    suspicious_client_side_behavior: boolean;
    super_human_speed: boolean;
    has_cdp_mouse_leak: boolean;
}
export interface FieldState {
    fieldName: string;
    element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    hadClick: boolean;
    hadInput: boolean;
    hadKeydown: boolean;
    hadPaste: boolean;
    inputTrusted: boolean;
    firstInputTime: number;
    lastInputTime: number;
    clickCount: number;
    clickCentered: boolean;
    clickCorner: boolean;
    clickOffsetKey: string;
    tabPressed: boolean;
    totalChars: number;
}
export interface ClickRecord {
    x: number;
    y: number;
    t: number;
    isTrusted: boolean;
    offsetX: number;
    offsetY: number;
    pageX: number;
    pageY: number;
    scrollX: number;
    scrollY: number;
    target: string;
    hadPrecedingMove: boolean;
}
export interface KeyRecord {
    t: number;
    isTrusted: boolean;
    key: string;
    hadKeyup: boolean;
}
export interface TypingCadence {
    intervals: number[];
    intervalAvg: number;
    intervalCV: number;
    totalKeys: number;
    untrustedKeys: number;
    orphanKeydowns: number;
}
