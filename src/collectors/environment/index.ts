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

  // 自动化/机器人信号：递减权重避免简单叠加
  const autoSignals: { weight: number }[] = [];
  if (automation.is_webdriver) autoSignals.push({ weight: 50 });
  if (headless.is_headless) autoSignals.push({ weight: 50 });
  if (devtools.is_cdp && !devtools.is_open) autoSignals.push({ weight: 50 });

  // Selenium/Nightmare/Sequentum 来自 automation.signals
  const hasSelenium = automation.signals.includes('selenium_cdc') || automation.signals.includes('selenium_cdc_array');
  const hasNightmare = automation.signals.includes('nightmare');
  const hasSequentum = automation.signals.includes('sequentum');
  if (hasSelenium) autoSignals.push({ weight: 50 });
  if (hasNightmare) autoSignals.push({ weight: 50 });
  if (hasSequentum) autoSignals.push({ weight: 50 });

  // iframe 内 webdriver 也是强自动化信号
  if (iframe.is_webdriver) autoSignals.push({ weight: 50 });

  autoSignals.sort((a, b) => b.weight - a.weight);

  let riskScore = 0;
  for (let i = 0; i < autoSignals.length; i++) {
    riskScore += autoSignals[i].weight * Math.pow(0.5, i);
  }
  if (autoSignals.length >= 3) riskScore += 20;
  else if (autoSignals.length >= 2) riskScore += 10;

  if (devtools.is_open) riskScore += 10;
  if (!consistency.ua_consistent) riskScore += 15;
  if (iframe.is_overridden) riskScore += 15;
  if (!worker.is_consistent) riskScore += 15;
  if (worker.is_cdp) riskScore += 10;

  riskScore = Math.min(Math.round(riskScore), 100);

  return {
    is_webdriver: automation.is_webdriver,
    is_headless: headless.is_headless,
    is_devtools_open: devtools.is_open,
    is_cdp: devtools.is_cdp,
    is_selenium: hasSelenium,
    is_nightmare: hasNightmare,
    is_sequentum: hasSequentum,
    iframe_overridden: iframe.is_overridden,
    iframe_webdriver: iframe.is_webdriver,
    worker_consistent: worker.is_consistent,
    worker_cdp: worker.is_cdp,
    is_tampered: !consistency.ua_consistent || iframe.is_overridden || !worker.is_consistent,
    is_proxy: false,
    ua_consistent: consistency.ua_consistent,
    risk_score: riskScore,
    signals: allSignals,
  };
}
