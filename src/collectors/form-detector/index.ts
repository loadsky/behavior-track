import type { FormDetectConfig, FormDetectionResult, FormSignalResults, EnvRiskSnapshot } from './types';
import { subscribeDocObserver } from './doc-observer';
import { EventCollector } from './event-collector';
import { analyzeSuspiciousBehavior, analyzeSuperHumanSpeed, analyzeCDPMouseLeak, collectEnvIssues } from './analyzers';
import { safeExec } from '../../utils/safe-exec';

const SCOPE = 'form_detector';

/**
 * 表单行为检测器：监听表单内的用户交互行为，通过多维度信号分析判断是否为自动化操作。
 * 检测维度：可疑客户端行为(SCB)、超人类速度(SHS)、CDP 鼠标指纹(CDP)、环境风险(ENV)。
 */
export class FormDetector {
  private config: FormDetectConfig;
  private container: HTMLElement | null = null;
  private actionEl: HTMLElement | null = null;
  private destroyed = false;

  private collector: EventCollector;
  private lastResult: FormDetectionResult | null = null;
  private analyzeScheduled = false;
  private unsubscribeDoc: (() => void) | null = null;
  private envRisk: EnvRiskSnapshot | null = null;

  constructor(config: FormDetectConfig) {
    this.config = config;
    if (config.envRisk) this.envRisk = config.envRisk;
    this.collector = new EventCollector({ onSubmitAction: () => this.scheduleAnalyze() });
    this.resolveAndBind();
  }

  // 注入环境风险快照，若已有分析结果则立即重新计算
  setEnvRisk(snapshot: EnvRiskSnapshot): void {
    this.envRisk = snapshot;
    if (this.lastResult) {
      this.analyze();
    }
  }

  // 获取当前检测信号摘要，供外部消费
  getSignals(): FormSignalResults & { signalStrings: string[] } {
    const defaults: FormSignalResults = { is_suspicious_client: false, is_super_speed: false, is_mouse_leak: false };
    const signals = this.lastResult?.signals ?? defaults;
    const signalStrings = (Object.keys(signals) as Array<keyof FormSignalResults & string>)
      .filter(k => signals[k])
      .map(k => `form:${k}`);
    return { ...signals, signalStrings };
  }

  // 销毁实例，移除所有事件监听和 observer
  destroy(): void {
    this.destroyed = true;
    this.collector.destroy();
    if (this.unsubscribeDoc) {
      this.unsubscribeDoc();
      this.unsubscribeDoc = null;
    }
    this.lastResult = null;
  }

  // 查找容器和 action 元素并绑定事件，若容器暂不存在则通过 document observer 延迟绑定
  private resolveAndBind(): void {
    safeExec(() => {
      this.container = document.querySelector(this.config.containerSelector) as HTMLElement | null;
      this.actionEl = document.querySelector(this.config.actionSelector) as HTMLElement | null;

      if (this.container) {
        this.collector.bind(this.container, this.actionEl);
      }

      this.observeDocument();
    }, undefined);
  }

  // 监听 document DOM 变更，容器尚未挂载时延迟发现并绑定
  private observeDocument(): void {
    this.unsubscribeDoc = subscribeDocObserver(() => {
      if (this.destroyed) return;
      if (!this.container) {
        const c = document.querySelector(this.config.containerSelector) as HTMLElement | null;
        if (c) {
          this.container = c;
          this.actionEl = document.querySelector(this.config.actionSelector) as HTMLElement | null;
          this.collector.bind(c, this.actionEl);
        }
      }
    });
  }

  // 调度分析任务，优先使用 requestIdleCallback 避免阻塞主线程，200ms 超时兜底
  private scheduleAnalyze(): void {
    if (this.destroyed || this.analyzeScheduled) return;
    this.analyzeScheduled = true;
    const run = () => {
      this.analyzeScheduled = false;
      this.analyze();
    };
    const ric = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
    if (typeof ric === 'function') {
      ric(run, { timeout: 200 });
    } else {
      setTimeout(run, 0);
    }
  }

  // 核心分析入口：获取数据快照 → 调用三个分析函数 → 计算综合风险分
  private analyze(): void {
    if (this.destroyed || !this.container) return;

    const data = this.collector.snapshot(this.container);

    const scb = analyzeSuspiciousBehavior(data);
    const shs = analyzeSuperHumanSpeed(data);
    const cdp = analyzeCDPMouseLeak(data);

    const envIssues = collectEnvIssues(this.envRisk);
    const issues = [...scb.codes, ...shs.codes, ...cdp.codes, ...envIssues];

    // 信号权重：SCB(40) > SHS(35) > CDP(25)，按权重降序排列
    const formSignals: { weight: number }[] = [];
    if (scb.triggered) formSignals.push({ weight: 40 });
    if (shs.triggered) formSignals.push({ weight: 35 });
    if (cdp.triggered) formSignals.push({ weight: 25 });
    formSignals.sort((a, b) => b.weight - a.weight);

    // 基础分 = 环境风险分，每增加一个信号按 0.6 衰减叠加（避免多信号简单相加超 100）
    let riskScore = this.envRisk?.risk_score ?? 0;
    for (let i = 0; i < formSignals.length; i++) {
      riskScore += formSignals[i].weight * Math.pow(0.6, i);
    }
    riskScore = Math.min(Math.round(riskScore), 100);

    const result: FormDetectionResult = {
      // 40 分为风险阈值，低于此值视为通过
      is_pass: riskScore < 40,
      risk_score: riskScore,
      signals: {
        is_suspicious_client: scb.triggered,
        is_super_speed: shs.triggered,
        is_mouse_leak: cdp.triggered,
      },
      issues,
      timestamp: Date.now(),
    };

    this.lastResult = result;

    safeExec(() => {
      this.config.onResult(result);
    }, undefined, SCOPE);
  }
}
