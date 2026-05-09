import { safeExecAsync } from '../utils/safe-exec';

export interface WebRTCInfo {
  ips: string[];
}

export async function collectWebRTC(): Promise<WebRTCInfo> {
  return safeExecAsync(async () => {
    const result: WebRTCInfo = { ips: [] };

    const pc = new RTCPeerConnection();

    const ipPromise = new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        pc.close();
        resolve();
      }, 3000);

      pc.onicecandidate = (e) => {
        if (!e.candidate) {
          clearTimeout(timeout);
          pc.close();
          resolve();
          return;
        }
        const candidate = e.candidate.candidate;
        const ipRegex = /\b(\d{1,3}\.){3}\d{1,3}\b/;
        const match = ipRegex.exec(candidate);
        if (match && !result.ips.includes(match[0])) {
          result.ips.push(match[0]);
        }
      };
    });

    pc.createDataChannel('');
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    await ipPromise;

    return result;
  }, { ips: [] });
}
