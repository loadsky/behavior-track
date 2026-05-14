import './polyfill';
import { BehaviorTrackSDK } from './core/sdk';
import type { FormDetectorInstance } from './core/sdk';
import type { SDKConfig, EnvStaticReport, BehaviorStreamReport, FormDetectConfig } from './types';

const instance = new BehaviorTrackSDK();

const BehaviorTrack = {
  init: (config: SDKConfig) => instance.init(config),
  getEnvInfo: () => instance.getEnvInfo(),
  onBehaviorReport: (callback: (data: BehaviorStreamReport) => void) => instance.onBehaviorReport(callback),
  createDetector: (config: Omit<FormDetectConfig, 'onResult'>) => instance.createDetector(config),
  pause: () => instance.pause(),
  resume: () => instance.resume(),
  resetSession: () => instance.resetSession(),
  getDiagnostics: () => instance.getDiagnostics(),
  destroy: () => instance.destroy(),
};

export default BehaviorTrack;
export type { SDKConfig, EnvStaticReport, BehaviorStreamReport, FormDetectConfig, FormDetectorInstance };
