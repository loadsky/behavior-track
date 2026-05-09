import { generateUUID } from '../utils/generate-id';

const DB_NAME = 'BehaviorTrack';
const DB_VERSION = 1;
const STORE_NAME = 'DeviceInfo';
const KEY = 'uuid';

function readFromLocalStorage(): string | null {
  try {
    return localStorage.getItem('__bt_did');
  } catch {
    return null;
  }
}

function writeToLocalStorage(id: string): void {
  try {
    localStorage.setItem('__bt_did', id);
  } catch { /* quota exceeded or private mode */ }
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE_NAME)) {
          req.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch {
      reject(new Error('indexedDB not available'));
    }
  });
}

async function readFromIndexedDB(): Promise<string | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(KEY);
        req.onsuccess = () => {
          resolve(req.result?.value ?? null);
          db.close();
        };
        req.onerror = () => {
          resolve(null);
          db.close();
        };
      } catch {
        resolve(null);
        db.close();
      }
    });
  } catch {
    return null;
  }
}

async function writeToIndexedDB(id: string): Promise<void> {
  try {
    const db = await openDB();
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put({ key: KEY, value: id });
    } finally {
      db.close();
    }
  } catch { /* IndexedDB not available */ }
}

export async function getDeviceId(): Promise<string> {
  // 1. localStorage (最快)
  const lsId = readFromLocalStorage();
  if (lsId) {
    // 异步修复 IndexedDB（可能被单独清除）
    readFromIndexedDB().then((idbId) => {
      if (!idbId) writeToIndexedDB(lsId);
    });
    return lsId;
  }

  // 2. IndexedDB (更持久)
  const idbId = await readFromIndexedDB();
  if (idbId) {
    writeToLocalStorage(idbId);
    return idbId;
  }

  // 3. 新设备 — 生成 UUID 并多重写入
  const id = generateUUID();
  writeToLocalStorage(id);
  writeToIndexedDB(id);
  return id;
}
