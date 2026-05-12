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

async function wait(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function collectRiskInfo(page) {
  return page.evaluate(async () => {
    const bt = window.__bt;
    if (!bt) return { error: 'BehaviorTrack not exposed to window' };

    const env = await bt.getEnvInfo();
    return {
      ...env.risk_indicators,
      browser: env.browser,
      browser_version: env.browser_version,
      fingerprint: env.fingerprint,
      webrtc_ips: env.webrtc_ips,
    };
  });
}

async function simulateFormSubmit(page) {
  console.log('  模拟表单填写 (Playwright)...');

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
    for (const [k, v] of Object.entries(formResult.signals)) {
      console.log(`      ${k.padEnd(22)}:`, v);
    }
  } else {
    console.log('  表单检测结果: (未获取到)');
  }
}

async function simulateFormSubmitCDP(page) {
  console.log('  模拟表单填写 (CDP 原始指令)...');

  // 全用 JS 设值 + 程序化点击，不产生键盘事件、无鼠标轨迹
  await page.evaluate(() => {
    const email = document.getElementById('login-email');
    email.value = 'test@example.com';
    email.dispatchEvent(new Event('input', { bubbles: true }));

    const pwd = document.getElementById('login-password');
    pwd.value = 'Password123!';
    pwd.dispatchEvent(new Event('input', { bubbles: true }));

    document.getElementById('login-btn').click();
  });

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
    for (const [k, v] of Object.entries(formResult.signals)) {
      console.log(`      ${k.padEnd(22)}:`, v);
    }
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
  await wait(100); // 等待UI更新
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
  const context = await browser.newContext({ viewport: VP, deviceScaleFactor: DPR });
  const page = await context.newPage();
  await page.goto(baseURL + '/examples/index.html', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__bt);
  await simulateFormSubmitCDP(page);
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
  for (const [k, v] of Object.entries(r)) {
    if (k.startsWith('is_')) console.log(`  ${k.padEnd(22)}:`, v);
  }
  console.log('  signals           :', r.signals.length > 0 ? r.signals.join(', ') : '(无)');
}
