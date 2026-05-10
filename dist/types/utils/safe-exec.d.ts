export declare function safeExec<T>(fn: () => T, fallback: T, scope?: string): T;
export declare function safeExecAsync<T>(fn: () => Promise<T>, fallback: T, scope?: string): Promise<T>;
