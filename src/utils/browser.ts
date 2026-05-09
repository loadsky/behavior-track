export interface BrowserInfo {
  browser: string;
  browser_version: string;
  os: string;
  device_type: 'PC' | 'Mobile' | 'Tablet';
}

export interface PageContext {
  url: string;
  host: string;
  title: string;
  referrer: string;
  lang: string;
  timezone: number;
  cookie_enabled: boolean;
}

export async function parseBrowser(): Promise<BrowserInfo> {
  const ua = navigator.userAgent;

  // 尝试 User-Agent Client Hints API (Chrome 90+, Edge 90+)
  const uaData = (navigator as unknown as Record<string, unknown>).userAgentData as
    | { brands: Array<{ brand: string; version: string }>; mobile: boolean; platform: string; getHighEntropyValues(hints: string[]): Promise<Record<string, unknown>> }
    | undefined;

  if (uaData?.getHighEntropyValues) {
    try {
      const highEntropy = await uaData.getHighEntropyValues(['fullVersionList', 'platformVersion']);
      const fullList = highEntropy.fullVersionList as Array<{ brand: string; version: string }>;

      const browser = parseBrandName(uaData.brands, ua);
      const preciseVersion = fullList.find(
        (b) => b.brand === browser.label || b.brand === browser.alias
      )?.version || fullList[0]?.version || '';

      return {
        browser: browser.id,
        browser_version: preciseVersion,
        os: uaData.platform || parseOS(ua),
        device_type: uaData.mobile ? 'Mobile' : parseDeviceType(ua),
      };
    } catch {
      // 回退到 UA 解析
    }
  }

  return parseFromUA(ua);
}

function parseBrandName(
  brands: Array<{ brand: string; version: string }>,
  ua: string,
): { id: string; label: string; alias: string } {
  for (const { brand } of brands) {
    if (brand === 'Google Chrome') return { id: 'chrome', label: 'Google Chrome', alias: 'Chromium' };
    if (brand === 'Microsoft Edge') return { id: 'edge', label: 'Microsoft Edge', alias: 'Chromium' };
    if (brand === 'Opera') return { id: 'opera', label: 'Opera', alias: 'Chromium' };
  }
  const fromUA = parseBrowserId(ua);
  return { id: fromUA, label: '', alias: '' };
}

function parseFromUA(ua: string): BrowserInfo {
  return {
    browser: parseBrowserId(ua),
    browser_version: parseVersion(ua),
    os: parseOS(ua),
    device_type: parseDeviceType(ua),
  };
}

function parseBrowserId(ua: string): string {
  if (/Edg\//.test(ua)) return 'edge';
  if (/OPR\//.test(ua)) return 'opera';
  if (/Chrome\//.test(ua)) return 'chrome';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Safari\//.test(ua) && !/Chrome/.test(ua)) return 'safari';
  return 'unknown';
}

function parseVersion(ua: string): string {
  const map: Array<{ test: RegExp; pattern: RegExp }> = [
    { test: /Edg\//, pattern: /Edg\/([\d.]+)/ },
    { test: /OPR\//, pattern: /OPR\/([\d.]+)/ },
    { test: /Chrome\//, pattern: /Chrome\/([\d.]+)/ },
    { test: /Firefox\//, pattern: /Firefox\/([\d.]+)/ },
    { test: /Safari\//, pattern: /Version\/([\d.]+)/ },
  ];
  for (const { test, pattern } of map) {
    if (test.test(ua)) return (ua.match(pattern) || [])[1] || '';
  }
  return '';
}

function parseOS(ua: string): string {
  if (/Windows/.test(ua)) return 'Windows';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Android/.test(ua)) return 'Android';
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
  if (/Linux/.test(ua)) return 'Linux';
  return '';
}

function parseDeviceType(ua: string): 'PC' | 'Mobile' | 'Tablet' {
  if (/Mobi/.test(ua)) return 'Mobile';
  if (/Tablet|iPad/.test(ua)) return 'Tablet';
  return 'PC';
}

export function getPageContext(): PageContext {
  return {
    url: location.href,
    host: location.host,
    title: document.title,
    referrer: document.referrer,
    lang: navigator.language,
    timezone: new Date().getTimezoneOffset() / -60,
    cookie_enabled: navigator.cookieEnabled,
  };
}
