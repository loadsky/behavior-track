import './polyfill';
import type { SDKConfig, EnvStaticReport, BehaviorStreamReport, FormDetectConfig } from './types';
declare const BehaviorTrack: {
    init: (config: SDKConfig) => Promise<void>;
    getEnvInfo: () => Promise<EnvStaticReport>;
    onBehaviorReport: (callback: (data: BehaviorStreamReport) => void) => void;
    detect: (config: FormDetectConfig) => void;
    pause: () => void;
    resume: () => void;
    resetSession: () => string;
    getDiagnostics: () => {
        error_counts: Record<string, number>;
        session_id: string;
        sequence_no: number;
    };
    destroy: () => void;
};
export default BehaviorTrack;
export type { SDKConfig, EnvStaticReport, BehaviorStreamReport, FormDetectConfig };
