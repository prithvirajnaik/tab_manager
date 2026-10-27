import { createRepo, StoreUnreadableError, STORE_KEY, SNAPSHOTS_KEY } from '../../src/core/repo';
import { CURRENT_SCHEMA_VERSION, emptyStore } from '../../src/core/model';
import { MAX_SNAPSHOTS } from '../../src/core/snapshots';
import { memoryKv } from './memoryKv';
import { store, topic } from './factories';

const clock = (start = 1000) => {
  let t = start;
  return () => t++;
};

describe('repo', () => {
  it('reads an empty store when nothing is saved, without writing', async () => {
    const kv = memoryKv();
    const repo = createRepo(kv, clock());
    expect(await repo.read()).toEqual(emptyStore());
    expect(kv.writes).toBe(0);
  });

  it('serializes concurrent updates so none are lost', async () => {
    const kv = memoryKv();
    const repo = createRepo(kv, clock());
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        repo.update((s) => {
          s.topics.push(topic({ id: `t${i}` }));
          return s;
        }),
      ),
    );
    const saved = await repo.read();
    expect(saved.topics.map((t) => t.id).sort()).toEqual(
      Array.from({ length: 10 }, (_, i) => `t${i}`).sort(),
    );
  });

  it('takes a snapshot of the previous topics before a bulk change', async () => {
    const kv = memoryKv({ [STORE_KEY]: store({ topics: [topic({ name: 'old' })] }) });
    const repo = createRepo(kv, clock(500));
    await repo.update(
      (s) => {
        s.topics = [];
        return s;
      },
      { snapshot: true },
    );
    const snaps = await repo.snapshots();
    expect(snaps).toHaveLength(1);
    expect(snaps[0]?.topics[0]?.name).toBe('old');
    expect((await repo.read()).topics).toEqual([]);
  });

  it('caps snapshots', async () => {
    const repo = createRepo(memoryKv(), clock());
    for (let i = 0; i < MAX_SNAPSHOTS + 2; i++) await repo.update((s) => s, { snapshot: true });
    expect(await repo.snapshots()).toHaveLength(MAX_SNAPSHOTS);
  });

  it('restores a snapshot after snapshotting the current state', async () => {
    const kv = memoryKv({ [STORE_KEY]: store({ topics: [topic({ name: 'v1' })] }) });
    const repo = createRepo(kv, clock(100));
    await repo.update(
      (s) => {
        s.topics = [topic({ name: 'v2' })];
        return s;
      },
      { snapshot: true },
    );
    const [first] = await repo.snapshots();
    await repo.restoreSnapshot(first!.at);
    expect((await repo.read()).topics.map((t) => t.name)).toEqual(['v1']);
    expect((await repo.snapshots())[0]?.topics[0]?.name).toBe('v2');
    await expect(repo.restoreSnapshot(-1)).rejects.toThrow();
  });

  it('refuses to write an invalid store and leaves storage untouched', async () => {
    const kv = memoryKv({ [STORE_KEY]: store({ topics: [topic({ name: 'keep' })] }) });
    const repo = createRepo(kv, clock());
    await expect(
      repo.update((s) => {
        s.topics[0]!.name = '';
        return s;
      }),
    ).rejects.toThrow();
    expect((await repo.read()).topics[0]?.name).toBe('keep');
    expect(kv.writes).toBe(0);
  });

  it('never overwrites data it cannot read', async () => {
    const corrupt = { schemaVersion: CURRENT_SCHEMA_VERSION, topics: 'garbage' };
    const kv = memoryKv({ [STORE_KEY]: corrupt });
    const repo = createRepo(kv, clock());
    await expect(repo.read()).rejects.toBeInstanceOf(StoreUnreadableError);
    await expect(repo.update((s) => s)).rejects.toBeInstanceOf(StoreUnreadableError);
    expect(kv.data[STORE_KEY]).toEqual(corrupt);
  });

  it('resets unreadable data only after copying it to a backup key', async () => {
    const corrupt = { topics: 'garbage' };
    const kv = memoryKv({ [STORE_KEY]: corrupt });
    const repo = createRepo(kv, clock(77));
    const backupKey = await repo.resetKeepingBackup();
    expect(kv.data[backupKey]).toEqual(corrupt);
    expect(await repo.read()).toEqual(emptyStore());
  });

  it('writes a migrated store back once and keeps the pre-migration data', async () => {
    const legacy = { topics: [{ id: 'a', name: 'Legacy', tabs: [] }] };
    const kv = memoryKv({ [STORE_KEY]: legacy });
    const repo = createRepo(kv, clock());
    const s = await repo.read();
    expect(s.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    await repo.update((x) => x);
    expect((kv.data[STORE_KEY] as { schemaVersion: number }).schemaVersion).toBe(
      CURRENT_SCHEMA_VERSION,
    );
    expect(kv.data['store-backup-v0']).toEqual(legacy);
  });

  it('ignores a corrupt snapshot list rather than failing writes', async () => {
    const kv = memoryKv({ [SNAPSHOTS_KEY]: 'nope' });
    const repo = createRepo(kv, clock());
    await repo.update((s) => s, { snapshot: true });
    expect(await repo.snapshots()).toHaveLength(1);
  });
});
