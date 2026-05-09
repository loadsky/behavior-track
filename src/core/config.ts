import type { SDKConfig, ResolvedConfig } from '../types/config';

const DEFAULT_CONFIG: Omit<ResolvedConfig, 'appId'> = {
  endpoint: '',
  enableFingerprint: true,
  enableEnvironment: true,
  enableBehavior: true,
  behaviorSampleRate: 1.0,
  batchInterval: 5000,
  batchSize: 50,
  maxRetries: 3,
  debug: false,
};

export function resolveConfig(config: SDKConfig): ResolvedConfig {
  return {
    ...DEFAULT_CONFIG,
    ...config,
  } as ResolvedConfig;
}
