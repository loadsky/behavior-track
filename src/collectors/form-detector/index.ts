import type { FormDetectConfig, FormDetectionResult, FormSignalResults, AnalyzerResult, EnvRiskSnapshot } from './types';
import type { CollectedData } from './analyzers';
import { subscribeDocObserver } from './doc-observer';
import { EventCollector } from './event-collector';
import { analyzeSuspiciousBehavior, analyzeSuperHumanSpeed, analyzeCDPMouseLeak, collectEnvIssues } from './analyzers';
import { safeExec } from '../../utils/safe-exec';

const SCOPE = 'form_detector';

// 信号 → 分析函数 + 权重，新增检测项只需扩展此表
const SIGNAL_ANALYZERS: Array<{ key: keyof FormSignalResults; fn: (data: CollectedData) => AnalyzerResult; weight: number }> = [
  { key: 'is_suspicious_client', fn: analyzeSuspiciousBehavior, weight: 40 },
  { key: 'is_super_speed', fn: analyzeSuperHumanSpeed, weight: 35 },
  { key: 'is_mouse_leak', fn: analyzeCDPMouseLeak, weight: 25 },
];

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
  private unsubscribeDoc: (() => void) | null = null;
  private envRisk: EnvRiskSnapshot | null = null;

  constructor(config: FormDetectConfig) {
    this.config = config;
    if (config.envRisk) this.envRisk = config.envRisk;
    this.collector = new EventCollector();
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
    // 获取当前检测信号摘要，将触发的 key 转为 'form:is_xxx' 格式字符串
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

  detect(): Promise<FormDetectionResult> {
    return Promise.resolve(this.analyze());
  }

  private analyze(): FormDetectionResult {
    if (this.destroyed || !this.container) {
      return { is_pass: true, risk_score: 0, signals: { is_suspicious_client: false, is_super_speed: false, is_mouse_leak: false }, issues: [], timestamp: Date.now() };
    }

    const data = this.collector.snapshot(this.container);
    // disableSignals 中的检测项跳过执行，直接返回空结果
    const disabled = this.config.disableSignals ?? [];
    const EMPTY: AnalyzerResult = { triggered: false, codes: [] };

    // 遍历 SIGNAL_ANALYZERS 表执行各检测项，disabled 项不调用分析函数
    const results = SIGNAL_ANALYZERS.map(({ key, fn, weight }) => ({
      key,
      weight,
      result: disabled.includes(key) ? EMPTY : fn(data),
    }));

    // 合并环境风险 issues 与表单行为 issues
    const envIssues = collectEnvIssues(this.envRisk);
    const issues = results.reduce((acc, r) => { acc.push(...r.result.codes); return acc; }, envIssues.slice());

    // 提取已触发信号的权重，按降序用于衰减评分
    const formSignals = results
      .filter(r => r.result.triggered)
      .map(r => ({ weight: r.weight }))
      .sort((a, b) => b.weight - a.weight);

    // 基础分 = 环境风险分，每增加一个信号按 0.6 衰减叠加（避免多信号简单相加超 100）
    let riskScore = this.envRisk?.risk_score ?? 0;
    for (let i = 0; i < formSignals.length; i++) {
      riskScore += formSignals[i].weight * Math.pow(0.6, i);
    }
    riskScore = Math.min(Math.round(riskScore), 100);

    // 将各检测项 triggered 状态组装为 FormSignalResults
    const signals: Record<string, boolean> = {};
    for (const r of results) signals[r.key] = r.result.triggered;

    const result: FormDetectionResult = {
      // 40 分为风险阈值，低于此值视为通过
      is_pass: riskScore < 40,
      risk_score: riskScore,
      signals: signals as unknown as FormSignalResults,
      issues,
      timestamp: Date.now(),
    };

    this.lastResult = result;

    safeExec(() => {
      this.config.onResult?.(result);
    }, undefined, SCOPE);

    return result;
  }
}
