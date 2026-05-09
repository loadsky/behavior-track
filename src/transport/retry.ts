export interface RetryOptions {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30000,
};

export class RetryQueue {
  private options: RetryOptions;
  private pending: Array<{ payload: unknown; attempts: number }> = [];

  constructor(options?: Partial<RetryOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async execute(
    payload: unknown,
    sendFn: (data: unknown) => Promise<boolean>,
  ): Promise<boolean> {
    for (let attempt = 0; attempt <= this.options.maxRetries; attempt++) {
      const success = await sendFn(payload);
      if (success) return true;

      if (attempt < this.options.maxRetries) {
        const delay = this.getDelay(attempt);
        console.log(`[BehaviorTrack] retry #${attempt + 1} in ${delay}ms`);
        await this.sleep(delay);
      }
    }

    console.warn('[BehaviorTrack] max retries exceeded, dropping payload');
    return false;
  }

  addToPending(payload: unknown): void {
    this.pending.push({ payload, attempts: 0 });
  }

  drainPending(): Array<{ payload: unknown; attempts: number }> {
    const items = this.pending.splice(0);
    return items;
  }

  private getDelay(attempt: number): number {
    const exponential = this.options.baseDelay * Math.pow(2, attempt);
    const capped = Math.min(exponential, this.options.maxDelay);
    const jitter = capped * (0.8 + Math.random() * 0.4);
    return Math.round(jitter);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
