import { safeExec } from '../../utils/safe-exec';

export interface DevtoolsResult {
  is_open: boolean;
  is_cdp: boolean;
  signals: string[];
}

export function detectDevtools(): DevtoolsResult {
  const signals: string[] = [];

  safeExec(() => {
    const threshold = 160;
    if (
      window.outerWidth - window.innerWidth > threshold ||
      window.outerHeight - window.innerHeight > threshold
    ) {
      signals.push('size_diff');
    }
  }, undefined);

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
  }, undefined);

  safeExec(() => {
    let triggered = false;
    const Err = Error as unknown as Record<string, unknown>;
    const orig = Err.prepareStackTrace;
    Err.prepareStackTrace = function () {
      triggered = true;
      return orig;
    };
    // eslint-disable-next-line no-console
    console.log(new Error(''));
    Err.prepareStackTrace = orig;
    if (triggered) signals.push('cdp_runtime');
  }, undefined);

  const hasSizeDiff = signals.includes('size_diff');
  const hasCdp = signals.includes('cdp_runtime');

  return {
    is_open: hasSizeDiff || signals.includes('getter_trap'),
    is_cdp: hasCdp,
    signals,
  };
}
