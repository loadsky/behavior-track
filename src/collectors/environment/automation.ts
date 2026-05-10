import { safeExec } from '../../utils/safe-exec';

const SCOPE = 'automation';

export interface AutomationResult {
  is_webdriver: boolean;
  signals: string[];
}

export function detectAutomation(): AutomationResult {
  const signals: string[] = [];

  safeExec(() => {
    if (navigator.webdriver) signals.push('navigator.webdriver');
  }, undefined, SCOPE);

  safeExec(() => {
    if ((window as unknown as Record<string, unknown>).__selenium_unwrapped) signals.push('selenium_unwrapped');
    if ((window as unknown as Record<string, unknown>).__webdriver_evaluate) signals.push('webdriver_evaluate');
    if ((window as unknown as Record<string, unknown>).__driver_evaluate) signals.push('driver_evaluate');
  }, undefined, SCOPE);

  safeExec(() => {
    if ((window as unknown as Record<string, unknown>).callPhantom) signals.push('phantomjs');
    if ((window as unknown as Record<string, unknown>)._phantom) signals.push('_phantom');
  }, undefined, SCOPE);

  safeExec(() => {
    if ((window as unknown as Record<string, unknown>).__playwright) signals.push('playwright');
    if ((window as unknown as Record<string, unknown>).__pw_manual) signals.push('playwright_manual');
  }, undefined, SCOPE);

  safeExec(() => {
    if ((document as unknown as Record<string, unknown>).__webdriver_script_fn) signals.push('webdriver_script_fn');
    if ((document as unknown as Record<string, unknown>).__fxdriver_unwrapped) signals.push('fxdriver');
  }, undefined, SCOPE);

  safeExec(() => {
    const win = window as unknown as Record<string, unknown>;
    if (win.chrome && (win.chrome as Record<string, unknown>).runtime === undefined) {
      if (win._cdp) signals.push('cdp_detected');
    }
  }, undefined, SCOPE);

  safeExec(() => {
    const permissions = (navigator as unknown as Record<string, { query?: unknown }>).permissions;
    if (permissions && typeof permissions.query === 'undefined') {
      signals.push('permissions_api_missing');
    }
  }, undefined, SCOPE);

  safeExec(() => {
    if ((document as unknown as Record<string, unknown>).$cdc_asdjflasutopfhvcZLmcfl_) signals.push('selenium_cdc');
    if ((window as unknown as Record<string, unknown>).cdc_adoQpoasnfa76pfcZLmcfl_Array) signals.push('selenium_cdc_array');
  }, undefined, SCOPE);

  safeExec(() => {
    if ((window as unknown as Record<string, unknown>).__nightmare) signals.push('nightmare');
  }, undefined, SCOPE);

  safeExec(() => {
    try {
      // eslint-disable-next-line deprecation/deprecation
      const ext = window.external as unknown as Record<string, unknown> | undefined;
      if (ext && typeof ext.toString === 'function' && String(ext).indexOf('Sequentum') > -1) {
        signals.push('sequentum');
      }
    } catch { /* toString may throw */ }
  }, undefined, SCOPE);

  return {
    is_webdriver: signals.length > 0,
    signals,
  };
}
