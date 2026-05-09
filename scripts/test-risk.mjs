import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { resolve, extname } from 'path';
import { spawn } from 'child_process';

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.map': 'application/json',
};

function serve(root) {
  return new Promise((res) => {
    const s = createServer((req, res) => {
      const path = req.url === '/' ? '/examples/index.html' : req.url;
      const full = resolve(root, '.' + path);
      if (existsSync(full)) {
        const ext = extname(full);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
        res.end(readFileSync(full));
      } else {
        res.writeHead(404);
        res.end();
      }
    }).listen(0, () => res(s));
  });
}

async function collectRiskInfo(page) {
  return page.evaluate(async () => {
    const bt = window.__bt;
    if (!bt) return { error: 'BehaviorTrack not exposed to window' };

    await bt.init({ appId: 'risk-test', enableFingerprint: true, enableEnvironment: true, enableBehavior: false, debug: false });
    const env = await bt.getEnvInfo();
    bt.destroy();
    return {
      is_webdriver: env.risk_indicators.is_webdriver,
      is_headless: env.risk_indicators.is_headless,
      is_devtools_open: env.risk_indicators.is_devtools_open,
      is_cdp: env.risk_indicators.is_cdp,
      is_selenium: env.risk_indicators.is_selenium,
      iframe_overridden: env.risk_indicators.iframe_overridden,
      iframe_webdriver: env.risk_indicators.iframe_webdriver,
      worker_consistent: env.risk_indicators.worker_consistent,
      worker_cdp: env.risk_indicators.worker_cdp,
      is_tampered: env.risk_indicators.is_tampered,
      is_proxy: env.risk_indicators.is_proxy,
      ua_consistent: env.risk_indicators.ua_consistent,
      risk_score: env.risk_indicators.risk_score,
      signals: env.risk_indicators.signals,
      browser: env.browser,
      browser_version: env.browser_version,
      fingerprint: env.fingerprint,
      webrtc_ips: env.webrtc_ips,
    };
  });
}

function launchChromeCDP() {
  return new Promise((res, rej) => {
    const chromePath = chromium.executablePath();
    const proc = spawn(chromePath, [
      '--remote-debugging-port=0',
      '--no-first-run',
      '--no-default-browser-check',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';
    const t = setTimeout(() => rej(new Error('CDP launch timeout')), 15000);

    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', rej);

    const check = (data) => {
      const m = data.toString().match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (m) {
        clearTimeout(t);
        res({ proc, wsEndpoint: m[1] });
      }
    };
    proc.stderr.on('data', check);
    proc.stdout.on('data', check);
  });
}

const root = resolve(import.meta.dirname, '..');
const server = await serve(root);
const port = server.address().port;
const baseURL = `http://localhost:${port}`;
console.log(`Server: ${baseURL}`);

// --- Test 1: Headless Chromium ---
console.log('\n=== 测试 1: Headless Chromium ===');
{
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(baseURL + '/examples/index.html', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__bt);
  const result = await collectRiskInfo(page);
  printResult(result);
  await browser.close();
}

// --- Test 2: Headful Chromium ---
console.log('\n=== 测试 2: Headful Chromium ===');
{
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto(baseURL + '/examples/index.html', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__bt);
  const result = await collectRiskInfo(page);
  printResult(result);
  await browser.close();
}

// --- Test 3: CDP 连接 Chrome ---
console.log('\n=== 测试 3: CDP 连接 Chrome ===');
{
  const { proc, wsEndpoint } = await launchChromeCDP();
  console.log('  CDP ws:', wsEndpoint);
  const browser = await chromium.connectOverCDP(wsEndpoint);
  const page = browser.contexts()[0].pages()[0];
  await page.goto(baseURL + '/examples/index.html', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__bt);
  const result = await collectRiskInfo(page);
  printResult(result);
  await browser.close();
  proc.kill();
}

server.close();
console.log('\n✅ 完成');

function printResult(r) {
  if (r.error) { console.log('  ❌ 错误:', r.error); return; }
  console.log('  fingerprint      :', r.fingerprint);
  console.log('  browser           :', r.browser, r.browser_version);
  console.log('  webrtc_ips        :', r.webrtc_ips);
  console.log('  ─────────────────────────────');
  console.log('  risk_score        :', r.risk_score, '/ 100');
  console.log('  is_webdriver      :', r.is_webdriver);
  console.log('  is_headless       :', r.is_headless);
  console.log('  is_devtools_open  :', r.is_devtools_open);
  console.log('  is_cdp            :', r.is_cdp);
  console.log('  is_selenium       :', r.is_selenium);
  console.log('  iframe_overridden :', r.iframe_overridden);
  console.log('  iframe_webdriver  :', r.iframe_webdriver);
  console.log('  worker_consistent :', r.worker_consistent);
  console.log('  worker_cdp        :', r.worker_cdp);
  console.log('  is_tampered       :', r.is_tampered);
  console.log('  is_proxy          :', r.is_proxy);
  console.log('  ua_consistent     :', r.ua_consistent);
  console.log('  signals           :', r.signals.length > 0 ? r.signals.join(', ') : '(无)');
}
