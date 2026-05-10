import type { SDKConfig, EnvStaticReport, BehaviorStreamReport, FormDetectConfig } from '../types';
export declare class BehaviorTrackSDK {
    private config;
    private eventBus;
    private lifecycle;
    private deviceId;
    private sessionId;
    private envPromise;
    private behaviorManager;
    private formDetectors;
    private transport;
    private sequenceNo;
    private flushTimer;
    private currentRiskScore;
    private rawWindowRemaining;
    private lastEnvSnapshot;
    init(config: SDKConfig): Promise<void>;
    getEnvInfo(): Promise<EnvStaticReport>;
    onBehaviorReport(callback: (data: BehaviorStreamReport) => void): void;
    detect(config: FormDetectConfig): void;
    pause(): void;
    resume(): void;
    resetSession(): string;
    getDiagnostics(): {
        error_counts: Record<string, number>;
        session_id: string;
        sequence_no: number;
    };
    destroy(): void;
    private collectEnv;
    private buildEnvSnapshot;
    private computeUpdatedRiskScore;
    private setupBatchFlush;
}
