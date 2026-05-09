export class BeaconManager {
  private handlers: Array<{ event: string; target: EventTarget; handler: EventListener }> = [];
  private pendingPayload: (() => string | null) | null = null;
  private endpoint: string;
  private sent = false;

  constructor(endpoint: string) {
    this.endpoint = endpoint;
    this.setup();
  }

  /** 注册获取待发送数据的回调，TransportManager 在构造时注入 */
  setPayloadProvider(provider: () => string | null): void {
    this.pendingPayload = provider;
  }

  destroy(): void {
    for (const { event, target, handler } of this.handlers) {
      target.removeEventListener(event, handler);
    }
    this.handlers = [];
    this.pendingPayload = null;
  }

  private setup(): void {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') {
        this.sendBeacon();
      }
    };

    const onPageHide = () => {
      this.sendBeacon();
    };

    this.handlers = [
      { event: 'visibilitychange', target: document, handler: onHidden },
      { event: 'pagehide', target: window, handler: onPageHide },
    ];

    for (const { event, target, handler } of this.handlers) {
      target.addEventListener(event, handler);
    }
  }

  private sendBeacon(): void {
    if (this.sent) return;
    const payload = this.pendingPayload?.();
    if (!payload) return;

    this.sent = true;

    if (navigator.sendBeacon) {
      const blob = new Blob([payload], { type: 'application/json' });
      navigator.sendBeacon(this.endpoint, blob);
    } else {
      // fallback: 同步 XHR（sendBeacon 不可用时的兜底）
      try {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', this.endpoint, false);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(payload);
      } catch { /* 页面卸载中不处理异常 */ }
    }
  }
}
