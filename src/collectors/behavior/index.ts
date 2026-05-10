import type { ResolvedConfig } from '../../types/config';
import type { BehaviorStream } from '../../types/reports';
import { MouseTracker } from './mouse';
import { KeyboardTracker } from './keyboard';
import { ScrollTracker } from './scroll';
import { TouchTracker } from './touch';

export class BehaviorManager {
  private mouse: MouseTracker;
  private keyboard: KeyboardTracker;
  private scroll: ScrollTracker;
  private touch: TouchTracker;
  private _config: ResolvedConfig;
  private _sampled: boolean | null = null;

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

  drain(options: { includeRaw: boolean } = { includeRaw: false }): BehaviorStream {
    const mouse = this.mouse.drain(options.includeRaw);
    const scroll = this.scroll.drain(options.includeRaw);
    const stream: BehaviorStream = {
      click_tracks: mouse.clicks,
      move_features: mouse.features,
      scroll_summary: scroll.summary,
      keyboard_stream: this.keyboard.drain(),
      touch_events: this.touch.drain(),
    };
    if (options.includeRaw) {
      stream.raw_on_risk = {
        mouse_moves: mouse.rawMoves ?? [],
        scroll_events: scroll.rawEvents ?? [],
        trigger_score: 0,
      };
    }
    this._sampled = null;
    return stream;
  }

  private shouldSample(): boolean {
    if (this._sampled === null) {
      this._sampled = Math.random() < this._config.behaviorSampleRate;
    }
    return this._sampled;
  }
}
