import { BehaviorTrackSDK } from './core/sdk';
import type { SDKConfig, EnvStaticReport, BehaviorStreamReport, FormDetectConfig } from './types';

const instance = new BehaviorTrackSDK();

const BehaviorTrack = {
  init: (config: SDKConfig) => instance.init(config),
  getEnvInfo: () => instance.getEnvInfo(),
  onBehaviorReport: (callback: (data: BehaviorStreamReport) => void) => instance.onBehaviorReport(callback),
  detect: (config: FormDetectConfig) => instance.detect(config),
  pause: () => instance.pause(),
  resume: () => instance.resume(),
  resetSession: () => instance.resetSession(),
  getDiagnostics: () => instance.getDiagnostics(),
  destroy: () => instance.destroy(),
};

export { BehaviorTrack };
export type { SDKConfig, EnvStaticReport, BehaviorStreamReport, FormDetectConfig };
