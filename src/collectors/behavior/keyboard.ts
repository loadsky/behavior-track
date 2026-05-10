import type { KeyboardEvent as KBEvent } from '../../types/reports';

export class KeyboardTracker {
  private stream: KBEvent[] = [];
  private lastKeyTime = 0;
  private keyCount = 0;
  private trustedCount = 0;
  private intervalSum = 0;
  private holdStart = 0;
  private holdSum = 0;
  private handlers: Array<{ event: string; handler: EventListener }> = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  start(): void {
    const onKeyDown = (e: Event) => {
      const ke = e as KeyboardEvent;
      if (!ke.key || ke.key.length !== 1) return;
      if (ke.isComposing) return;
      const now = Date.now();
      if (this.lastKeyTime > 0) {
        this.intervalSum += now - this.lastKeyTime;
      }
      this.lastKeyTime = now;
      this.holdStart = now;
      this.keyCount++;
      if (e.isTrusted) this.trustedCount++;
    };

    const onKeyUp = (e: Event) => {
      const ke = e as KeyboardEvent;
      if (!ke.key || ke.key.length !== 1) return;
      if (ke.isComposing) return;
      if (this.holdStart > 0) {
        this.holdSum += Date.now() - this.holdStart;
        this.holdStart = 0;
      }
    };

    this.handlers = [
      { event: 'keydown', handler: onKeyDown as EventListener },
      { event: 'keyup', handler: onKeyUp as EventListener },
    ];

    for (const { event, handler } of this.handlers) {
      document.addEventListener(event, handler, { passive: true });
    }

    this.flushTimer = setInterval(() => this.aggregate(), 1000);
  }

  stop(): void {
    for (const { event, handler } of this.handlers) {
      document.removeEventListener(event, handler);
    }
    this.handlers = [];
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  drain(): KBEvent[] {
    this.aggregate();
    const data = this.stream;
    this.stream = [];
    return data;
  }

  private aggregate(): void {
    if (this.keyCount === 0) return;
    this.stream.push({
      t: Date.now(),
      key_count: this.keyCount,
      trusted_count: this.trustedCount,
      interval_avg: this.keyCount > 1 ? Math.round(this.intervalSum / (this.keyCount - 1)) : 0,
      hold_avg: Math.round(this.holdSum / Math.max(this.keyCount, 1)),
    });
    this.keyCount = 0;
    this.trustedCount = 0;
    this.intervalSum = 0;
    this.holdSum = 0;
    this.lastKeyTime = 0;
  }
}
