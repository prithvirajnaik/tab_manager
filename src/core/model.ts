import { z } from 'zod';

export const CURRENT_SCHEMA_VERSION = 1;
export const DEFAULT_AUTO_PARK_DAYS = 14;
export const RECENTLY_CLOSED_DAYS = 30;
export const TRASH_DAYS = 30;

export const MAX_URL_LENGTH = 8192;
export const MAX_TITLE_LENGTH = 4096;

const ALLOWED_PROTOCOLS = new Set([
  'http:',
  'https:',
  'file:',
  'ftp:',
  'chrome:',
  'brave:',
  'edge:',
  'about:',
  'chrome-extension:',
  'view-source:',
  'ipfs:',
  'ipns:',
]);

/**
 * Allowlist check on the protocol as the URL parser sees it, so disguises such as
 * "\u0001javascript:" or "java\tscript:" are caught.
 */
export function isOpenableUrl(url: string): boolean {
  if (url.length === 0 || url.length > MAX_URL_LENGTH) return false;
  try {
    return ALLOWED_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

// Titles and URLs come from web pages and imported files; they are validated here and
// rendered only as text, never as HTML.
const Url = z.string().refine(isOpenableUrl, 'URL is not allowed');

export const SavedTabSchema = z.object({
  id: z.string().min(1),
  url: Url,
  title: z.string().max(MAX_TITLE_LENGTH),
  favIconUrl: z.string().max(MAX_URL_LENGTH).optional(),
  pinned: z.boolean(),
  sectionId: z.string().optional(),
  lastActiveAt: z.number(),
  openerTabId: z.string().optional(),
});

export const ClosedTabSchema = SavedTabSchema.extend({ closedAt: z.number() });
export const ParkedTabSchema = SavedTabSchema.extend({ parkedAt: z.number() });

export const SECTION_COLORS = [
  'grey',
  'blue',
  'red',
  'yellow',
  'green',
  'pink',
  'purple',
  'cyan',
  'orange',
] as const;

export const SectionSchema = z.object({
  id: z.string().min(1),
  name: z.string().max(200),
  color: z.enum(SECTION_COLORS).optional(),
  collapsed: z.boolean().optional(),
});

export const TopicSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  note: z.string().max(10_000).optional(),
  windowId: z.number().nullable(),
  tabs: z.array(SavedTabSchema),
  sections: z.array(SectionSchema),
  recentlyClosed: z.array(ClosedTabSchema),
  parked: z.array(ParkedTabSchema),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const AUTO_PARK_MODES = ['on', 'dry-run', 'off'] as const;

export const SettingsSchema = z.object({
  autoParkDays: z.number().int().min(1).max(365),
  autoParkMode: z.enum(AUTO_PARK_MODES),
  lastExportAt: z.number().nullable(),
});

export const TrashEntrySchema = z.object({ topic: TopicSchema, deletedAt: z.number() });

export const StoreSchema = z
  .object({
    schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
    topics: z.array(TopicSchema),
    unsortedParked: z.array(ParkedTabSchema),
    settings: SettingsSchema,
    trash: z.array(TrashEntrySchema),
  })
  .refine((s) => new Set(s.topics.map((t) => t.id)).size === s.topics.length, {
    message: 'Topic ids must be unique',
    path: ['topics'],
  });

export const SnapshotSchema = z.object({ at: z.number(), topics: z.array(TopicSchema) });

export type SavedTab = z.infer<typeof SavedTabSchema>;
export type ClosedTab = z.infer<typeof ClosedTabSchema>;
export type ParkedTab = z.infer<typeof ParkedTabSchema>;
export type Section = z.infer<typeof SectionSchema>;
export type SectionColor = (typeof SECTION_COLORS)[number];
export type Topic = z.infer<typeof TopicSchema>;
export type Settings = z.infer<typeof SettingsSchema>;
export type AutoParkMode = (typeof AUTO_PARK_MODES)[number];
export type TrashEntry = z.infer<typeof TrashEntrySchema>;
export type Store = z.infer<typeof StoreSchema>;
export type Snapshot = z.infer<typeof SnapshotSchema>;

export function defaultSettings(): Settings {
  return { autoParkDays: DEFAULT_AUTO_PARK_DAYS, autoParkMode: 'on', lastExportAt: null };
}

export function emptyStore(): Store {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    topics: [],
    unsortedParked: [],
    settings: defaultSettings(),
    trash: [],
  };
}
