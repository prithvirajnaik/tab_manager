import { z } from 'zod';

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
]);

export type Command = z.infer<typeof CommandSchema>;

export type CommandResponse = { ok: true; data?: unknown } | { ok: false; error: string };
