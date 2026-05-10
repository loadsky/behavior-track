import type { ClickTrack, MoveFeatures, RawMouseMove } from '../../types/reports';
export interface MouseDrainResult {
    clicks: ClickTrack[];
    features: MoveFeatures;
    rawMoves?: RawMouseMove[];
}
export declare class MouseTracker {
    private moves;
    private clicks;
    private handlers;
    start(): void;
    stop(): void;
    drain(includeRaw?: boolean): MouseDrainResult;
    private computeMoveFeatures;
}
