export interface RetryOptions {
    maxRetries: number;
    baseDelay: number;
    maxDelay: number;
}
export declare class RetryQueue {
    private options;
    constructor(options?: Partial<RetryOptions>);
    execute(payload: unknown, sendFn: (data: unknown) => Promise<boolean>): Promise<boolean>;
    private getDelay;
    private sleep;
}
