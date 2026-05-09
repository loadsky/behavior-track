import { sha256 } from 'js-sha256';

export function signReport<T extends Record<string, unknown>>(report: T): string {
  try {
    const { integrity_check: _, ...payload } = report;
    return sha256(JSON.stringify(payload, Object.keys(payload).sort()));
  } catch {
    return '';
  }
}
