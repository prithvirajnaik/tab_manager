import { reconcileSections } from '../../src/core/sections';
import type { LiveGroup } from '../../src/core/ports';
import { topic } from './factories';

let n = 0;
const newId = () => `sec-${++n}`;
const group = (id: number, title: string, extra: Partial<LiveGroup> = {}): LiveGroup => ({
  id,
  windowId: 1,
  title,
  color: 'blue',
  collapsed: false,
  ...extra,
});

describe('reconcileSections', () => {
  it('creates sections for new groups, in tab order', () => {
    const r = reconcileSections(topic(), [group(7, 'Grammar'), group(8, 'Kanji')], {}, newId);
    expect(r.sections.map((s) => s.name)).toEqual(['Grammar', 'Kanji']);
    expect(r.groupLinks).toEqual({ 7: r.sections[0]!.id, 8: r.sections[1]!.id });
  });

  it('follows a linked group through renames and colour changes', () => {
    const t = topic({ sections: [{ id: 's1', name: 'Old', color: 'blue' }] });
    const r = reconcileSections(
      t,
      [group(7, 'New', { color: 'red', collapsed: true })],
      { 7: 's1' },
      newId,
    );
    expect(r.sections).toEqual([{ id: 's1', name: 'New', color: 'red', collapsed: true }]);
  });

  it('matches unlinked groups to sections by name (after a restart)', () => {
    const t = topic({ sections: [{ id: 's1', name: 'Grammar' }] });
    const r = reconcileSections(t, [group(30, 'Grammar')], {}, newId);
    expect(r.sections[0]!.id).toBe('s1');
    expect(r.groupLinks).toEqual({ 30: 's1' });
  });

  it('ignores links to sections of other topics and drops sections with no group', () => {
    const t = topic({ sections: [{ id: 's1', name: 'Gone' }] });
    const r = reconcileSections(t, [group(5, 'X')], { 5: 'other-topic-section' }, newId);
    expect(r.sections.map((s) => s.name)).toEqual(['X']);
    expect(r.sections[0]!.id).not.toBe('other-topic-section');
  });

  it('keeps an unnamed group as a section with an empty name', () => {
    const r = reconcileSections(topic(), [group(1, '')], {}, newId);
    expect(r.sections[0]!.name).toBe('');
  });
});
