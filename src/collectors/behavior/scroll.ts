import type { ScrollEvent } from '../../types/reports';

export class ScrollTracker {
  private events: ScrollEvent[] = [];
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

  drain(): ScrollEvent[] {
    const data = this.events;
    this.events = [];
    return data;
  }
}
