import { throttle } from '../../utils/throttle';
import { getTargetPath } from '../../utils/dom-path';
import type { ClickTrack, MoveFeatures, RawMouseMove } from '../../types/reports';

const MAX_MOVES = 2000;
const MAX_CLICKS = 500;
const WINDOW_MS = 60_000;
const PAUSE_MS = 200;
const STRAIGHT_COS = 0.98;

interface MoveSample {
  x: number;
  y: number;
  page_x: number;
  page_y: number;
  t: number;
  is_trusted: boolean;
}

export interface MouseDrainResult {
  clicks: ClickTrack[];
  features: MoveFeatures;
  rawMoves?: RawMouseMove[];
}

export class MouseTracker {
  private moves: MoveSample[] = [];
  private clicks: ClickTrack[] = [];
  private handlers: Array<{ event: string; handler: EventListener }> = [];

  start(): void {
    const trimMoves = (now: number) => {
      const cutoff = now - WINDOW_MS;
      let drop = 0;
      while (drop < this.moves.length && this.moves[drop].t < cutoff) drop++;
      if (drop > 0) this.moves.splice(0, drop);
      if (this.moves.length >= MAX_MOVES) {
        this.moves.splice(0, this.moves.length - MAX_MOVES + 1);
      }
    };

    const pushClick = (e: Event, type: ClickTrack['type']) => {
      const me = e as globalThis.MouseEvent;
      if (this.clicks.length >= MAX_CLICKS) {
        this.clicks.splice(0, this.clicks.length - MAX_CLICKS + 1);
      }
      const target = me.target as Element | null;
      this.clicks.push({
        t: Date.now(),
        type,
        x: me.clientX,
        y: me.clientY,
        page_x: me.pageX,
        page_y: me.pageY,
        viewport_w: window.innerWidth,
        viewport_h: window.innerHeight,
        dpr: window.devicePixelRatio || 1,
        target_tag: target?.tagName?.toLowerCase() ?? '',
        target_path: getTargetPath(target),
        is_trusted: e.isTrusted,
      });
    };

    const onMove = throttle((e: Event) => {
      const me = e as globalThis.MouseEvent;
      const now = Date.now();
      trimMoves(now);
      this.moves.push({
        x: me.clientX,
        y: me.clientY,
        page_x: me.pageX,
        page_y: me.pageY,
        t: now,
        is_trusted: e.isTrusted,
      });
    }, 50);

    const onClick = (e: Event) => pushClick(e, 'click');
    const onDown = (e: Event) => pushClick(e, 'down');
    const onUp = (e: Event) => pushClick(e, 'up');

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

  drain(includeRaw = false): MouseDrainResult {
    const clicks = this.clicks;
    const moves = this.moves;
    this.clicks = [];
    this.moves = [];

    const features = this.computeMoveFeatures(moves);
    const result: MouseDrainResult = { clicks, features };
    if (includeRaw) {
      result.rawMoves = moves.map(m => ({
        x: m.x,
        y: m.y,
        page_x: m.page_x,
        page_y: m.page_y,
        t: m.t,
        is_trusted: m.is_trusted,
      }));
    }
    return result;
  }

  private computeMoveFeatures(moves: MoveSample[]): MoveFeatures {
    const count = moves.length;
    if (count < 2) {
      return { count, avg_speed: 0, straight_ratio: 0, pause_count: 0, total_distance: 0 };
    }

    let totalDistance = 0;
    let pauseCount = 0;
    let straightSegments = 0;
    let totalSegments = 0;

    for (let i = 1; i < moves.length; i++) {
      const dx = moves[i].x - moves[i - 1].x;
      const dy = moves[i].y - moves[i - 1].y;
      const dist = Math.hypot(dx, dy);
      totalDistance += dist;
      if (moves[i].t - moves[i - 1].t > PAUSE_MS) pauseCount++;

      if (i >= 2) {
        const pdx = moves[i - 1].x - moves[i - 2].x;
        const pdy = moves[i - 1].y - moves[i - 2].y;
        const prev = Math.hypot(pdx, pdy);
        if (prev > 0 && dist > 0) {
          const cos = (dx * pdx + dy * pdy) / (prev * dist);
          if (cos > STRAIGHT_COS) straightSegments++;
          totalSegments++;
        }
      }
    }

    const durationMs = moves[moves.length - 1].t - moves[0].t;
    const avgSpeed = durationMs > 0 ? (totalDistance / durationMs) * 1000 : 0;
    const straightRatio = totalSegments > 0 ? straightSegments / totalSegments : 0;

    return {
      count,
      avg_speed: Math.round(avgSpeed),
      straight_ratio: Math.round(straightRatio * 1000) / 1000,
      pause_count: pauseCount,
      total_distance: Math.round(totalDistance),
    };
  }
}
