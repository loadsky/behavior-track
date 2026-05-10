export interface WebRTCInfo {
    ips: string[];
}
export declare function collectWebRTC(): Promise<WebRTCInfo>;
