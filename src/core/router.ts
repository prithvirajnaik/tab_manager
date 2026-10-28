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
        return { ok: true, data: await service.openTopic(cmd.topicId) };
      case 'parkTopic':
        return { ok: true, data: await service.parkTopic(cmd.topicId) };
      case 'restoreTab':
        await service.restoreTab(cmd.topicId, cmd.tabId, cmd.from);
        return { ok: true };
      case 'sync':
        await service.syncAll();
        return { ok: true };
      case 'renameTopic':
        await service.renameTopic(cmd.topicId, cmd.name);
        return { ok: true };
      case 'deleteTopic':
        await service.deleteTopic(cmd.topicId);
        return { ok: true };
      case 'undoDelete':
        await service.undoDelete(cmd.topicId);
        return { ok: true };
      case 'detachWindow':
        await service.detachWindow(cmd.topicId);
        return { ok: true };
      case 'groupTabs':
        await service.groupTabs(cmd.topicId, cmd.tabIds, cmd.name);
        return { ok: true };
      case 'ungroupSection':
        await service.ungroupSection(cmd.topicId, cmd.sectionId);
        return { ok: true };
      case 'autoPark':
        return {
          ok: true,
          data: await service.autoPark({
            ...(cmd.dryRun === undefined ? {} : { dryRun: cmd.dryRun }),
            ...(cmd.at === undefined ? {} : { at: cmd.at }),
          }),
        };
      case 'restoreUnsorted':
        await service.restoreUnsorted(cmd.tabId, sender.windowId);
        return { ok: true };
      case 'restoreAllParked':
        return { ok: true, data: await service.restoreAllParked(cmd.topicId, sender.windowId) };
      case 'updateSettings':
        await service.updateSettings({
          ...(cmd.autoParkDays === undefined ? {} : { autoParkDays: cmd.autoParkDays }),
          ...(cmd.autoParkMode === undefined ? {} : { autoParkMode: cmd.autoParkMode }),
        });
        return { ok: true };
      case 'exportData':
        return { ok: true, data: await service.exportData() };
      case 'importData':
        return { ok: true, data: await service.importData(cmd.text) };
      case 'listSnapshots':
        return { ok: true, data: await service.listSnapshots() };
      case 'restoreSnapshot':
        await service.restoreSnapshot(cmd.at);
        return { ok: true };
      case 'resetStore':
        return { ok: true, data: await service.resetStore() };
      case 'moveTab':
        await service.moveTab(cmd.fromTopicId, cmd.tabId, cmd.toTopicId);
        return { ok: true };
    }
  } catch (e) {
    if (e instanceof UserError || e instanceof StoreUnreadableError) {
      return { ok: false, error: e.message };
    }
    console.error('[tab-topics] command failed', cmd.type, e);
    return { ok: false, error: 'Something went wrong. Please try again.' };
  }
}
