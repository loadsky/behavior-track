import type { FormDetectConfig, FormSignalResults, EnvRiskSnapshot } from './types';
/**
 * 表单行为检测器：监听表单内的用户交互行为，通过多维度信号分析判断是否为自动化操作。
 * 检测维度：可疑客户端行为(SCB)、超人类速度(SHS)、CDP 鼠标指纹(CDP)、环境风险(ENV)。
 */
export declare class FormDetector {
    private config;
    private container;
    private actionEl;
    private destroyed;
    private collector;
    private lastResult;
    private analyzeScheduled;
    private unsubscribeDoc;
    private envRisk;
    constructor(config: FormDetectConfig);
    setEnvRisk(snapshot: EnvRiskSnapshot): void;
    getSignals(): FormSignalResults & {
        signalStrings: string[];
    };
    destroy(): void;
    private resolveAndBind;
    private observeDocument;
    private scheduleAnalyze;
    private analyze;
}
