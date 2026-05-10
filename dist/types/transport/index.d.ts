import type { ResolvedConfig } from '../types/config';
import { type Report } from './batch';
export declare class TransportManager {
    private batch;
    private reporter;
    private retry;
    private beacon;
    constructor(config: ResolvedConfig);
    send(report: Report): void;
    flush(): void;
    destroy(): void;
    private processBatch;
}
export type { Report } from './batch';
