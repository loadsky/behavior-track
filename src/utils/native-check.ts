const NATIVE_FN_RE = /^function\s+\S.*\{\s*\[native code\]\s*\}$/;

let _iframeToString: (() => string) | null | undefined;

function getIframeToString(): () => string {
  if (_iframeToString !== undefined) return _iframeToString!;
  try {
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    document.body.appendChild(iframe);
    const cw = iframe.contentWindow;
    if (cw) {
      _iframeToString = ((cw as unknown as { Function: typeof Function }).Function).prototype.toString;
    }
    document.body.removeChild(iframe);
  } catch { /* iframe blocked */ }
  return (_iframeToString ??= Function.prototype.toString);
}

export function isNativeFn(fn: unknown): boolean {
  if (typeof fn !== 'function') return false;
  return NATIVE_FN_RE.test(getIframeToString().call(fn));
}

export function isGetterTampered(obj: object, prop: string): boolean {
  const desc = Object.getOwnPropertyDescriptor(obj, prop);
  if (!desc) return false;
  if (desc.get) return !isNativeFn(desc.get);
  if ('value' in desc) return true;
  return false;
}
