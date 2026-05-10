// ====== 检测原因标识 ======

/** suspiciousClientSideBehavior 子信号 */
export const ScbCodes = {
  NO_KEYBOARD_BUT_VALUE: 'no_keyboard_but_value',
  CENTER_CORNER_CLICK: 'center_corner_click',
  SAME_CLICK_OFFSET: 'same_click_offset',
  NO_MOUSE_BEFORE_CLICK: 'no_mouse_before_click',
  NO_TAB_NO_CLICK_SWITCH: 'no_tab_no_click_switch',
  PARALLEL_FILL: 'parallel_fill',
  UNTRUSTED_EVENTS: 'untrusted_events',
} as const;

/** superHumanSpeed 子信号 */
export const ShsCodes = {
  FILL_TOO_FAST: 'fill_too_fast',
  BATCH_ASSIGN: 'batch_assign',
  TYPING_TOO_FAST: 'typing_too_fast',
  UNIFORM_INTERVALS: 'uniform_intervals',
  ORPHAN_KEYDOWN: 'orphan_keydown',
} as const;

/** hasCDPMouseLeak 子信号 */
export const CdpCodes = {
  ZERO_COORD_CLICK: 'zero_coord_click',
  INTEGER_COORDS: 'integer_coords',
  COORD_INCONSISTENT: 'coord_inconsistent',
  OFFSET_ANOMALY: 'offset_anomaly',
} as const;

/** 环境风险子信号 */
export const EnvCodes = {
  ENV_CDP_DETECTED: 'env_cdp_detected',
  ENV_DEVTOOLS_OPEN: 'env_devtools_open',
  ENV_WEBDRIVER: 'env_webdriver',
  ENV_HEADLESS: 'env_headless',
  ENV_WORKER_CDP: 'env_worker_cdp',
  ENV_TAMPERED: 'env_tampered',
  ENV_UA_INCONSISTENT: 'env_ua_inconsistent',
} as const;

export type IssueCode =
  | (typeof ScbCodes)[keyof typeof ScbCodes]
  | (typeof ShsCodes)[keyof typeof ShsCodes]
  | (typeof CdpCodes)[keyof typeof CdpCodes]
  | (typeof EnvCodes)[keyof typeof EnvCodes];

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

// ====== 公共类型 ======

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
