import type { IssueCode, FieldState, ClickRecord, KeyRecord, TypingCadence, EnvRiskSnapshot, AnalyzerResult, ActionClickState } from './types';
export interface CollectedData {
    fieldStates: ReadonlyMap<Element, FieldState>;
    clickRecords: readonly ClickRecord[];
    keyRecords: readonly KeyRecord[];
    actionClickSuspicious: boolean;
    actionClickState: Readonly<ActionClickState>;
    firstInputTime: number;
    lastInputTime: number;
}
/**
 * 可疑客户端行为(SCB)检测，需命中 >=2 项才判定：
 * 1. 有值但无键盘事件  2. 中心/四角点击比例过高  3. 不同元素点击偏移一致
 * 4. 点击前无鼠标移动  5. 多字段无 Tab/点击切换  6. 并行填充  7. 非受信事件
 */
export declare function analyzeSuspiciousBehavior(data: CollectedData): AnalyzerResult;
/**
 * 超人类速度(SHS)检测，需命中 >=2 项才判定：
 * 1. 批量赋值（填充耗时为 0）  2. 打字速度 >20 cps
 * 3. 按键间隔 CV <0.1（机器般均匀）  4. 孤立 keydown >=5 次
 */
export declare function analyzeSuperHumanSpeed(data: CollectedData): AnalyzerResult;
/**
 * CDP 鼠标指纹检测：识别 Chrome DevTools Protocol 注入的合成鼠标事件。
 * 零坐标点击直接判定；其余需命中 >=2 项。
 */
export declare function analyzeCDPMouseLeak(data: CollectedData): AnalyzerResult;
export declare function buildTypingCadence(keyRecords: readonly KeyRecord[]): TypingCadence;
export declare function collectEnvIssues(envRisk: EnvRiskSnapshot | null): IssueCode[];
