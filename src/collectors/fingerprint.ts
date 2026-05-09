import FingerprintJS from '@fingerprintjs/fingerprintjs';

let agentPromise: ReturnType<typeof FingerprintJS.load> | null = null;

export async function getFingerprint(): Promise<{ visitorId: string; confidence: number }> {
  try {
    if (!agentPromise) {
      agentPromise = FingerprintJS.load();
    }
    const agent = await agentPromise;
    const result = await agent.get();
    return {
      visitorId: result.visitorId,
      confidence: result.confidence.score,
    };
  } catch {
    return { visitorId: '', confidence: 0 };
  }
}
