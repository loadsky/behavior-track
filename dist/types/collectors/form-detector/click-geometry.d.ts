import type { ClickRecord } from './types';
export interface MouseMoveSnapshot {
    x: number;
    y: number;
    t: number;
}
export declare function hadPrecedingMove(me: MouseEvent, lastMouseMove: MouseMoveSnapshot | null, now: number): boolean;
export declare function buildClickRecord(me: MouseEvent, target: Element, lastMouseMove: MouseMoveSnapshot | null, now: number): ClickRecord;
export declare function isCenterClick(clientX: number, clientY: number, rect: DOMRect, threshold?: number): boolean;
export declare function isCornerClick(clientX: number, clientY: number, rect: DOMRect, threshold?: number): boolean;
export declare function centerOffset(clientX: number, clientY: number, rect: DOMRect): {
    dx: number;
    dy: number;
};
