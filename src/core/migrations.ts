import { z } from 'zod';
import {
  CURRENT_SCHEMA_VERSION,
  StoreSchema,
  defaultSettings,
  emptyStore,
  type Store,
  type Topic,
} from './model';

export class MigrationError extends Error {
  override name = 'MigrationError';
}

type Raw = Record<string, unknown>;
type Migration = (data: Raw) => Raw;

const isRecord = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Missing fields get defaults; present fields of the wrong type are an error, never coerced. */
function arrayField(v: unknown, path: string): unknown[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new MigrationError(`${path}: expected a list`);
  return v;
}

function recordField(v: unknown, path: string): Raw {
  if (v === undefined) return {};
  if (!isRecord(v)) throw new MigrationError(`${path}: expected an object`);
  return v;
}

/** MIGRATIONS[n] upgrades schema version n to n + 1. */
const MIGRATIONS: Migration[] = [
  // v0 (unversioned prototype): topics with tabs only.
  (data) => ({
    ...data,
    schemaVersion: 1,
    topics: arrayField(data.topics, 'topics').map((t, i) => {
      if (!isRecord(t)) throw new MigrationError(`topics.${i}: expected an object`);
      const createdAt = typeof t.createdAt === 'number' ? t.createdAt : 0;
      return {
        sections: [],
        recentlyClosed: [],
        parked: [],
        updatedAt: createdAt,
        ...t,
        windowId: null,
        createdAt,
        tabs: arrayField(t.tabs, `topics.${i}.tabs`).map((tab) =>
          isRecord(tab) ? { pinned: false, title: '', lastActiveAt: createdAt, ...tab } : tab,
        ),
      };
    }),
    unsortedParked: arrayField(data.unsortedParked, 'unsortedParked'),
    settings: { ...defaultSettings(), ...recordField(data.settings, 'settings') },
    trash: arrayField(data.trash, 'trash'),
  }),
];

function schemaVersionOf(input: Raw): number {
  const version = input.schemaVersion === undefined ? 0 : input.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
    throw new MigrationError(`Invalid schema version: ${String(version)}`);
  }
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new MigrationError(
      `Data is from a newer version (schema ${version}); this build supports ${CURRENT_SCHEMA_VERSION}`,
    );
  }
  return version;
}

/**
 * Upgrades stored or imported data to the current schema and validates it.
 * Throws MigrationError rather than returning partial data, so callers never overwrite
 * something they could not read.
 */
export function migrate(input: unknown): Store {
  if (input === undefined || input === null) return emptyStore();
  if (!isRecord(input)) throw new MigrationError('Data is not an object');

  let data: Raw = input;
  for (let v = schemaVersionOf(input); v < CURRENT_SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) throw new MigrationError(`No migration from schema ${v}`);
    data = step(data);
  }

  const parsed = StoreSchema.safeParse(data);
  if (!parsed.success) throw new MigrationError(formatIssues(parsed.error));
  return parsed.data;
}

/** Upgrades the topics of a snapshot written at `schemaVersion`. */
export function migrateTopics(topics: unknown, schemaVersion: number): Topic[] {
  const shell =
    schemaVersion === CURRENT_SCHEMA_VERSION
      ? { ...emptyStore(), topics }
      : { schemaVersion, topics };
  return migrate(shell).topics;
}

export function formatIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`)
    .join('; ');
}
