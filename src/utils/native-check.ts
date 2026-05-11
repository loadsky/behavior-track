export function isNativeFn(fn: unknown): boolean {
  if (typeof fn !== 'function') return false;
  return /\[native code\]/.test(Function.prototype.toString.call(fn));
}

export function isGetterTampered(obj: object, prop: string): boolean {
  const desc = Object.getOwnPropertyDescriptor(obj, prop);
  if (!desc) return false;
  if (desc.get) return !isNativeFn(desc.get);
  if ('value' in desc) return true;
  return false;
}
