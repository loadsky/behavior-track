import type { EnvStaticReport, BehaviorStreamReport } from '../types/reports';

export type Report = EnvStaticReport | BehaviorStreamReport;

export interface BatchOptions {
  maxSize: number;
  interval: number;
  onFlush: (batch: Report[]) => void;
}

export class BatchQueue {
  private queue: Report[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private options: BatchOptions;

  constructor(options: BatchOptions) {
    this.options = options;
    this.startTimer();
  }

  add(report: Report): void {
    this.queue.push(report);
    if (this.queue.length >= this.options.maxSize) {
      this.flush();
    }
  }

  flush(): void {
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0);
    this.options.onFlush(batch);
    this.resetTimer();
  }

  drain(): Report[] {
    return this.queue.splice(0);
  }

  destroy(): void {
    this.flush();
    this.stopTimer();
  }

  get size(): number {
    return this.queue.length;
  }

  private startTimer(): void {
    this.timer = setTimeout(() => this.tick(), this.options.interval);
  }

  private tick(): void {
    this.flush();
    this.startTimer();
  }

  private resetTimer(): void {
    this.stopTimer();
    this.startTimer();
  }

  private stopTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
