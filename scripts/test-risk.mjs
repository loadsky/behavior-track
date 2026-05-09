import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, extname, join } from 'path';
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
      is_suspicious_form: env.risk_indicators.is_suspicious_form,
      is_form_super_human: env.risk_indicators.is_form_super_human,
      is_form_cdp_mouse: env.risk_indicators.is_form_cdp_mouse,
      risk_score: env.risk_indicators.risk_score,
      signals: env.risk_indicators.signals,
      browser: env.browser,
      browser_version: env.browser_version,
      fingerprint: env.fingerprint,
      webrtc_ips: env.webrtc_ips,
    };
  });
}

async function simulateFormSubmit(page) {
  console.log('  模拟表单填写...');

  const email = page.locator('#login-email');
  await email.click();
  await page.keyboard.type('test@example.com', { delay: 60 });

  const password = page.locator('#login-password');
  await password.click();
  await page.keyboard.type('Password123!', { delay: 50 });

  await page.locator('#login-btn').click();
  await page.waitForTimeout(500);

  const formResult = await page.evaluate(() => {
    return (window.vm && window.vm.formResult) || null;
  });

  if (formResult) {
    console.log('  表单检测结果:');
    console.log('    is_pass        :', formResult.is_pass);
    console.log('    risk_score     :', formResult.risk_score, '/ 100');
    console.log('    issues         :', formResult.issues.length > 0 ? formResult.issues.join(', ') : '(无)');
    console.log('    signals:');
    console.log('      suspicious_client_side_behavior:', formResult.signals.suspicious_client_side_behavior);
    console.log('      super_human_speed              :', formResult.signals.super_human_speed);
    console.log('      has_cdp_mouse_leak             :', formResult.signals.has_cdp_mouse_leak);
  } else {
    console.log('  表单检测结果: (未获取到)');
  }
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
const reportDir = join(root, 'report');
mkdirSync(reportDir, { recursive: true });

const server = await serve(root);
const port = server.address().port;
const baseURL = `http://localhost:${port}`;
console.log(`Server: ${baseURL}`);

const VP = { width: 1500, height: 750 };
const DPR = 2;

let screenshotSeq = 0;
async function screenshot(page) {
  screenshotSeq++;
  const file = join(reportDir, `test_risk_${screenshotSeq}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`  截图已保存: report/test_risk_${screenshotSeq}.png`);
}

// --- Test 1: 无头浏览器 — 最明显的自动化特征
console.log('\n=== 测试 1: 无头浏览器 (Headless) ===');
{
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: VP, deviceScaleFactor: DPR });
  const page = await context.newPage();
  await page.goto(baseURL + '/examples/index.html', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__bt);
  await simulateFormSubmit(page);
  const result = await collectRiskInfo(page);
  printResult(result);
  await screenshot(page);
  await browser.close();
}

// --- Test 2: 有头浏览器 + 去除 webdriver 标志 — 模拟正常用户
console.log('\n=== 测试 2: 有头 + 去除自动化标志 (Stealth-like) ===');
{
  const browser = await chromium.launch({
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-features=ChromeWhatsNewUI',
    ],
  });
  const context = await browser.newContext({ viewport: VP, deviceScaleFactor: DPR });
  const page = await context.newPage();

  // 移除 navigator.webdriver 标志
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  await page.goto(baseURL + '/examples/index.html', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__bt);
  await simulateFormSubmit(page);
  const result = await collectRiskInfo(page);
  printResult(result);
  await screenshot(page);
  await browser.close();
}

// --- Test 3: CDP 连接 Chrome ---
console.log('\n=== 测试 3: CDP 远程连接 (Remote Debugging) ===');
{
  const { proc, wsEndpoint } = await launchChromeCDP();
  console.log('  CDP ws:', wsEndpoint);
  const browser = await chromium.connectOverCDP(wsEndpoint);
  const page = browser.contexts()[0].pages()[0];
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    ...VP, deviceScaleFactor: DPR, mobile: false,
  });
  await page.goto(baseURL + '/examples/index.html', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__bt);
  await simulateFormSubmit(page);
  const result = await collectRiskInfo(page);
  printResult(result);
  await screenshot(page);
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
  console.log('  is_suspicious_form:', r.is_suspicious_form);
  console.log('  is_form_super_human:', r.is_form_super_human);
  console.log('  is_form_cdp_mouse :', r.is_form_cdp_mouse);
  console.log('  signals           :', r.signals.length > 0 ? r.signals.join(', ') : '(无)');
}
