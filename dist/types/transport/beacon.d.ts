export declare class BeaconManager {
    private handlers;
    private pendingPayload;
    private endpoint;
    private sent;
    constructor(endpoint: string);
    /** 注册获取待发送数据的回调，TransportManager 在构造时注入 */
    setPayloadProvider(provider: () => string | null): void;
    destroy(): void;
    private setup;
    private sendBeacon;
}
