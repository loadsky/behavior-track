import type { ResolvedConfig } from '../../types/config';
import type { BehaviorStream } from '../../types/reports';
export declare class BehaviorManager {
    private mouse;
    private keyboard;
    private scroll;
    private touch;
    private _config;
    private _sampled;
    constructor(config: ResolvedConfig);
    start(): void;
    stop(): void;
    drain(options?: {
        includeRaw: boolean;
    }): BehaviorStream;
    private shouldSample;
}
