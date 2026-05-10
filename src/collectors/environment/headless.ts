import { safeExec } from '../../utils/safe-exec';
import { UAParser } from 'ua-parser-js';

const SCOPE = 'headless';

export interface HeadlessResult {
  is_headless: boolean;
  signals: string[];
}

export function detectHeadless(): HeadlessResult {
  const signals: string[] = [];
  const ua = navigator.userAgent;
  const device = new UAParser(ua).getDevice();
  const isMobile = device.type === 'mobile' || device.type === 'tablet';

  safeExec(() => {
    if (!isMobile && navigator.plugins && navigator.plugins.length === 0) {
      signals.push('no_plugins');
    }
  }, undefined, SCOPE);

  safeExec(() => {
    if (!navigator.languages || navigator.languages.length === 0) {
      signals.push('no_languages');
    }
  }, undefined, SCOPE);

  safeExec(() => {
    if (/HeadlessChrome/.test(navigator.userAgent)) {
      signals.push('headless_ua');
    }
  }, undefined, SCOPE);

  safeExec(() => {
    if (!isMobile && !(window as unknown as Record<string, unknown>).chrome && /Chrome/.test(ua)) {
      signals.push('chrome_obj_missing');
    }
  }, undefined, SCOPE);

  safeExec(() => {
    if (window.outerWidth === 0 && window.outerHeight === 0) {
      signals.push('zero_outer_dimensions');
    }
  }, undefined, SCOPE);

  safeExec(() => {
    if (Notification.permission === 'denied' && !navigator.userAgent.includes('Firefox')) {
      signals.push('notification_denied_default');
    }
  }, undefined, SCOPE);

  safeExec(() => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl');
    if (gl) {
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (debugInfo) {
        const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
        if (/SwiftShader|llvmpipe|Mesa/.test(renderer)) {
          signals.push('software_renderer');
        }
      }
    }
  }, undefined, SCOPE);

  return {
    is_headless: signals.length >= 2,
    signals,
  };
}
