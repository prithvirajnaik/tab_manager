// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { App } from '../../src/ui/App';
import type { Api, LoadResult } from '../../src/ui/api';
import type { Command, CommandResponse } from '../../src/core/messages';
import { savedTab, store, topic } from '../unit/factories';

afterEach(cleanup);
// Export, import and recovery live in Settings.
beforeEach(() => history.replaceState(null, '', '#/settings'));

function setup(initial: LoadResult, reply: (c: Command) => CommandResponse = () => ({ ok: true })) {
  const sent: Command[] = [];
  const downloads: [string, string][] = [];
  const api: Api = {
    send: async (c) => {
      sent.push(c);
      return reply(c);
    },
    subscribe: () => () => undefined,
    favicon: (u) => `fav:${u}`,
    currentTopicId: async () => null,
    download: (name, text) => downloads.push([name, text]),
    rawStore: async () => '{"store":"raw"}',
  };
  render(<App initial={initial} api={api} now={() => 100 * 86_400_000} />);
  return { sent, downloads };
}

const withTopics = (lastExportAt: number | null) =>
  ({
    ok: true,
    store: store({
      topics: [topic({ name: 'Work', tabs: [savedTab()] })],
      settings: { autoParkDays: 14, autoParkMode: 'on', lastExportAt },
      trash: [{ topic: topic({ id: 'gone', name: 'Old topic' }), deletedAt: 99 * 86_400_000 }],
    }),
  }) as const;

describe('backup and recovery', () => {
  it('shows the backup state in the sidebar from the last export time', () => {
    const backup = () => screen.getByRole('region', { name: 'Backup' }).textContent;
    setup(withTopics(null));
    expect(backup()).toContain('Not backed up yet');
    cleanup();
    setup(withTopics(80 * 86_400_000));
    expect(backup()).toContain('Backup is out of date');
    expect(backup()).toContain('Last export 3 weeks ago');
    cleanup();
    setup(withTopics(99 * 86_400_000));
    expect(backup()).toContain('Backed up');
    expect(backup()).toContain('Last export yesterday');
  });

  it('shows no backup card when there is nothing to back up', () => {
    setup({ ok: true, store: store() });
    expect(screen.queryByRole('region', { name: 'Backup' })).toBeNull();
  });

  it('exports from the sidebar card', async () => {
    const { sent } = setup(withTopics(null), (c) =>
      c.type === 'exportData' ? { ok: true, data: { text: '{}' } } : { ok: true },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Export backup' }));
    await waitFor(() => expect(sent).toEqual([{ type: 'exportData' }]));
  });

  it('exports to a downloaded file', async () => {
    const { sent, downloads } = setup(withTopics(null), (c) =>
      c.type === 'exportData' ? { ok: true, data: { text: '{"x":1}' } } : { ok: true },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Export to a file' }));
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(sent).toEqual([{ type: 'exportData' }]);
    expect(downloads[0]![0]).toMatch(/^tab-topics-\d{4}-\d{2}-\d{2}\.json$/);
    expect(downloads[0]![1]).toBe('{"x":1}');
  });

  it('imports a chosen file', async () => {
    const { sent } = setup(withTopics(null), (c) =>
      c.type === 'importData' ? { ok: true, data: { topics: 2, tabs: 5 } } : { ok: true },
    );
    const input = screen.getByLabelText('Choose a Tab Topics export file') as HTMLInputElement;
    const file = new File(['{"format":"tab-topics-export"}'], 'backup.json', {
      type: 'application/json',
    });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
    expect(await screen.findByText('Imported 2 topics with 5 tabs.')).toBeTruthy();
    expect(sent).toEqual([{ type: 'importData', text: '{"format":"tab-topics-export"}' }]);
  });

  it('restores a deleted topic from the trash', async () => {
    const { sent } = setup(withTopics(null));
    fireEvent.click(screen.getByRole('button', { name: 'Restore deleted topic Old topic' }));
    await waitFor(() => expect(sent).toEqual([{ type: 'undoDelete', topicId: 'gone' }]));
  });

  it('lists snapshots and restores one only after confirmation', async () => {
    const { sent } = setup(withTopics(null), (c) =>
      c.type === 'listSnapshots'
        ? { ok: true, data: [{ at: 5_000, topics: 3, tabs: 12 }] }
        : { ok: true },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show snapshots' }));
    expect(await screen.findByText('3 topics · 12 tabs')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Restore snapshot from/ }));
    expect(sent).toEqual([{ type: 'listSnapshots' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Replace current topics' }));
    await waitFor(() =>
      expect(sent).toEqual([{ type: 'listSnapshots' }, { type: 'restoreSnapshot', at: 5_000 }]),
    );
  });

  it('offers to download unreadable data, and resets only after confirmation', async () => {
    const { sent, downloads } = setup({ ok: false, error: 'bad' });
    fireEvent.click(screen.getByRole('button', { name: 'Download the stored data' }));
    await waitFor(() => expect(downloads.map((d) => d[1])).toEqual(['{"store":"raw"}']));
    fireEvent.click(screen.getByRole('button', { name: 'Start fresh…' }));
    expect(sent).toEqual([]);
    fireEvent.click(
      screen.getByRole('button', { name: 'Start fresh (the old data is kept as a backup)' }),
    );
    await waitFor(() => expect(sent).toEqual([{ type: 'resetStore' }]));
  });

  it('focuses search with the slash key and with Ctrl+K', () => {
    setup(withTopics(1));
    fireEvent.keyDown(document.body, { key: '/' });
    expect(document.activeElement?.id).toBe('search');
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    expect(document.activeElement?.id).toBe('search');
  });
});
