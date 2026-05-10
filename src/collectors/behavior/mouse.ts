import { throttle } from '../../utils/throttle';
import type { MouseTrack } from '../../types/reports';

const MAX_TRACKS = 2000;
const WINDOW_MS = 60_000;

export class MouseTracker {
  private tracks: MouseTrack[] = [];
  private handlers: Array<{ event: string; handler: EventListener }> = [];

  start(): void {
    const push = (e: Event, type: MouseTrack['type']) => {
      const me = e as globalThis.MouseEvent;
      const now = Date.now();
      const cutoff = now - WINDOW_MS;
      let drop = 0;
      while (drop < this.tracks.length && this.tracks[drop].t < cutoff) drop++;
      if (drop > 0) this.tracks.splice(0, drop);
      if (this.tracks.length >= MAX_TRACKS) {
        this.tracks.splice(0, this.tracks.length - MAX_TRACKS + 1);
      }
      this.tracks.push({ x: me.clientX, y: me.clientY, t: now, type, is_trusted: e.isTrusted });
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
