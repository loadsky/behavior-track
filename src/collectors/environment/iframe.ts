import { safeExec } from '../../utils/safe-exec';

const SCOPE = 'iframe';

export interface IframeResult {
  is_overridden: boolean;
  is_automation: boolean;
  is_cdp: boolean;
  is_tampered: boolean;
  signals: string[];
}

export function detectIframe(): IframeResult {
  const signals: string[] = [];

  safeExec(() => {
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    document.body.appendChild(iframe);

    const cw = iframe.contentWindow;
    if (cw) {
      try {
        const getStr = (cw.self as unknown as Record<string, unknown>).get?.toString?.() || '';
        if (getStr.length > 5) signals.push('iframe_self_overridden');
      } catch { /* cross-origin */ }

      if (cw === window) signals.push('iframe_contentWindow_eq_window');
      if (cw.setTimeout === window.setTimeout) signals.push('iframe_setTimeout_same');
      if (cw.navigator?.webdriver) signals.push('iframe_webdriver');

      // 多帧交叉验证：利用 iframe 内未被污染的原生环境重复核心检测
      try {
        const cwAny = cw as unknown as Record<string, unknown>;
        let cdpTriggered = false;
        const CwError = cwAny.Error as unknown as Record<string, unknown>;
        const origPrepare = CwError.prepareStackTrace;
        CwError.prepareStackTrace = function () {
          cdpTriggered = true;
          return origPrepare;
        };
        // eslint-disable-next-line no-console
        const cwConsole = cwAny.console as Console;
        const ErrCtor = cwAny.Error as ErrorConstructor;
        cwConsole.debug(new ErrCtor(''));
        CwError.prepareStackTrace = origPrepare;
        if (cdpTriggered) signals.push('cdp_iframe');
      } catch { /* sandbox restriction */ }

      // 利用 iframe 干净环境的 Function.prototype.toString 交叉验证主框架属性原生性
      try {
        const cwAny = cw as unknown as Record<string, unknown>;
        const cwFnToStr = (cwAny.Function as typeof Function).prototype.toString;
        const targets: Array<{ obj: unknown; path: string }> = [
          { obj: window, path: 'outerWidth' },
          { obj: window, path: 'outerHeight' },
          { obj: navigator, path: 'webdriver' },
          { obj: navigator, path: 'userAgent' },
          { obj: navigator, path: 'platform' },
          { obj: screen, path: 'width' },
          { obj: screen, path: 'height' },
          { obj: screen, path: 'colorDepth' },
        ];
        for (const { obj, path } of targets) {
          const desc = Object.getOwnPropertyDescriptor(obj, path);
          if (desc && desc.get) {
            const fnStr = cwFnToStr.call(desc.get);
            if (!/\[native code\]/.test(fnStr)) signals.push(`iframe_native_${path}`);
          }
        }
      } catch { /* sandbox restriction */ }

      // iframe 内检测 console 函数原生性
      try {
        const cwAny = cw as unknown as Record<string, unknown>;
        const cwFn = cwAny.Function as typeof Function;
        const cwConsole = cwAny.console as Console;
        const cwFnToStr = cwFn.prototype.toString;
        const debugStr = cwFnToStr.call(cwConsole.debug);
        if (!/\[native code\]/.test(debugStr)) signals.push('iframe_console_tampered');
      } catch { /* sandbox restriction */ }
    }

    document.body.removeChild(iframe);
  }, undefined, SCOPE);

  return {
    is_overridden: ['iframe_self_overridden', 'iframe_contentWindow_eq_window', 'iframe_setTimeout_same'].some(s => signals.includes(s)),
    is_automation: signals.includes('iframe_webdriver') || signals.includes('iframe_native_webdriver'),
    is_cdp: signals.includes('cdp_iframe') || signals.includes('iframe_console_tampered'),
    is_tampered: signals.some(s => s.startsWith('iframe_native_')),
    signals,
  };
}
