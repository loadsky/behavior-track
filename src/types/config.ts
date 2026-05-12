import type { RiskIndicators } from './reports';

export interface SDKConfig {
  appId: string;
  endpoint?: string;
  enableFingerprint?: boolean;
  enableEnvironment?: boolean;
  enableBehavior?: boolean;
  behaviorSampleRate?: number;
  batchInterval?: number;
  batchSize?: number;
  maxRetries?: number;
  uploadRawStreamOnRisk?: boolean;
  rawStreamRiskThreshold?: number;
  rawStreamWindowBatches?: number;
  disableSignals?: Array<keyof RiskIndicators>;
  debug?: boolean;
}

export type ResolvedConfig = Required<SDKConfig>;
