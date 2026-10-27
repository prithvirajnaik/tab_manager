import { CURRENT_SCHEMA_VERSION, emptyStore } from '../../src/core/model';
import { migrate, MigrationError } from '../../src/core/migrations';
import { store, topic, savedTab } from './factories';

describe('migrate', () => {
  it('returns an empty store for missing data', () => {
    expect(migrate(undefined)).toEqual(emptyStore());
  });

  it('passes a current-version store through unchanged', () => {
    const current = store({ topics: [topic({ tabs: [savedTab()] })] });
    expect(migrate(structuredClone(current))).toEqual(current);
  });

  it('upgrades an unversioned (v0) store, filling new fields with defaults', () => {
    const legacy = {
      topics: [
        {
          id: 't1',
          name: 'Japanese',
          tabs: [{ id: 's1', url: 'https://jisho.org/', title: 'Jisho', pinned: true }],
          createdAt: 5,
        },
      ],
    };
    const result = migrate(legacy);
    expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.settings.autoParkDays).toBe(14);
    const [t] = result.topics;
    expect(t).toMatchObject({
      id: 't1',
      name: 'Japanese',
      windowId: null,
      sections: [],
      recentlyClosed: [],
      parked: [],
      createdAt: 5,
      updatedAt: 5,
    });
    expect(t?.tabs[0]).toMatchObject({ url: 'https://jisho.org/', pinned: true, lastActiveAt: 5 });
  });

  it('rejects legacy data whose fields have the wrong type instead of defaulting them', () => {
    expect(() => migrate({ topics: 'garbage' })).toThrow(MigrationError);
    expect(() => migrate({ topics: [{ id: 'a', name: 'A', tabs: 'x' }] })).toThrow(MigrationError);
    expect(() => migrate({ topics: [], settings: 3 })).toThrow(MigrationError);
  });

  it('drops a stale window id from legacy data', () => {
    const result = migrate({ topics: [{ id: 'a', name: 'A', tabs: [], windowId: 12 }] });
    expect(result.topics[0]?.windowId).toBeNull();
  });

  it.each([
    'https://a/',
    'http://a/',
    'file:///c:/x',
    'chrome://settings/',
    'brave://rewards/',
    'about:config',
  ])('accepts %s as a tab url', (url) => {
    const s = store({ topics: [topic({ tabs: [savedTab({ url })] })] });
    expect(migrate(s).topics[0]?.tabs[0]?.url).toBe(url);
  });

  it('refuses data from a newer schema instead of discarding it', () => {
    expect(() => migrate({ ...emptyStore(), schemaVersion: CURRENT_SCHEMA_VERSION + 1 })).toThrow(
      MigrationError,
    );
  });

  it('rejects data that does not match the schema after migration', () => {
    expect(() => migrate({ ...emptyStore(), topics: [{ id: 1, name: null }] })).toThrow(
      MigrationError,
    );
    expect(() => migrate('not an object')).toThrow(MigrationError);
  });
});
