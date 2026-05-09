import type { ResolvedConfig } from '../types/config';
import { BatchQueue, type Report } from './batch';
import { Reporter } from './reporter';
import { RetryQueue } from './retry';
import { BeaconManager } from './beacon';

export class TransportManager {
  private batch: BatchQueue;
  private reporter: Reporter;
  private retry: RetryQueue;
  private beacon: BeaconManager;

  constructor(config: ResolvedConfig) {
    this.reporter = new Reporter();
    this.retry = new RetryQueue({ maxRetries: config.maxRetries });
    this.beacon = new BeaconManager(config.endpoint);

    this.batch = new BatchQueue({
      maxSize: config.batchSize,
      interval: config.batchInterval,
      onFlush: (reports) => this.processBatch(reports),
    });

    this.beacon.setPayloadProvider(() => {
      const pending = this.batch.drain();
      if (pending.length === 0) return null;
      return JSON.stringify(pending);
    });
  }

  send(report: Report): void {
    this.batch.add(report);
  }

  flush(): void {
    this.batch.flush();
  }

  destroy(): void {
    this.batch.destroy();
    this.beacon.destroy();
  }

  private async processBatch(reports: Report[]): Promise<void> {
    if (reports.length === 0) return;
    await this.retry.execute(reports, (d) => this.reporter.dispatch(d));
  }
}

export type { Report } from './batch';
