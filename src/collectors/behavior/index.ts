import type { ResolvedConfig } from '../../types/config';
import type { MouseTrack, KeyboardEvent, ScrollEvent, TouchEvent } from '../../types/reports';
import { MouseTracker } from './mouse';
import { KeyboardTracker } from './keyboard';
import { ScrollTracker } from './scroll';
import { TouchTracker } from './touch';

export interface BehaviorStream {
  mouse_tracks: MouseTrack[];
  keyboard_stream: KeyboardEvent[];
  scroll_events: ScrollEvent[];
  touch_events: TouchEvent[];
}

export class BehaviorManager {
  private mouse: MouseTracker;
  private keyboard: KeyboardTracker;
  private scroll: ScrollTracker;
  private touch: TouchTracker;
  private _config: ResolvedConfig;

  constructor(config: ResolvedConfig) {
    this._config = config;
    this.mouse = new MouseTracker();
    this.keyboard = new KeyboardTracker();
    this.scroll = new ScrollTracker();
    this.touch = new TouchTracker();
  }

  start(): void {
    if (this.shouldSample()) {
      this.mouse.start();
      this.keyboard.start();
      this.scroll.start();
      this.touch.start();
    }
  }

  stop(): void {
    this.mouse.stop();
    this.keyboard.stop();
    this.scroll.stop();
    this.touch.stop();
  }

  drain(): BehaviorStream {
    return {
      mouse_tracks: this.mouse.drain(),
      keyboard_stream: this.keyboard.drain(),
      scroll_events: this.scroll.drain(),
      touch_events: this.touch.drain(),
    };
  }

  private shouldSample(): boolean {
    return Math.random() < this._config.behaviorSampleRate;
  }
}
