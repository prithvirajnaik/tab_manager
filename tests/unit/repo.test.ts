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

  it('resets unreadable data only after copying it to a unique backup key', async () => {
    const corrupt = { schemaVersion: CURRENT_SCHEMA_VERSION, topics: 'garbage' };
    const kv = memoryKv({ [STORE_KEY]: corrupt });
    const repo = createRepo(kv, () => 77);
    await expect(repo.read()).rejects.toBeInstanceOf(StoreUnreadableError);
    const backupKey = await repo.resetKeepingBackup();
    expect(kv.data[backupKey]).toEqual(corrupt);
    expect(await repo.read()).toEqual(emptyStore());
    const second = await repo.resetKeepingBackup();
    expect(second).not.toBe(backupKey);
    expect(kv.data[backupKey]).toEqual(corrupt);
  });

  it('keeps the queue working and writes nothing when an update throws', async () => {
    const kv = memoryKv();
    const repo = createRepo(kv, clock());
    await expect(
      repo.update(() => {
        throw new Error('bug');
      }),
    ).rejects.toThrow('bug');
    expect(kv.writes).toBe(0);
    await repo.update((s) => {
      s.topics.push(topic());
      return s;
    });
    expect((await repo.read()).topics).toHaveLength(1);
  });

  it('skips the write when an update changes nothing', async () => {
    const kv = memoryKv({ [STORE_KEY]: store() });
    const repo = createRepo(kv, clock());
    await repo.update((s) => s);
    expect(kv.writes).toBe(0);
  });

  it('clears window links on restored topics', async () => {
    const kv = memoryKv({ [STORE_KEY]: store({ topics: [topic({ windowId: 5 })] }) });
    const repo = createRepo(kv, clock());
    await repo.update((s) => ({ ...s, topics: [] }), { snapshot: true });
    const [snap] = await repo.snapshots();
    await repo.restoreSnapshot(snap!.at);
    expect((await repo.read()).topics[0]?.windowId).toBeNull();
  });

  it('refuses to restore a snapshot over unreadable data', async () => {
    const kv = memoryKv({ [STORE_KEY]: { schemaVersion: 1, topics: 1 } });
    const repo = createRepo(kv, clock());
    await expect(repo.restoreSnapshot(1)).rejects.toThrow();
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
    const backups = Object.keys(kv.data).filter((k) => k.startsWith('store-backup-v0-'));
    expect(backups).toHaveLength(1);
    expect(kv.data[backups[0]!]).toEqual(legacy);
  });

  it('never overwrites an earlier migration backup', async () => {
    const kv = memoryKv({ [STORE_KEY]: { topics: [] }, 'store-backup-v0-1000': 'older' });
    const repo = createRepo(kv, () => 1000);
    await repo.update((x) => x);
    expect(kv.data['store-backup-v0-1000']).toBe('older');
    expect(Object.keys(kv.data).filter((k) => k.startsWith('store-backup-v0-'))).toHaveLength(2);
  });

  it('moves unreadable snapshots to a backup key instead of dropping them', async () => {
    const kv = memoryKv({ [SNAPSHOTS_KEY]: 'nope' });
    const repo = createRepo(kv, clock(300));
    await repo.update((s) => s, { snapshot: true });
    expect(await repo.snapshots()).toHaveLength(1);
    const backups = Object.entries(kv.data).filter(([k]) => k.startsWith('snapshots-unreadable-'));
    expect(backups.map(([, v]) => v)).toEqual(['nope']);
  });

  it('keeps readable snapshots and migrates legacy ones when entries are mixed', async () => {
    const good = { at: 5, topics: [topic({ name: 'good' })] };
    const legacy = { at: 4, topics: [{ id: 'l', name: 'legacy', tabs: [] }] };
    const bad = { at: 3, topics: 'x' };
    const kv = memoryKv({ [SNAPSHOTS_KEY]: { schemaVersion: 0, items: [good, legacy, bad] } });
    const repo = createRepo(kv, clock(900));
    const snaps = await repo.snapshots();
    expect(snaps.map((s) => s.topics[0]?.name ?? '-')).toEqual(['good', 'legacy']);
    await repo.update((s) => s, { snapshot: true });
    expect((await repo.snapshots()).map((s) => s.at)).toEqual([900, 5, 4]);
    const stored = kv.data[SNAPSHOTS_KEY] as { schemaVersion: number };
    expect(stored.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    const backups = Object.entries(kv.data).filter(([k]) => k.startsWith('snapshots-unreadable-'));
    expect(backups.map(([, v]) => v)).toEqual([[bad]]);
  });
});
