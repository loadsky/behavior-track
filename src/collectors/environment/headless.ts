import { safeExec } from '../../utils/safe-exec';

export interface HeadlessResult {
  is_headless: boolean;
  signals: string[];
}

export function detectHeadless(): HeadlessResult {
  const signals: string[] = [];

  safeExec(() => {
    if (navigator.plugins && navigator.plugins.length === 0) {
      signals.push('no_plugins');
    }
  }, undefined);

  safeExec(() => {
    if (!navigator.languages || navigator.languages.length === 0) {
      signals.push('no_languages');
    }
  }, undefined);

  safeExec(() => {
    if (/HeadlessChrome/.test(navigator.userAgent)) {
      signals.push('headless_ua');
    }
  }, undefined);

  safeExec(() => {
    if (!(window as unknown as Record<string, unknown>).chrome && /Chrome/.test(navigator.userAgent)) {
      signals.push('chrome_obj_missing');
    }
  }, undefined);

  safeExec(() => {
    if (window.outerWidth === 0 && window.outerHeight === 0) {
      signals.push('zero_outer_dimensions');
    }
  }, undefined);

  safeExec(() => {
    if (Notification.permission === 'denied' && !navigator.userAgent.includes('Firefox')) {
      signals.push('notification_denied_default');
    }
  }, undefined);

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
  }, undefined);

  return {
    is_headless: signals.length >= 2,
    signals,
  };
}
