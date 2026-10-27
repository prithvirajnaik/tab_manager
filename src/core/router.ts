import { UserError, type Service } from './commands';
import { CommandSchema, type CommandResponse } from './messages';
import { StoreUnreadableError } from './repo';

export type Sender = { isOwnExtension: boolean; windowId?: number };

/** Validates a message and runs the matching command. Never throws. */
export async function handleMessage(
  service: Service,
  message: unknown,
  sender: Sender,
): Promise<CommandResponse> {
  if (!sender.isOwnExtension) return { ok: false, error: 'Unknown sender.' };
  const parsed = CommandSchema.safeParse(message);
  if (!parsed.success) return { ok: false, error: 'Unknown command.' };
  const cmd = parsed.data;
  try {
    switch (cmd.type) {
      case 'saveWindow': {
        const windowId = cmd.windowId ?? sender.windowId;
        if (windowId === undefined) return { ok: false, error: 'No window to save.' };
        const topic = await service.saveWindow(windowId, cmd.name);
        return { ok: true, data: { topicId: topic.id } };
      }
      case 'openTopic':
        await service.openTopic(cmd.topicId);
        return { ok: true };
      case 'parkTopic':
        await service.parkTopic(cmd.topicId);
        return { ok: true };
      case 'restoreTab':
        await service.restoreTab(cmd.topicId, cmd.tabId, cmd.from);
        return { ok: true };
      case 'sync':
        await service.syncAll();
        return { ok: true };
    }
  } catch (e) {
    if (e instanceof UserError || e instanceof StoreUnreadableError) {
      return { ok: false, error: e.message };
    }
    console.error('[tab-topics] command failed', cmd.type, e);
    return { ok: false, error: 'Something went wrong. Your saved topics were not changed.' };
  }
}
