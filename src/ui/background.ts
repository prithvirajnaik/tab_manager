/**
 * The home page background image the user picked. It is a display preference, so it stays in
 * this page's IndexedDB (too big for localStorage), never in the store, and is not exported.
 */
export const MAX_BACKGROUND_BYTES = 8 * 1024 * 1024;

export type BackgroundStore = {
  get(): Promise<Blob | null>;
  set(image: Blob): Promise<void>;
  clear(): Promise<void>;
};

/** Why a file cannot be used, or null when it can. SVG is refused: it can carry scripts. */
export function backgroundProblem(file: Pick<File, 'type' | 'size'>): string | null {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') {
    return 'Choose a PNG, JPEG, WebP or GIF image.';
  }
  if (file.size > MAX_BACKGROUND_BYTES) {
    return `That image is larger than ${MAX_BACKGROUND_BYTES / 1024 / 1024} MB. Choose a smaller one.`;
  }
  return null;
}

const DB = 'tab-topics-display';
const STORE = 'images';
const KEY = 'home-background';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest<T>) {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = work(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export const idbBackground: BackgroundStore = {
  async get() {
    try {
      const value = await run('readonly', (s) => s.get(KEY));
      return value instanceof Blob ? value : null;
    } catch {
      return null;
    }
  },
  async set(image) {
    await run('readwrite', (s) => s.put(image, KEY));
  },
  async clear() {
    await run('readwrite', (s) => s.delete(KEY));
  },
};
