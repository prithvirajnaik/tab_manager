import { migrate, MigrationError, formatIssues } from './migrations';
import { SnapshotSchema, StoreSchema, type Snapshot, type Store } from './model';
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

export function createRepo(kv: KeyValueArea, now: Clock): Repo {
  const queue = createWriteQueue();

  async function load(): Promise<{ store: Store; raw: unknown; migratedFrom: number | null }> {
    const { [STORE_KEY]: raw } = await kv.get([STORE_KEY]);
    try {
      const store = migrate(raw);
      const rawVersion =
        raw && typeof raw === 'object' ? (raw as { schemaVersion?: unknown }).schemaVersion : null;
      const migratedFrom =
        raw !== undefined && raw !== null && rawVersion !== store.schemaVersion
          ? typeof rawVersion === 'number'
            ? rawVersion
            : 0
          : null;
      return { store, raw, migratedFrom };
    } catch (e) {
      if (e instanceof MigrationError) throw new StoreUnreadableError(e.message);
      throw e;
    }
  }

  async function loadSnapshots(): Promise<Snapshot[]> {
    const { [SNAPSHOTS_KEY]: raw } = await kv.get([SNAPSHOTS_KEY]);
    const parsed = SnapshotSchema.array().safeParse(raw);
    return parsed.success ? parsed.data : [];
  }

  async function write(
    next: Store,
    previous: Store,
    raw: unknown,
    migratedFrom: number | null,
    options: UpdateOptions,
  ) {
    const checked = StoreSchema.safeParse(next);
    if (!checked.success) throw new Error(`Refusing invalid write: ${formatIssues(checked.error)}`);
    const items: Record<string, unknown> = { [STORE_KEY]: checked.data };
    if (options.snapshot) {
      items[SNAPSHOTS_KEY] = pushSnapshot(await loadSnapshots(), previous.topics, now());
    }
    if (migratedFrom !== null) items[`store-backup-v${migratedFrom}`] = raw;
    await kv.set(items);
    return checked.data;
  }

  return {
    async read() {
      return (await load()).store;
    },

    update(fn, options = {}) {
      return queue.run(async () => {
        const { store, raw, migratedFrom } = await load();
        const next = await fn(structuredClone(store));
        return write(next, store, raw, migratedFrom, options);
      });
    },

    snapshots: loadSnapshots,

    restoreSnapshot(at) {
      return queue.run(async () => {
        const target = (await loadSnapshots()).find((s) => s.at === at);
        if (!target) throw new Error(`No snapshot at ${at}`);
        const { store, raw, migratedFrom } = await load();
        const next = { ...structuredClone(store), topics: structuredClone(target.topics) };
        return write(next, store, raw, migratedFrom, { snapshot: true });
      });
    },

    resetKeepingBackup() {
      return queue.run(async () => {
        const { [STORE_KEY]: raw } = await kv.get([STORE_KEY]);
        const backupKey = `store-backup-${now()}`;
        await kv.set({ [backupKey]: raw ?? null });
        await kv.set({ [STORE_KEY]: migrate(undefined) });
        return backupKey;
      });
    },
  };
}
