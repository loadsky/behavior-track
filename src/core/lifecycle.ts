export type SDKState = 'idle' | 'active' | 'paused' | 'destroyed';

export class Lifecycle {
  private _state: SDKState = 'idle';

  get state(): SDKState {
    return this._state;
  }

  activate(): void {
    if (this._state === 'idle') {
      this._state = 'active';
    }
  }

  pause(): void {
    if (this._state === 'active') {
      this._state = 'paused';
    }
  }

  resume(): void {
    if (this._state === 'paused') {
      this._state = 'active';
    }
  }

  destroy(): void {
    this._state = 'destroyed';
  }

  isActive(): boolean {
    return this._state === 'active';
  }
}
