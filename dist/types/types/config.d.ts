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
    debug?: boolean;
}
export interface ResolvedConfig {
    appId: string;
    endpoint: string;
    enableFingerprint: boolean;
    enableEnvironment: boolean;
    enableBehavior: boolean;
    behaviorSampleRate: number;
    batchInterval: number;
    batchSize: number;
    maxRetries: number;
    uploadRawStreamOnRisk: boolean;
    rawStreamRiskThreshold: number;
    rawStreamWindowBatches: number;
    debug: boolean;
}
