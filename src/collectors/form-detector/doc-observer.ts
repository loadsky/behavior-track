import { safeExec } from '../../utils/safe-exec';

const SCOPE = 'form_detector';

type DocObserverSub = (root: Document) => void;

// 全局单例 MutationObserver，多个 FormDetector 实例共享以降低开销
let sharedDocObserver: MutationObserver | null = null;
const docObserverSubs = new Set<DocObserverSub>();

// 订阅 document 级 DOM 变更通知，返回取消订阅函数；最后一个订阅者取消时自动断开 observer
export function subscribeDocObserver(sub: DocObserverSub): () => void {
  docObserverSubs.add(sub);
  if (!sharedDocObserver && typeof MutationObserver !== 'undefined') {
    sharedDocObserver = new MutationObserver(() => {
      for (const s of docObserverSubs) {
        safeExec(() => s(document), undefined, SCOPE);
      }
    });
    sharedDocObserver.observe(document.documentElement, { childList: true, subtree: true });
  }
  return () => {
    docObserverSubs.delete(sub);
    if (docObserverSubs.size === 0 && sharedDocObserver) {
      sharedDocObserver.disconnect();
      sharedDocObserver = null;
    }
  };
}
