export interface RiskIndicators {
    is_webdriver: boolean;
    is_headless: boolean;
    is_devtools_open: boolean;
    is_cdp: boolean;
    is_selenium: boolean;
    is_nightmare: boolean;
    is_sequentum: boolean;
    is_tampered: boolean;
    is_proxy: boolean;
    is_suspicious_form: boolean;
    is_form_super_human: boolean;
    is_form_cdp_mouse: boolean;
    risk_score: number;
    signals: string[];
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
export interface EnvStaticReport {
    report_type: 'ENV_STATIC';
    device_id: string;
    fingerprint: string;
    webrtc_ips: string[];
    session_id: string;
    timestamp: number;
    page_context: PageContext;
    user_agent: string;
    browser: string;
    browser_version: string;
    os: string;
    device_type: 'PC' | 'Mobile' | 'Tablet';
    risk_indicators: RiskIndicators;
    error_counts?: Record<string, number>;
    integrity_check: string;
}
export interface ClickTrack {
    t: number;
    type: 'click' | 'down' | 'up';
    x: number;
    y: number;
    page_x: number;
    page_y: number;
    viewport_w: number;
    viewport_h: number;
    dpr: number;
    target_tag: string;
    target_path: string;
    is_trusted: boolean;
}
export interface MoveFeatures {
    count: number;
    avg_speed: number;
    straight_ratio: number;
    pause_count: number;
    total_distance: number;
}
export interface ScrollSummary {
    max_depth: number;
    total_scroll: number;
    direction_changes: number;
    duration: number;
    read_time: number;
}
export interface KeyboardEvent {
    t: number;
    key_count: number;
    trusted_count: number;
    interval_avg: number;
    hold_avg: number;
}
export interface TouchEvent {
    x: number;
    y: number;
    t: number;
    pressure: number;
    radius: number;
    is_trusted: boolean;
}
export interface RawMouseMove {
    x: number;
    y: number;
    page_x: number;
    page_y: number;
    t: number;
    is_trusted: boolean;
}
export interface RawScrollEvent {
    t: number;
    top: number;
    speed: number;
    direction: 'up' | 'down';
    is_trusted: boolean;
}
export interface RawOnRisk {
    mouse_moves: RawMouseMove[];
    scroll_events: RawScrollEvent[];
    trigger_score: number;
}
export interface BehaviorStream {
    click_tracks: ClickTrack[];
    move_features: MoveFeatures;
    scroll_summary: ScrollSummary;
    keyboard_stream: KeyboardEvent[];
    touch_events: TouchEvent[];
    raw_on_risk?: RawOnRisk;
}
export interface BehaviorStreamReport {
    report_type: 'BEHAVIOR_STREAM';
    device_id: string;
    session_id: string;
    sequence_no: number;
    timestamp: number;
    data_stream: BehaviorStream;
    integrity_check: string;
}
