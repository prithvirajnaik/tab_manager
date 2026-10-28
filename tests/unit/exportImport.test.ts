import { serializeExport, parseImport, EXPORT_FORMAT } from '../../src/core/exportImport';
import { store, topic, savedTab } from './factories';

const rich = () =>
  store({
    topics: [
      topic({
        name: 'Japanese 日本語 <script>',
        note: 'kanji',
        windowId: 7,
        tabs: [savedTab({ pinned: true, favIconUrl: 'https://x/f.ico', sectionId: 'sec1' })],
        sections: [{ id: 'sec1', name: 'Grammar' }],
        recentlyClosed: [{ ...savedTab(), closedAt: 99 }],
        parked: [{ ...savedTab(), parkedAt: 98 }],
      }),
      topic({ name: 'Programming' }),
    ],
    unsortedParked: [{ ...savedTab(), parkedAt: 50 }],
    settings: { autoParkDays: 21, autoParkMode: 'dry-run', lastExportAt: 3 },
  });

describe('export and import', () => {
  it('round-trips exactly, except live window ids which do not survive', () => {
    const original = rich();
    const result = parseImport(serializeExport(original, 1234));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const expected = structuredClone(original);
    expected.topics.forEach((t) => (t.windowId = null));
    expect(result.store).toEqual(expected);
  });

  it('writes a self-describing envelope', () => {
    const parsed = JSON.parse(serializeExport(store(), 1234));
    expect(parsed).toMatchObject({ format: EXPORT_FORMAT, exportedAt: 1234 });
    expect(parsed.store.schemaVersion).toBeTypeOf('number');
  });

  it.each([
    ['invalid JSON', '{nope'],
    ['a JSON array', '[]'],
    ['the wrong format tag', JSON.stringify({ format: 'other', store: {} })],
    ['a missing store', JSON.stringify({ format: EXPORT_FORMAT })],
    [
      'a tab without a url',
      JSON.stringify({
        format: EXPORT_FORMAT,
        store: { ...store(), topics: [{ ...topic(), tabs: [{ id: 'x', title: 't' }] }] },
      }),
    ],
    [
      'a javascript: url',
      JSON.stringify({
        format: EXPORT_FORMAT,
        store: {
          ...store(),
          topics: [topic({ tabs: [savedTab({ url: 'javascript:alert(1)' })] })],
        },
      }),
    ],
    ...['javascript:alert(1)', 'java	script:alert(1)', ' JAVASCRIPT:x', 'data:text/html,x'].map(
      (url) => [
        `a disguised script url ${JSON.stringify(url)}`,
        JSON.stringify({
          format: EXPORT_FORMAT,
          store: { ...store(), topics: [topic({ tabs: [savedTab({ url })] })] },
        }),
      ],
    ),
    [
      'a store without a schema version',
      JSON.stringify({ format: EXPORT_FORMAT, store: { hello: 1 } }),
    ],
    [
      'a legacy store with a field of the wrong type',
      JSON.stringify({ format: EXPORT_FORMAT, store: { schemaVersion: 0, topics: 'garbage' } }),
    ],
    [
      'duplicate saved tab ids',
      JSON.stringify({
        format: EXPORT_FORMAT,
        store: {
          ...store(),
          topics: [
            topic({ tabs: [savedTab({ id: 'same' })] }),
            topic({ tabs: [savedTab({ id: 'same' })] }),
          ],
        },
      }),
    ],
    [
      'duplicate topic ids',
      JSON.stringify({
        format: EXPORT_FORMAT,
        store: { ...store(), topics: [topic({ id: 'dup' }), topic({ id: 'dup' })] },
      }),
    ],
  ])('rejects %s with a readable error', (_label, text) => {
    const result = parseImport(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
  });
});
