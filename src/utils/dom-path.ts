const MAX_DEPTH = 5;
const MAX_LEN = 120;

export function getTargetPath(el: Element | null, maxDepth = MAX_DEPTH): string {
  if (!el) return '';
  const parts: string[] = [];
  let cur: Element | null = el;
  let depth = 0;
  while (cur && cur.nodeType === 1 && depth < maxDepth) {
    const tag = cur.tagName.toLowerCase();
    const parent: Element | null = cur.parentElement;
    if (!parent || cur === document.documentElement) {
      parts.unshift(tag);
      break;
    }
    const idx = Array.prototype.indexOf.call(parent.children, cur) + 1;
    parts.unshift(`${tag}:nth-child(${idx})`);
    cur = parent;
    depth++;
  }
  const path = parts.join('>');
  return path.length > MAX_LEN ? path.slice(-MAX_LEN) : path;
}
