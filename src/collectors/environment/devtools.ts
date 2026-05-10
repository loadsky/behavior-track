import { safeExec } from '../../utils/safe-exec';

const SCOPE = 'devtools';

export interface DevtoolsResult {
  is_open: boolean;
  is_cdp: boolean;
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
    if (rw < 0.88 || rh < 0.88) {
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

  const hasSizeDiff = signals.includes('size_diff');
  const hasCdp = signals.includes('cdp_runtime');

  return {
    is_open: hasSizeDiff || signals.includes('getter_trap'),
    is_cdp: hasCdp,
    signals,
  };
}
