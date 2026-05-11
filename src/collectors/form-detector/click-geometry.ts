import type { ClickRecord } from './types';

export interface MouseMoveSnapshot {
  x: number;
  y: number;
  // performance.now() 时间戳
  t: number;
}

// 50px: 鼠标最近移动位置与点击位置的容许偏差
const MOVE_DISTANCE_THRESHOLD = 50;
// 200ms: 最近一次鼠标移动到点击发生的最大时间差
const MOVE_TIME_THRESHOLD = 200;
// 3px: 判定点击落在元素中心或四角的容许误差，真实用户几乎不会精确命中
const DEFAULT_CENTER_CORNER_THRESHOLD = 3;

// 判断点击前是否存在真实鼠标移动轨迹（距离和时间都在阈值内）
export function hadPrecedingMove(me: MouseEvent, lastMouseMove: MouseMoveSnapshot | null, now: number): boolean {
  if (!lastMouseMove) return false;
  return (
    Math.abs(lastMouseMove.x - me.clientX) < MOVE_DISTANCE_THRESHOLD &&
    Math.abs(lastMouseMove.y - me.clientY) < MOVE_DISTANCE_THRESHOLD &&
    (now - lastMouseMove.t) < MOVE_TIME_THRESHOLD
  );
}

// 从 MouseEvent 构建完整的点击记录，捕获所有坐标系信息用于后续 CDP 指纹分析
export function buildClickRecord(me: MouseEvent, target: Element, lastMouseMove: MouseMoveSnapshot | null, now: number): ClickRecord {
  return {
    x: me.clientX,
    y: me.clientY,
    t: Date.now(),
    isTrusted: me.isTrusted,
    offsetX: me.offsetX,
    offsetY: me.offsetY,
    pageX: me.pageX,
    pageY: me.pageY,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    target: (target as HTMLElement).tagName,
    hadPrecedingMove: hadPrecedingMove(me, lastMouseMove, now),
  };
}

// 判断点击是否落在元素正中心（±threshold px）
export function isCenterClick(clientX: number, clientY: number, rect: DOMRect, threshold = DEFAULT_CENTER_CORNER_THRESHOLD): boolean {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  return Math.abs(clientX - cx) <= threshold && Math.abs(clientY - cy) <= threshold;
}

// 判断点击是否落在元素四角之一（±threshold px），自动化工具常使用角落坐标
export function isCornerClick(clientX: number, clientY: number, rect: DOMRect, threshold = DEFAULT_CENTER_CORNER_THRESHOLD): boolean {
  const nearTL = clientX <= rect.left + threshold && clientY <= rect.top + threshold;
  const nearTR = clientX >= rect.right - threshold && clientY <= rect.top + threshold;
  const nearBL = clientX <= rect.left + threshold && clientY >= rect.bottom - threshold;
  const nearBR = clientX >= rect.right - threshold && clientY >= rect.bottom - threshold;
  return nearTL || nearTR || nearBL || nearBR;
}

// 计算点击位置相对元素中心的偏移，用于生成 clickOffsetKey 检测不同元素是否使用了相同偏移
export function centerOffset(clientX: number, clientY: number, rect: DOMRect): { dx: number; dy: number } {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  return { dx: Math.abs(clientX - cx), dy: Math.abs(clientY - cy) };
}
