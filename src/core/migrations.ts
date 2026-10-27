import { z } from 'zod';
import {
  CURRENT_SCHEMA_VERSION,
  StoreSchema,
  defaultSettings,
  emptyStore,
  type Store,
} from './model';

export class MigrationError extends Error {
  override name = 'MigrationError';
}

type Raw = Record<string, unknown>;
type Migration = (data: Raw) => Raw;

const isRecord = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** MIGRATIONS[n] upgrades schema version n to n + 1. */
const MIGRATIONS: Migration[] = [
  // v0 (unversioned prototype): topics with tabs only.
  (data) => ({
    ...data,
    schemaVersion: 1,
    topics: asArray(data.topics).map((t) => {
      if (!isRecord(t)) return t;
      const createdAt = typeof t.createdAt === 'number' ? t.createdAt : 0;
      return {
        windowId: null,
        sections: [],
        recentlyClosed: [],
        parked: [],
        updatedAt: createdAt,
        ...t,
        createdAt,
        tabs: asArray(t.tabs).map((tab) =>
          isRecord(tab) ? { pinned: false, title: '', lastActiveAt: createdAt, ...tab } : tab,
        ),
      };
    }),
    unsortedParked: asArray(data.unsortedParked),
    settings: { ...defaultSettings(), ...(isRecord(data.settings) ? data.settings : {}) },
    trash: asArray(data.trash),
  }),
];

/**
 * Upgrades stored or imported data to the current schema and validates it.
 * Throws MigrationError rather than returning partial data, so callers never overwrite
 * something they could not read.
 */
export function migrate(input: unknown): Store {
  if (input === undefined || input === null) return emptyStore();
  if (!isRecord(input)) throw new MigrationError('Data is not an object');

  const version = input.schemaVersion === undefined ? 0 : input.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
    throw new MigrationError(`Invalid schema version: ${String(version)}`);
  }
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new MigrationError(
      `Data is from a newer version (schema ${version}); this build supports ${CURRENT_SCHEMA_VERSION}`,
    );
  }

  let data: Raw = input;
  for (let v = version; v < CURRENT_SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) throw new MigrationError(`No migration from schema ${v}`);
    data = step(data);
  }

  const parsed = StoreSchema.safeParse(data);
  if (!parsed.success) throw new MigrationError(formatIssues(parsed.error));
  return parsed.data;
}

export function formatIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`)
    .join('; ');
}
