export declare function throttle<T extends (...args: never[]) => void>(fn: T, interval: number): (...args: Parameters<T>) => void;
