const counters: Record<string, number> = {};

export function incErrorCount(scope: string): void {
  counters[scope] = (counters[scope] ?? 0) + 1;
}

export function snapshotErrorCounts(): Record<string, number> {
  return { ...counters };
}

export function resetErrorCounts(): void {
  for (const k of Object.keys(counters)) delete counters[k];
}
