import { incErrorCount } from './diagnostics';

export function safeExec<T>(fn: () => T, fallback: T, scope?: string): T {
  try {
    return fn();
  } catch {
    if (scope) incErrorCount(scope);
    return fallback;
  }
}

export async function safeExecAsync<T>(fn: () => Promise<T>, fallback: T, scope?: string): Promise<T> {
  try {
    return await fn();
  } catch {
    if (scope) incErrorCount(scope);
    return fallback;
  }
}
