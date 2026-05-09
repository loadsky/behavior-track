import { safeExec } from '../../utils/safe-exec';

export interface IframeResult {
  is_overridden: boolean;
  is_webdriver: boolean;
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
      // 检测原型链是否被覆写：正常环境 self.get 是内置函数，toString 较短
      try {
        const getStr = (cw.self as unknown as Record<string, unknown>).get?.toString?.() || '';
        if (getStr.length > 5) signals.push('iframe_self_overridden');
      } catch { /* cross-origin */ }

      // 检测 contentWindow 是否 === window（某些工具会错误地指向自身）
      if (cw === window) signals.push('iframe_contentWindow_eq_window');

      // 检测 setTimeout 是否指向同一个（正常环境应不同）
      if (cw.setTimeout === window.setTimeout) signals.push('iframe_setTimeout_same');

      // 检测 iframe 内的 navigator.webdriver
      if (cw.navigator?.webdriver) signals.push('iframe_webdriver');
    }

    document.body.removeChild(iframe);
  }, undefined);

  return {
    is_overridden: signals.some(s => s.startsWith('iframe_') && s !== 'iframe_webdriver'),
    is_webdriver: signals.includes('iframe_webdriver'),
    signals,
  };
}
