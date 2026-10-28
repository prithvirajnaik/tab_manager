import { MAX_SNAPSHOTS, pushSnapshot } from '../../src/core/snapshots';
import { topic } from './factories';

describe('pushSnapshot', () => {
  it('adds the newest snapshot first', () => {
    const a = [topic({ name: 'a' })];
    const b = [topic({ name: 'b' })];
    const once = pushSnapshot([], a, 10);
    const twice = pushSnapshot(once, b, 20);
    expect(twice.map((s) => s.at)).toEqual([20, 10]);
    expect(twice[0]?.topics[0]?.name).toBe('b');
  });

  it(`keeps at most ${MAX_SNAPSHOTS}, dropping the oldest`, () => {
    let snaps = pushSnapshot([], [], 0);
    for (let i = 1; i <= MAX_SNAPSHOTS + 3; i++) snaps = pushSnapshot(snaps, [], i);
    expect(snaps).toHaveLength(MAX_SNAPSHOTS);
    expect(snaps[0]?.at).toBe(MAX_SNAPSHOTS + 3);
    expect(snaps.at(-1)?.at).toBe(4);
  });

  it('copies topics so later mutation cannot change a snapshot', () => {
    const topics = [topic({ name: 'before' })];
    const snaps = pushSnapshot([], topics, 1);
    topics[0]!.name = 'after';
    expect(snaps[0]?.topics[0]?.name).toBe('before');
  });
});
