import { BehaviorTrackSDK } from './core/sdk';
import type { SDKConfig, EnvStaticReport, BehaviorStreamReport } from './types';

const instance = new BehaviorTrackSDK();

const BehaviorTrack = {
  init: (config: SDKConfig) => instance.init(config),
  getEnvInfo: () => instance.getEnvInfo(),
  onBehaviorReport: (callback: (data: BehaviorStreamReport) => void) => instance.onBehaviorReport(callback),
  pause: () => instance.pause(),
  resume: () => instance.resume(),
  destroy: () => instance.destroy(),
};

export { BehaviorTrack };
export type { SDKConfig, EnvStaticReport, BehaviorStreamReport };
