import { safeExec } from '../../utils/safe-exec';

const SCOPE = 'automation';

export interface AutomationResult {
  is_automation: boolean;
  signals: string[];
}

export function detectAutomation(): AutomationResult {
  const signals: string[] = [];

  safeExec(() => {
    if (navigator.webdriver) signals.push('webdriver');
  }, undefined, SCOPE);

  safeExec(() => {
    const win = window as unknown as Record<string, unknown>;
    const props = [
      '__selenium_unwrapped',
      '__webdriver_evaluate',
      '__driver_evaluate',
      'callPhantom',
      '_phantom',
      '__playwright',
      '__pw_manual',
      '_playwright',
      '__puppeteer_evaluation_script__',
      'puppeteerBinding',
      'selenium',
      'webdriver',
      '__cdp__',
      'cdc_adoQpoasnfa76pfcZLmcfl_Array',
      'cdc_adoQpoasnfa76pfcZLmcfl_Promise',
      'cdc_adoQpoasnfa76pfcZLmcfl_Symbol',
      '__nightmare',
    ];
    for (const prop of props) {
      if (win[prop]) signals.push(prop);
    }
  }, undefined, SCOPE);

  safeExec(() => {
    const doc = document as unknown as Record<string, unknown>;
    const props = [
      '__webdriver_script_fn',
      '__webdriver_script_function',
      '__webdriver_script_func',
      '__fxdriver_unwrapped',
      '__fxdriver_evaluate',
      '__driver_unwrapped',
      '__webdriver_unwrapped',
      '__selenium_unwrapped',
      '__webdriver_evaluate',
      '__driver_evaluate',
      '$chrome_asyncScriptInfo',
      '$cdc_asdjflasutopfhvcZLmcfl_',
    ];
    for (const prop of props) {
      if (doc[prop]) signals.push(prop);
    }
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
    try {
      // eslint-disable-next-line deprecation/deprecation
      const ext = window.external as unknown as Record<string, unknown> | undefined;
      if (ext && typeof ext.toString === 'function' && String(ext).indexOf('Sequentum') > -1) {
        signals.push('sequentum');
      }
    } catch { /* toString may throw */ }
  }, undefined, SCOPE);

  return {
    is_automation: signals.length > 0,
    signals,
  };
}
