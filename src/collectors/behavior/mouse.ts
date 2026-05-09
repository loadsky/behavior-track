import { throttle } from '../../utils/throttle';
import type { MouseTrack } from '../../types/reports';

export class MouseTracker {
  private tracks: MouseTrack[] = [];
  private handlers: Array<{ event: string; handler: EventListener }> = [];

  start(): void {
    const push = (e: Event, type: MouseTrack['type']) => {
      const me = e as globalThis.MouseEvent;
      this.tracks.push({ x: me.clientX, y: me.clientY, t: Date.now(), type, is_trusted: e.isTrusted });
    };

    const onMove = throttle((e: Event) => push(e, 'move'), 50);
    const onClick = (e: Event) => push(e, 'click');
    const onDown = (e: Event) => push(e, 'down');
    const onUp = (e: Event) => push(e, 'up');

    this.handlers = [
      { event: 'mousemove', handler: onMove as EventListener },
      { event: 'click', handler: onClick as EventListener },
      { event: 'mousedown', handler: onDown as EventListener },
      { event: 'mouseup', handler: onUp as EventListener },
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

  drain(): MouseTrack[] {
    const data = this.tracks;
    this.tracks = [];
    return data;
  }
}
