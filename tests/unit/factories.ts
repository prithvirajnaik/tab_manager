import type { SavedTab, Store, Topic } from '../../src/core/model';
import { emptyStore } from '../../src/core/model';

let seq = 0;

export function savedTab(overrides: Partial<SavedTab> = {}): SavedTab {
  seq += 1;
  return {
    id: `tab-${seq}`,
    url: `https://example.com/${seq}`,
    title: `Example ${seq}`,
    pinned: false,
    lastActiveAt: 1_000,
    ...overrides,
  };
}

export function topic(overrides: Partial<Topic> = {}): Topic {
  seq += 1;
  return {
    id: `topic-${seq}`,
    name: `Topic ${seq}`,
    windowId: null,
    tabs: [],
    sections: [],
    recentlyClosed: [],
    parked: [],
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

export function store(overrides: Partial<Store> = {}): Store {
  return { ...emptyStore(), ...overrides };
}
