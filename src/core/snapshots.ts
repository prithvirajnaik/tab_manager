import type { Snapshot, Topic } from './model';

export const MAX_SNAPSHOTS = 10;

/** Returns a new rolling list with a deep copy of `topics` first, capped at MAX_SNAPSHOTS. */
export function pushSnapshot(snapshots: Snapshot[], topics: Topic[], at: number): Snapshot[] {
  return [{ at, topics: structuredClone(topics) }, ...snapshots].slice(0, MAX_SNAPSHOTS);
}
