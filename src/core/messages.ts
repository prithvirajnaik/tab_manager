import { z } from 'zod';
import { AUTO_PARK_MODES } from './model';

/** Commands extension pages send to the service worker. Validated on arrival. */
export const CommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('saveWindow'),
    name: z.string(),
    /** Defaults to the window of the sending tab. */
    windowId: z.number().int().optional(),
  }),
  z.object({ type: z.literal('openTopic'), topicId: z.string() }),
  z.object({ type: z.literal('parkTopic'), topicId: z.string() }),
  z.object({
    type: z.literal('restoreTab'),
    topicId: z.string(),
    tabId: z.string(),
    from: z.enum(['recentlyClosed', 'parked']),
  }),
  z.object({ type: z.literal('sync') }),
  z.object({ type: z.literal('renameTopic'), topicId: z.string(), name: z.string() }),
  z.object({ type: z.literal('deleteTopic'), topicId: z.string() }),
  z.object({ type: z.literal('undoDelete'), topicId: z.string() }),
  z.object({ type: z.literal('detachWindow'), topicId: z.string() }),
  z.object({
    type: z.literal('groupTabs'),
    topicId: z.string(),
    tabIds: z.array(z.string()).max(1000),
    name: z.string(),
  }),
  z.object({ type: z.literal('ungroupSection'), topicId: z.string(), sectionId: z.string() }),
  z.object({
    type: z.literal('moveTab'),
    fromTopicId: z.string(),
    tabId: z.string(),
    toTopicId: z.string(),
  }),
  z.object({
    type: z.literal('autoPark'),
    dryRun: z.boolean().optional(),
    /** Clock override, for end-to-end tests. */
    at: z.number().optional(),
  }),
  z.object({ type: z.literal('restoreUnsorted'), tabId: z.string() }),
  z.object({ type: z.literal('restoreAllParked'), topicId: z.string().nullable() }),
  z.object({
    type: z.literal('updateSettings'),
    autoParkDays: z.number().optional(),
    autoParkMode: z.enum(AUTO_PARK_MODES).optional(),
  }),
  z.object({ type: z.literal('exportData') }),
  // 50 MB is far beyond any real export, and keeps a pasted file from exhausting memory.
  z.object({ type: z.literal('importData'), text: z.string().max(50_000_000) }),
  z.object({ type: z.literal('listSnapshots') }),
  z.object({ type: z.literal('restoreSnapshot'), at: z.number() }),
  z.object({ type: z.literal('resetStore') }),
]);

export type Command = z.infer<typeof CommandSchema>;

export type CommandResponse = { ok: true; data?: unknown } | { ok: false; error: string };
