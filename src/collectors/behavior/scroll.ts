import type { ScrollSummary, RawScrollEvent } from '../../types/reports';

const MAX_EVENTS = 500;
const WINDOW_MS = 60_000;
const READ_STILL_MS = 300;

export interface ScrollDrainResult {
  summary: ScrollSummary;
  rawEvents?: RawScrollEvent[];
}

export class ScrollTracker {
  private events: RawScrollEvent[] = [];
  private lastTop = 0;
  private lastTime = 0;
  private handler: EventListener | null = null;

  start(): void {
    this.lastTop = window.scrollY || document.documentElement.scrollTop;

    const onScroll = (e: Event) => {
      const now = Date.now();
      if (now - this.lastTime < 100) return;
      this.lastTime = now;

      const top = window.scrollY || document.documentElement.scrollTop;
      const direction: 'up' | 'down' = top >= this.lastTop ? 'down' : 'up';
      const speed = Math.abs(top - this.lastTop);

      const cutoff = now - WINDOW_MS;
      let drop = 0;
      while (drop < this.events.length && this.events[drop].t < cutoff) drop++;
      if (drop > 0) this.events.splice(0, drop);
      if (this.events.length >= MAX_EVENTS) {
        this.events.splice(0, this.events.length - MAX_EVENTS + 1);
      }

      this.events.push({ t: now, top, speed, direction, is_trusted: e.isTrusted });
      this.lastTop = top;
    };

    this.handler = onScroll;
    window.addEventListener('scroll', this.handler, { passive: true });
  }

  stop(): void {
    if (this.handler) {
      window.removeEventListener('scroll', this.handler);
      this.handler = null;
    }
  }

  drain(includeRaw = false): ScrollDrainResult {
    const events = this.events;
    this.events = [];
    const summary = this.computeSummary(events);
    const result: ScrollDrainResult = { summary };
    if (includeRaw) result.rawEvents = events;
    return result;
  }

  private computeSummary(events: RawScrollEvent[]): ScrollSummary {
    if (events.length === 0) {
      return { max_depth: 0, total_scroll: 0, direction_changes: 0, duration: 0, read_time: 0 };
    }

    let maxDepth = 0;
    let totalScroll = 0;
    let changes = 0;
    let readTime = 0;
    let prevDir: 'up' | 'down' | null = null;

    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.top > maxDepth) maxDepth = ev.top;
      totalScroll += ev.speed;
      if (prevDir && prevDir !== ev.direction) changes++;
      prevDir = ev.direction;
      if (i > 0) {
        const gap = ev.t - events[i - 1].t;
        if (gap >= READ_STILL_MS) readTime += gap;
      }
    }

    const duration = events[events.length - 1].t - events[0].t;
    return {
      max_depth: maxDepth,
      total_scroll: totalScroll,
      direction_changes: changes,
      duration,
      read_time: readTime,
    };
  }
}
