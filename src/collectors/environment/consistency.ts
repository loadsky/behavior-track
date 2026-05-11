import { safeExec } from '../../utils/safe-exec';
import { isNativeFn } from '../../utils/native-check';

const SCOPE = 'consistency';

export interface ConsistencyResult {
  is_mismatch: boolean;
  signals: string[];
}

export function detectConsistency(): ConsistencyResult {
  const signals: string[] = [];
  const ua = navigator.userAgent;

  safeExec(() => {
    const platform = navigator.platform.toLowerCase();
    if (ua.includes('Windows') && !platform.includes('win')) {
      signals.push('ua_platform_mismatch');
    }
    if (ua.includes('Mac') && !platform.includes('mac')) {
      signals.push('ua_platform_mismatch');
    }
    if (ua.includes('Linux') && !platform.includes('linux') && !platform.includes('android')) {
      signals.push('ua_platform_mismatch');
    }
  }, undefined, SCOPE);

  safeExec(() => {
    if (ua.includes('Mobile') && navigator.maxTouchPoints === 0) {
      signals.push('mobile_no_touch');
    }
  }, undefined, SCOPE);

  safeExec(() => {
    if (ua.includes('Android') && screen.width > 2000 && navigator.maxTouchPoints === 0) {
      signals.push('android_desktop_screen');
    }
  }, undefined, SCOPE);

  safeExec(() => {
    const fnStr = navigator.userAgent.toString();
    if (!fnStr.includes('[native code]') && fnStr.includes('function')) {
      signals.push('ua_tampered');
    }
  }, undefined, SCOPE);

  safeExec(() => {
    const navProto = Object.getOwnPropertyDescriptor(Navigator.prototype, 'userAgent');
    if (navProto && navProto.get && !isNativeFn(navProto.get)) {
      signals.push('navigator_proxy');
    }
  }, undefined, SCOPE);

  return {
    is_mismatch: signals.length > 0,
    signals,
  };
}
