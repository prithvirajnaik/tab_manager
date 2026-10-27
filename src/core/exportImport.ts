import { migrate, MigrationError } from './migrations';
import type { Store } from './model';

export const EXPORT_FORMAT = 'tab-topics-export';

export type ImportResult = { ok: true; store: Store } | { ok: false; error: string };

export function serializeExport(store: Store, exportedAt: number): string {
  return JSON.stringify({ format: EXPORT_FORMAT, exportedAt, store }, null, 2);
}

/**
 * Parses and validates an export file. Window ids are reset to null because they are only
 * unique within the browser session that wrote them.
 */
export function parseImport(text: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'The file is not valid JSON.' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: 'The file is not a Tab Topics export.' };
  }
  const envelope = parsed as Record<string, unknown>;
  if (envelope.format !== EXPORT_FORMAT) {
    return { ok: false, error: 'The file is not a Tab Topics export.' };
  }
  if (envelope.store === undefined || envelope.store === null) {
    return { ok: false, error: 'The export has no data.' };
  }
  try {
    const store = migrate(envelope.store);
    for (const t of store.topics) t.windowId = null;
    for (const e of store.trash) e.topic.windowId = null;
    return { ok: true, store };
  } catch (e) {
    if (e instanceof MigrationError) return { ok: false, error: `Invalid export: ${e.message}` };
    throw e;
  }
}
