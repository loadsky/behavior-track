import { safeExec } from '../../utils/safe-exec';

const SCOPE = 'worker_detect';

export interface WorkerResult {
  is_tampered: boolean;
  is_cdp: boolean;
  signals: string[];
}

export function detectWorkerConsistency(): Promise<WorkerResult> {
  return new Promise((resolve) => {
    const done = (result: WorkerResult) => resolve(result);
    const timeout = setTimeout(() => {
      done({ is_tampered: false, is_cdp: false, signals: [] });
    }, 5000);

    safeExec(() => {
      const workerCode = `
        const result = {};
        result.webdriver = navigator.webdriver || false;
        result.userAgent = navigator.userAgent;
        result.hardwareConcurrency = navigator.hardwareConcurrency;
        result.platform = navigator.platform;
        try {
          result.languages = JSON.stringify(navigator.languages);
        } catch(_) { result.languages = '[]'; }
        try {
          let triggered = false;
          const orig = Error.prepareStackTrace;
          Error.prepareStackTrace = function() { triggered = true; return orig; };
          console.debug(new Error(''));
          Error.prepareStackTrace = orig;
          result.cdp = triggered;
        } catch(_) { result.cdp = false; }
        self.postMessage(result);
      `;
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      const blobUrl = URL.createObjectURL(blob);
      const worker = new Worker(blobUrl);

      worker.onmessage = (e) => {
        clearTimeout(timeout);
        const r = e.data;
        const signals: string[] = [];
        URL.revokeObjectURL(blobUrl);

        if (r.webdriver !== (navigator.webdriver || false)) signals.push('worker_webdriver_mismatch');
        if (r.userAgent !== navigator.userAgent) signals.push('worker_ua_mismatch');
        if (r.hardwareConcurrency !== navigator.hardwareConcurrency) signals.push('worker_hw_mismatch');
        if (r.platform !== navigator.platform) signals.push('worker_platform_mismatch');

        try {
          if (JSON.stringify(navigator.languages) !== r.languages) signals.push('worker_languages_mismatch');
        } catch { /* ignore */ }

        if (r.cdp) signals.push('cdp_worker');

        done({
          is_tampered: !(signals.length === 0 || (signals.length === 1 && signals[0] === 'cdp_worker')),
          is_cdp: r.cdp === true,
          signals,
        });

        worker.terminate();
      };

      worker.onerror = () => {
        clearTimeout(timeout);
        done({ is_tampered: false, is_cdp: false, signals: [] });
        worker.terminate();
      };
    }, undefined, SCOPE);
  });
}
