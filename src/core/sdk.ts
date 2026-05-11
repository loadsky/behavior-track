import type { SDKConfig, ResolvedConfig, EnvStaticReport, BehaviorStreamReport, FormDetectConfig } from '../types';
import type { EnvRiskSnapshot } from '../collectors/form-detector/types';
import { resolveConfig } from './config';
import { EventBus } from './event-bus';
import { Lifecycle } from './lifecycle';
import { generateSessionId } from '../utils/generate-id';
import { getDeviceId } from '../storage/device-id';
import { getFingerprint } from '../collectors/fingerprint';
import { collectWebRTC } from '../collectors/webrtc';
import { collectEnvironment } from '../collectors/environment';
import { BehaviorManager } from '../collectors/behavior';
import { FormDetector } from '../collectors/form-detector';
import { TransportManager } from '../transport';
import { parseBrowser, getPageContext } from '../utils/browser';
import { signReport } from '../utils/integrity';
import { snapshotErrorCounts, resetErrorCounts } from '../utils/diagnostics';

export class BehaviorTrackSDK {
  private config!: ResolvedConfig;
  private eventBus = new EventBus();
  private lifecycle = new Lifecycle();
  private deviceId = '';
  private sessionId = '';
  private envPromise: Promise<EnvStaticReport> | null = null;
  private behaviorManager: BehaviorManager | null = null;
  private formDetectors: FormDetector[] = [];
  private transport: TransportManager | null = null;
  private sequenceNo = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private currentRiskScore = 0;
  private rawWindowRemaining = 0;
  private lastEnvSnapshot: EnvRiskSnapshot | null = null;

  async init(config: SDKConfig): Promise<void> {
    if (this.lifecycle.state !== 'idle') return;
    this.config = resolveConfig(config);
    this.deviceId = await getDeviceId();
    this.sessionId = generateSessionId();
    this.transport = new TransportManager(this.config);
    this.lifecycle.activate();

    if (this.config.enableFingerprint || this.config.enableEnvironment) {
      this.envPromise = this.collectEnv().finally(() => {
        this.envPromise = null;
      });
    }

    if (this.config.enableBehavior) {
      this.behaviorManager = new BehaviorManager(this.config);
      this.behaviorManager.start();
    }

    this.setupBatchFlush();
  }

  async getEnvInfo(): Promise<EnvStaticReport> {
    if (!this.envPromise) {
      this.envPromise = this.collectEnv().finally(() => {
        this.envPromise = null;
      });
    }
    return this.envPromise;
  }

  onBehaviorReport(callback: (data: BehaviorStreamReport) => void): void {
    this.eventBus.on('behavior:report', callback as (...args: unknown[]) => void);
  }

  detect(config: FormDetectConfig): void {
    if (this.lifecycle.state === 'destroyed') return;
    const originalOnResult = config.onResult;
    const wrapped: FormDetectConfig = {
      ...config,
      envRisk: this.lastEnvSnapshot ?? undefined,
      onResult: (result) => {
        if (typeof result.risk_score === 'number' && result.risk_score > this.currentRiskScore) {
          this.currentRiskScore = result.risk_score;
        }
        originalOnResult?.(result);
      },
    };
    const detector = new FormDetector(wrapped);
    this.formDetectors.push(detector);
  }

  pause(): void {
    this.lifecycle.pause();
    this.behaviorManager?.stop();
  }

  resume(): void {
    this.lifecycle.resume();
    this.behaviorManager?.start();
  }

  resetSession(): string {
    if (this.lifecycle.state === 'destroyed') return this.sessionId;
    this.sessionId = generateSessionId();
    this.sequenceNo = 0;
    resetErrorCounts();
    return this.sessionId;
  }

  getDiagnostics(): { error_counts: Record<string, number>; session_id: string; sequence_no: number } {
    return {
      error_counts: snapshotErrorCounts(),
      session_id: this.sessionId,
      sequence_no: this.sequenceNo,
    };
  }

  destroy(): void {
    this.lifecycle.destroy();
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.behaviorManager?.stop();
    this.behaviorManager = null;
    for (const fd of this.formDetectors) {
      fd.destroy();
    }
    this.formDetectors = [];
    this.transport?.flush();
    this.transport = null;
    this.eventBus.clear();
    this.envPromise = null;
    this.sessionId = '';
    this.sequenceNo = 0;
    this.lifecycle.reset();
  }

  private async collectEnv(): Promise<EnvStaticReport> {
    const [fingerprint, riskIndicators, webrtc] = await Promise.all([
      this.config.enableFingerprint ? getFingerprint() : null,
      this.config.enableEnvironment ? collectEnvironment() : null,
      collectWebRTC(),
    ]);

    const uaInfo = await parseBrowser();
    const pageCtx = getPageContext();

    const report: EnvStaticReport = {
      report_type: 'ENV_STATIC',
      device_id: this.deviceId,
      fingerprint: fingerprint?.visitorId ?? '',
      webrtc_ips: webrtc.ips,
      session_id: this.sessionId,
      timestamp: Date.now(),
      page_context: pageCtx,
      user_agent: navigator.userAgent,
      browser: uaInfo.browser,
      browser_version: uaInfo.browser_version,
      os: uaInfo.os,
      device_type: uaInfo.device_type,
      risk_indicators: riskIndicators ?? {
        is_webdriver: false,
        is_headless: false,
        is_devtools_open: false,
        is_cdp: false,
        is_selenium: false,
        is_nightmare: false,
        is_sequentum: false,
        is_tampered: false,
        is_proxy: false,
        is_suspicious_form: false,
        is_form_super_human: false,
        is_form_cdp_mouse: false,
        risk_score: 0,
        signals: [],
      },
      integrity_check: '',
    };

    // 合并表单检测信号
    const ri = report.risk_indicators;

    // 在合并之前，将原始环境风险快照推入表单检测器
    const envSnapshot = this.buildEnvSnapshot(ri);
    this.lastEnvSnapshot = envSnapshot;
    for (const fd of this.formDetectors) {
      fd.setEnvRisk(envSnapshot);
    }

    let formSuspicious = false;
    let formSuperHuman = false;
    let formCDPMouse = false;
    const formSignalStrings: string[] = [];

    for (const fd of this.formDetectors) {
      const sigs = fd.getSignals();
      if (sigs.is_suspicious_form) formSuspicious = true;
      if (sigs.is_form_super_human) formSuperHuman = true;
      if (sigs.is_form_cdp_mouse) formCDPMouse = true;
      formSignalStrings.push(...sigs.signalStrings);
    }

    ri.is_suspicious_form = formSuspicious;
    ri.is_form_super_human = formSuperHuman;
    ri.is_form_cdp_mouse = formCDPMouse;
    ri.signals = [...ri.signals, ...formSignalStrings];
    ri.risk_score = this.computeUpdatedRiskScore(ri.risk_score, formSuspicious, formSuperHuman, formCDPMouse);

    if (ri.risk_score > this.currentRiskScore) {
      this.currentRiskScore = ri.risk_score;
    }

    const errCounts = snapshotErrorCounts();
    if (Object.keys(errCounts).length > 0) {
      report.error_counts = errCounts;
    }

    report.integrity_check = signReport(report as unknown as Record<string, unknown>);

    this.transport?.send(report);
    return report;
  }

  private buildEnvSnapshot(ri: EnvStaticReport['risk_indicators']): EnvRiskSnapshot {
    return {
      risk_score: ri.risk_score,
      signals: ri.signals,
      is_cdp: ri.is_cdp,
      is_devtools_open: ri.is_devtools_open,
      is_webdriver: ri.is_webdriver,
      is_headless: ri.is_headless,
      is_tampered: ri.is_tampered,
    };
  }

  private computeUpdatedRiskScore(baseScore: number, formSuspicious: boolean, formSuperHuman: boolean, formCDPMouse: boolean): number {
    const signals: { weight: number }[] = [];
    if (formSuspicious) signals.push({ weight: 35 });
    if (formSuperHuman) signals.push({ weight: 30 });
    if (formCDPMouse) signals.push({ weight: 25 });

    signals.sort((a, b) => b.weight - a.weight);
    let score = baseScore;
    for (let i = 0; i < signals.length; i++) {
      score += signals[i].weight * Math.pow(0.6, i);
    }
    return Math.min(Math.round(score), 100);
  }

  private setupBatchFlush(): void {
    const flushBehavior = async () => {
      if (!this.lifecycle.isActive() || !this.behaviorManager) return;

      const hit = this.config.uploadRawStreamOnRisk
        && this.currentRiskScore >= this.config.rawStreamRiskThreshold;
      if (hit) this.rawWindowRemaining = this.config.rawStreamWindowBatches;
      const includeRaw = this.rawWindowRemaining > 0;
      if (includeRaw) this.rawWindowRemaining--;

      const stream = this.behaviorManager.drain({ includeRaw });
      const isEmpty = stream.click_tracks.length === 0
        && stream.keyboard_stream.length === 0
        && stream.touch_events.length === 0
        && stream.move_features.count === 0
        && stream.scroll_summary.total_scroll === 0
        && !stream.raw_on_risk;
      if (isEmpty) {
        scheduleNext();
        return;
      }

      if (stream.raw_on_risk) {
        stream.raw_on_risk.trigger_score = this.currentRiskScore;
      }

      this.sequenceNo++;
      const report: BehaviorStreamReport = {
        report_type: 'BEHAVIOR_STREAM',
        device_id: this.deviceId,
        session_id: this.sessionId,
        sequence_no: this.sequenceNo,
        timestamp: Date.now(),
        data_stream: stream,
        integrity_check: '',
      };

      report.integrity_check = signReport(report as unknown as Record<string, unknown>);

      this.eventBus.emit('behavior:report', report);
      this.transport?.send(report);

      scheduleNext();
    };

    const scheduleNext = () => {
      if (this.lifecycle.state === 'destroyed') {
        this.flushTimer = null;
        return;
      }
      this.flushTimer = setTimeout(flushBehavior, this.config.batchInterval);
    };

    scheduleNext();
  }
}
