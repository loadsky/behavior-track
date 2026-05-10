import { UAParser } from 'ua-parser-js';

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

const uaDeviceTypeMap: Record<string, 'PC' | 'Mobile' | 'Tablet'> = {
  mobile: 'Mobile',
  tablet: 'Tablet',
  wearable: 'Mobile',
  embedded: 'Mobile',
};

export async function parseBrowser(): Promise<BrowserInfo> {
  const ua = navigator.userAgent;
  const uaParsedData = parseFromUA(ua);

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
        browser_version: preciseVersion || uaParsedData.browser_version || '',
        os: uaData.platform || uaParsedData.os,
        device_type: uaData.mobile ? 'Mobile' : uaParsedData.device_type,
      };
    } catch {
      // 回退到 UA 解析
    }
  }

  return parseFromUA(ua);
}

function parseFromUA(ua: string): BrowserInfo {
  const parser = new UAParser(ua);
  const browser = parser.getBrowser();
  const os = parser.getOS();
  const device = parser.getDevice();

  return {
    browser: (browser.name || 'unknown').toLowerCase(),
    browser_version: browser.version || '',
    os: os.name || '',
    device_type: uaDeviceTypeMap[device.type || ''] || 'PC',
  };
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
  const fromUA = parseFromUA(ua).browser;
  return { id: fromUA, label: '', alias: '' };
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
