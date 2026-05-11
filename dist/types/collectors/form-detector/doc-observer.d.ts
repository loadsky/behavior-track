type DocObserverSub = (root: Document) => void;
export declare function subscribeDocObserver(sub: DocObserverSub): () => void;
export {};
