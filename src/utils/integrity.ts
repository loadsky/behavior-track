import { sha256 } from 'js-sha256';
import stringify from 'fast-json-stable-stringify';

export function signReport<T extends Record<string, unknown>>(report: T): string {
  try {
    const { integrity_check: _, ...payload } = report;
    return sha256(stringify(payload));
  } catch {
    return '';
  }
}
