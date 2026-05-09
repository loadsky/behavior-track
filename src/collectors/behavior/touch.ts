import type { TouchEvent as TouchEvt } from '../../types/reports';

export class TouchTracker {
  private events: TouchEvt[] = [];
  private handlers: Array<{ event: string; handler: EventListener }> = [];

  start(): void {
    const onTouch = (e: Event) => {
      const te = e as globalThis.TouchEvent;
      if (!te.touches || te.touches.length === 0) return;
      const touch = te.touches[0];
      this.events.push({
        x: touch.clientX,
        y: touch.clientY,
        t: Date.now(),
        pressure: (touch as unknown as Record<string, number>).force || 0,
        radius: touch.radiusX || 0,
        is_trusted: e.isTrusted,
      });
    };

    this.handlers = [
      { event: 'touchstart', handler: onTouch },
      { event: 'touchmove', handler: onTouch },
      { event: 'touchend', handler: onTouch },
    ];

    for (const { event, handler } of this.handlers) {
      document.addEventListener(event, handler, { passive: true });
    }
  }

  stop(): void {
    for (const { event, handler } of this.handlers) {
      document.removeEventListener(event, handler);
    }
    this.handlers = [];
  }

  drain(): TouchEvt[] {
    const data = this.events;
    this.events = [];
    return data;
  }
}
