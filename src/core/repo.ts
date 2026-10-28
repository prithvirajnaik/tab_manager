import { migrate, migrateTopics, MigrationError, formatIssues } from './migrations';
import { CURRENT_SCHEMA_VERSION, StoreSchema, type Snapshot, type Store } from './model';
import type { Clock, KeyValueArea } from './ports';
import { createWriteQueue } from './queue';
import { pushSnapshot } from './snapshots';

export const STORE_KEY = 'store';
export const SNAPSHOTS_KEY = 'snapshots';

export class StoreUnreadableError extends Error {
  override name = 'StoreUnreadableError';
}

export type UpdateOptions = { snapshot?: boolean };

export type Repo = {
  read(): Promise<Store>;
  /** Read-modify-write through the single write queue. `fn` receives a private copy. */
  update(fn: (store: Store) => Store | Promise<Store>, options?: UpdateOptions): Promise<Store>;
  snapshots(): Promise<Snapshot[]>;
  restoreSnapshot(at: number): Promise<Store>;
  /** Copies whatever is stored to a backup key, then starts fresh. Returns the backup key. */
  resetKeepingBackup(): Promise<string>;
};

type Loaded = { store: Store; raw: unknown; migratedFrom: number | null };
type LoadedSnapshots = { snapshots: Snapshot[]; unreadable: unknown | null };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The only writer of the store. The service worker owns a single instance; extension pages
 * read storage directly and send commands, so every write goes through this queue.
 */
export function createRepo(kv: KeyValueArea, now: Clock): Repo {
  const queue = createWriteQueue();

  async function load(): Promise<Loaded> {
    const { [STORE_KEY]: raw } = await kv.get([STORE_KEY]);
    try {
      const store = migrate(raw);
      const rawVersion = isRecord(raw) ? (raw.schemaVersion ?? 0) : null;
      const migratedFrom =
        rawVersion !== null && rawVersion !== store.schemaVersion ? Number(rawVersion) : null;
      return { store, raw, migratedFrom };
    } catch (e) {
      if (e instanceof MigrationError) throw new StoreUnreadableError(e.message);
      throw e;
    }
  }

  /** Reads snapshots one by one, migrating old ones; unreadable entries are set aside. */
  async function loadSnapshots(): Promise<LoadedSnapshots> {
    const { [SNAPSHOTS_KEY]: raw } = await kv.get([SNAPSHOTS_KEY]);
    if (raw === undefined) return { snapshots: [], unreadable: null };
    const envelope = Array.isArray(raw)
      ? { schemaVersion: CURRENT_SCHEMA_VERSION, items: raw }
      : raw;
    if (
      !isRecord(envelope) ||
      !Array.isArray(envelope.items) ||
      typeof envelope.schemaVersion !== 'number'
    ) {
      return { snapshots: [], unreadable: raw };
    }
    const snapshots: Snapshot[] = [];
    const bad: unknown[] = [];
    for (const item of envelope.items) {
      try {
        if (!isRecord(item) || typeof item.at !== 'number') throw new MigrationError('bad entry');
        snapshots.push({ at: item.at, topics: migrateTopics(item.topics, envelope.schemaVersion) });
      } catch (e) {
        if (!(e instanceof MigrationError)) throw e;
        bad.push(item);
      }
    }
    return { snapshots, unreadable: bad.length ? bad : null };
  }

  async function freeKey(prefix: string): Promise<string> {
    const base = `${prefix}-${now()}`;
    for (let i = 0; ; i++) {
      const key = i === 0 ? base : `${base}-${i}`;
      const existing = await kv.get([key]);
      if (!(key in existing)) return key;
    }
  }

  async function write(next: Store, loaded: Loaded, options: UpdateOptions) {
    const checked = StoreSchema.safeParse(next);
    if (!checked.success) throw new Error(`Refusing invalid write: ${formatIssues(checked.error)}`);
    const unchanged = JSON.stringify(checked.data) === JSON.stringify(loaded.store);
    if (unchanged && !options.snapshot && loaded.migratedFrom === null) return checked.data;

    const items: Record<string, unknown> = { [STORE_KEY]: checked.data };
    if (options.snapshot) {
      const { snapshots, unreadable } = await loadSnapshots();
      items[SNAPSHOTS_KEY] = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        items: pushSnapshot(snapshots, loaded.store.topics, now()),
      };
      if (unreadable !== null) items[await freeKey('snapshots-unreadable')] = unreadable;
    }
    if (loaded.migratedFrom !== null) {
      items[await freeKey(`store-backup-v${loaded.migratedFrom}`)] = loaded.raw;
    }
    await kv.set(items);
    return checked.data;
  }

  return {
    async read() {
      return (await load()).store;
    },

    update(fn, options = {}) {
      return queue.run(async () => {
        const loaded = await load();
        const next = await fn(structuredClone(loaded.store));
        return write(next, loaded, options);
      });
    },

    async snapshots() {
      return (await loadSnapshots()).snapshots;
    },

    restoreSnapshot(at) {
      return queue.run(async () => {
        const loaded = await load();
        const target = (await loadSnapshots()).snapshots.find((s) => s.at === at);
        if (!target) throw new Error(`No snapshot at ${at}`);
        // Window ids in a snapshot belong to whatever was open when it was taken.
        const topics = target.topics.map((t) => ({ ...t, windowId: null }));
        return write({ ...loaded.store, topics }, loaded, { snapshot: true });
      });
    },

    resetKeepingBackup() {
      return queue.run(async () => {
        const { [STORE_KEY]: raw } = await kv.get([STORE_KEY]);
        const backupKey = await freeKey('store-backup');
        await kv.set({ [backupKey]: raw ?? null });
        await kv.set({ [STORE_KEY]: migrate(undefined) });
        return backupKey;
      });
    },
  };
}
