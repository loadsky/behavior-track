import { detectAutomation } from './automation';
import { detectHeadless } from './headless';
import { detectDevtools } from './devtools';
import { detectConsistency } from './consistency';
import { detectIframe } from './iframe';
import { detectWorkerConsistency } from './worker-detect';
import type { RiskIndicators } from '../../types/reports';

export async function collectEnvironment(): Promise<RiskIndicators> {
  const automation = detectAutomation();
  const headless = detectHeadless();
  const devtools = detectDevtools();
  const consistency = detectConsistency();
  const iframe = detectIframe();
  const worker = await detectWorkerConsistency();

  const allSignals = [
    ...automation.signals,
    ...headless.signals,
    ...devtools.signals,
    ...consistency.signals,
    ...iframe.signals,
    ...worker.signals,
  ];

  // webdriver 检测：主框架 + iframe 两层检测同一根因，只计一次
  const hasWebdriver = automation.is_webdriver || iframe.is_webdriver;
  // CDP 检测：三层（主框架/iframe/worker）检测同一根因，只计一次
  const hasCdp = devtools.is_cdp || iframe.is_cdp || worker.is_cdp;

  // 自动化/机器人信号：递减权重避免简单叠加
  const autoSignals: { weight: number }[] = [];
  if (hasWebdriver) autoSignals.push({ weight: 50 });
  if (headless.is_headless) autoSignals.push({ weight: 50 });
  if (devtools.is_tampered) autoSignals.push({ weight: 50 });
  if (hasCdp && !devtools.is_open) autoSignals.push({ weight: 50 });

  // Selenium/Nightmare/Sequentum 来自 automation.signals
  const hasSelenium = automation.signals.includes('selenium_cdc') || automation.signals.includes('selenium_cdc_array');
  const hasNightmare = automation.signals.includes('nightmare');
  const hasSequentum = automation.signals.includes('sequentum');
  if (hasSelenium) autoSignals.push({ weight: 50 });
  if (hasNightmare) autoSignals.push({ weight: 50 });
  if (hasSequentum) autoSignals.push({ weight: 50 });

  autoSignals.sort((a, b) => b.weight - a.weight);

  let riskScore = 0;
  for (let i = 0; i < autoSignals.length; i++) {
    riskScore += autoSignals[i].weight * Math.pow(0.5, i);
  }
  if (autoSignals.length >= 3) riskScore += 20;
  else if (autoSignals.length >= 2) riskScore += 10;

  if (devtools.is_open) riskScore += 10;
  if (iframe.is_tampered) riskScore += 10;
  if (consistency.is_mismatch) riskScore += 15;
  if (iframe.is_overridden) riskScore += 15;
  if (worker.is_tampered) riskScore += 15;

  riskScore = Math.min(Math.round(riskScore), 100);

  return {
    is_webdriver: hasWebdriver,
    is_headless: headless.is_headless,
    is_devtools_open: devtools.is_open,
    is_cdp: hasCdp,
    is_selenium: hasSelenium,
    is_nightmare: hasNightmare,
    is_sequentum: hasSequentum,
    is_tampered: consistency.is_mismatch || iframe.is_overridden || worker.is_tampered || devtools.is_tampered || iframe.is_tampered,
    is_proxy: false,
    is_suspicious_client: false,
    is_super_speed: false,
    is_mouse_leak: false,
    risk_score: riskScore,
    signals: allSignals,
  };
}
