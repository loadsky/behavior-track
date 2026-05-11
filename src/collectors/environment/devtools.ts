import { safeExec } from '../../utils/safe-exec';
import { isNativeFn, isGetterTampered } from '../../utils/native-check';

const SCOPE = 'devtools';

export interface DevtoolsResult {
  is_open: boolean;
  is_cdp: boolean;
  is_tampered: boolean;
  signals: string[];
}

export function detectDevtools(): DevtoolsResult {
  const signals: string[] = [];

  safeExec(() => {
    const ow = window.outerWidth;
    const oh = window.outerHeight;
    const iw = window.innerWidth;
    const ih = window.innerHeight;
    if (ow < 50 || oh < 50) return;
    const rw = iw / ow;
    const rh = ih / oh;
    if (rw < 0.88 || rh < 0.75) {
      signals.push('size_diff');
    }
  }, undefined, SCOPE);

  safeExec(() => {
    const el = new Image();
    Object.defineProperty(el, 'id', {
      get() {
        signals.push('getter_trap');
        return '';
      },
    });
    // eslint-disable-next-line no-console
    console.debug('%c', el as unknown as string);
  }, undefined, SCOPE);

  safeExec(() => {
    let triggered = false;
    const Err = Error as unknown as Record<string, unknown>;
    const orig = Err.prepareStackTrace;
    Err.prepareStackTrace = function () {
      triggered = true;
      return orig;
    };
    // eslint-disable-next-line no-console
    console.debug(new Error(''));
    Err.prepareStackTrace = orig;
    if (triggered) signals.push('cdp_runtime');
  }, undefined, SCOPE);

  safeExec(() => {
    if (isGetterTampered(window, 'outerWidth') || isGetterTampered(window, 'outerHeight')) {
      signals.push('prop_descriptor_tampered');
    }
    if (isGetterTampered(navigator, 'webdriver')) {
      signals.push('prop_descriptor_tampered');
    }
  }, undefined, SCOPE);

  safeExec(() => {
    if (!isNativeFn(console.debug)) signals.push('console_tampered');
  }, undefined, SCOPE);

  safeExec(() => {
    if (!isNativeFn(Function.prototype.toString)) signals.push('tostring_tampered');
  }, undefined, SCOPE);

  const dedupedSignals = [...new Set(signals)];

  const hasSizeDiff = dedupedSignals.includes('size_diff');
  const hasCdp = dedupedSignals.includes('cdp_runtime');
  const hasTampered = dedupedSignals.includes('prop_descriptor_tampered')
    || dedupedSignals.includes('console_tampered')
    || dedupedSignals.includes('tostring_tampered');

  return {
    is_open: hasSizeDiff || dedupedSignals.includes('getter_trap'),
    is_cdp: hasCdp,
    is_tampered: hasTampered,
    signals: dedupedSignals,
  };
}
