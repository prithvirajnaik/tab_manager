// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { App } from '../../src/ui/App';
import type { Api, LoadResult } from '../../src/ui/api';
import type { Command } from '../../src/core/messages';
import { savedTab, store, topic } from '../unit/factories';

afterEach(cleanup);
beforeEach(() => history.replaceState(null, '', '#/'));

function setup(s = store()) {
  const sent: Command[] = [];
  const api: Api = {
    send: async (c) => {
      sent.push(c);
      return { ok: true };
    },
    subscribe: () => () => undefined,
    favicon: (u) => `fav:${u}`,
    currentTopicId: async () => null,
    download: () => undefined,
    rawStore: async () => '{}',
  };
  const initial: LoadResult = { ok: true, store: s };
  render(<App initial={initial} api={api} />);
  return { sent };
}

/** Opens a topic's drawer on its tabs. */
function showTabs(name: string) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^Show tabs of ${name}`) }));
}

const data = () =>
  store({
    topics: [
      topic({
        id: 'jp',
        name: 'Japanese',
        sections: [{ id: 's1', name: 'Grammar', color: 'green' }],
        tabs: [
          savedTab({ id: 'a', title: 'Particles', sectionId: 's1' }),
          savedTab({ id: 'b', title: 'Jisho dictionary', url: 'https://jisho.org/' }),
          savedTab({ id: 'c', title: 'Pinned home', pinned: true }),
        ],
      }),
      topic({ id: 'code', name: 'Programming', tabs: [savedTab({ id: 'd', title: 'MDN' })] }),
    ],
  });

describe('sections in a topic card', () => {
  it('lists tabs under their section and ungroups', async () => {
    const { sent } = setup(data());
    showTabs('Japanese');
    const section = screen.getByRole('region', { name: 'Grammar' });
    expect(section.textContent).toContain('Particles');
    fireEvent.click(screen.getByRole('button', { name: 'Ungroup Grammar' }));
    await waitFor(() =>
      expect(sent).toEqual([{ type: 'ungroupSection', topicId: 'jp', sectionId: 's1' }]),
    );
  });

  it('groups selected tabs into a new section; pinned tabs cannot be selected', async () => {
    const { sent } = setup(data());
    showTabs('Japanese');
    expect((screen.getByLabelText('Select Pinned home') as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Select Jisho dictionary'));
    fireEvent.input(screen.getByLabelText('Section name'), { target: { value: 'Lookup' } });
    fireEvent.submit(screen.getByLabelText('Section name').closest('form')!);
    await waitFor(() =>
      expect(sent).toEqual([{ type: 'groupTabs', topicId: 'jp', tabIds: ['b'], name: 'Lookup' }]),
    );
  });

  it('moves a tab to another topic', async () => {
    const { sent } = setup(data());
    showTabs('Japanese');
    fireEvent.change(screen.getByLabelText('Topic to move Jisho dictionary to'), {
      target: { value: 'code' },
    });
    // Choosing a topic alone does nothing (arrow keys change a select's value).
    expect(sent).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Move Jisho dictionary' }));
    await waitFor(() =>
      expect(sent).toEqual([{ type: 'moveTab', fromTopicId: 'jp', tabId: 'b', toTopicId: 'code' }]),
    );
  });
});

describe('search', () => {
  it('searches across topics and acts on results', async () => {
    const { sent } = setup(data());
    fireEvent.input(screen.getByLabelText('Search all topics'), { target: { value: 'jisho' } });
    expect(await screen.findByText('1 tab found')).toBeTruthy();
    expect(screen.queryByRole('article')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open topic Japanese' }));
    fireEvent.change(screen.getByLabelText('Topic to move Jisho dictionary to'), {
      target: { value: 'code' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Move Jisho dictionary' }));
    await waitFor(() =>
      expect(sent).toEqual([
        { type: 'openTopic', topicId: 'jp' },
        { type: 'moveTab', fromTopicId: 'jp', tabId: 'b', toTopicId: 'code' },
      ]),
    );
  });

  it('says when nothing matches and clears with Escape', async () => {
    setup(data());
    const box = screen.getByLabelText('Search all topics');
    fireEvent.input(box, { target: { value: 'zzz' } });
    expect(await screen.findByText('Nothing matches “zzz”.')).toBeTruthy();
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(screen.getAllByRole('article')).toHaveLength(2);
  });

  it('offers Restore for parked results', async () => {
    const s = data();
    s.topics[0]!.parked = [{ ...savedTab({ id: 'p', title: 'Old kanji' }), parkedAt: 1 }];
    const { sent } = setup(s);
    fireEvent.input(screen.getByLabelText('Search all topics'), { target: { value: 'kanji' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Restore Old kanji' }));
    await waitFor(() =>
      expect(sent).toEqual([{ type: 'restoreTab', topicId: 'jp', tabId: 'p', from: 'parked' }]),
    );
  });

  it('finds topics by name and opens them', async () => {
    const { sent } = setup(data());
    fireEvent.input(screen.getByLabelText('Search all topics'), { target: { value: 'japan' } });
    expect(await screen.findByText('1 topic found')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open Japanese' }));
    await waitFor(() => expect(sent).toEqual([{ type: 'openTopic', topicId: 'jp' }]));
  });
});
