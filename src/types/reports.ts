export interface RiskIndicators {
  is_webdriver: boolean;
  is_headless: boolean;
  is_devtools_open: boolean;
  is_cdp: boolean;
  is_selenium: boolean;
  is_nightmare: boolean;
  is_sequentum: boolean;
  iframe_overridden: boolean;
  iframe_webdriver: boolean;
  worker_consistent: boolean;
  worker_cdp: boolean;
  is_tampered: boolean;
  is_proxy: boolean;
  ua_consistent: boolean;
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
  integrity_check: string;
}

export interface MouseTrack {
  x: number;
  y: number;
  t: number;
  type: 'move' | 'click' | 'down' | 'up';
  is_trusted: boolean;
}

export interface KeyboardEvent {
  t: number;
  key_count: number;
  trusted_count: number;
  interval_avg: number;
  hold_avg: number;
}

export interface ScrollEvent {
  t: number;
  top: number;
  speed: number;
  direction: 'up' | 'down';
  is_trusted: boolean;
}

export interface TouchEvent {
  x: number;
  y: number;
  t: number;
  pressure: number;
  radius: number;
  is_trusted: boolean;
}

export interface BehaviorStreamReport {
  report_type: 'BEHAVIOR_STREAM';
  device_id: string;
  session_id: string;
  sequence_no: number;
  timestamp: number;
  data_stream: {
    mouse_tracks: MouseTrack[];
    keyboard_stream: KeyboardEvent[];
    scroll_events: ScrollEvent[];
    touch_events: TouchEvent[];
  };
  integrity_check: string;
}
