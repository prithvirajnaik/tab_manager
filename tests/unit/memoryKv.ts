import type { KeyValueArea } from '../../src/core/ports';

/** In-memory stand-in for chrome.storage.local that clones like structured storage. */
export function memoryKv(initial: Record<string, unknown> = {}): KeyValueArea & {
  data: Record<string, unknown>;
  writes: number;
} {
  const kv = {
    data: structuredClone(initial),
    writes: 0,
    async get(keys: string[]) {
      const out: Record<string, unknown> = {};
      for (const k of keys) if (k in kv.data) out[k] = structuredClone(kv.data[k]);
      return out;
    },
    async set(items: Record<string, unknown>) {
      await Promise.resolve();
      kv.writes += 1;
      Object.assign(kv.data, structuredClone(items));
    },
  };
  return kv;
}
