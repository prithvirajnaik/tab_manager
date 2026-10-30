// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/preact';
import { App, keepUnchanged } from '../../src/ui/App';
import type { Api, LoadResult } from '../../src/ui/api';
import type { Command } from '../../src/core/messages';
import { savedTab, store, topic } from '../unit/factories';

afterEach(cleanup);
beforeEach(() => history.replaceState(null, '', '#/'));

function fakeApi(overrides: Partial<Api> = {}) {
  const sent: Command[] = [];
  let push: (l: LoadResult) => void = () => undefined;
  const api: Api = {
    send: async (c) => {
      sent.push(c);
      return { ok: true };
    },
    subscribe: (cb) => {
      push = cb;
      return () => undefined;
    },
    favicon: (u) => `fav:${u}`,
    currentTopicId: async () => null,
    download: () => undefined,
    rawStore: async () => '{}',
    ...overrides,
  };
  return { api, sent, push: (l: LoadResult) => push(l) };
}

const loaded = (s = store()): LoadResult => ({ ok: true, store: s });

/** Opens a topic's ⋮ menu so its items can be clicked. */
function menu(name: string) {
  fireEvent.click(screen.getByRole('button', { name: `More actions for ${name}` }));
}

describe('keepUnchanged', () => {
  it('keeps unchanged topics as the same objects', () => {
    const a = topic({ id: 'a' });
    const b = topic({ id: 'b' });
    const next = keepUnchanged(
      loaded(store({ topics: [a, b] })),
      loaded(store({ topics: [structuredClone(a), { ...b, windowId: 5 }] })),
    );
    if (!next.ok) throw new Error('expected ok');
    expect(next.store.topics[0]).toBe(a);
    expect(next.store.topics[1]).not.toBe(b);
    expect(next.store.topics[1]?.windowId).toBe(5);
    expect(keepUnchanged({ ok: false, error: 'x' }, loaded())).toEqual(loaded());
  });
});

describe('App', () => {
  it('shows an empty state and the save button when there are no topics', () => {
    const { api } = fakeApi();
    render(<App initial={loaded()} api={api} />);
    expect(screen.getByRole('heading', { name: 'No topics yet' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save window' })).toBeTruthy();
    expect(screen.queryByLabelText('Search all topics')).toBeNull();
  });

  it('lists topics with their state and renders titles as text, never HTML', () => {
    const { api } = fakeApi();
    const evil = '<img src=x onerror=alert(1)>';
    render(
      <App
        initial={loaded(
          store({
            topics: [
              topic({ name: evil, tabs: [savedTab({ title: evil })] }),
              topic({ name: 'Open one', windowId: 3 }),
            ],
          }),
        )}
        api={api}
      />,
    );
    expect(screen.getByRole('heading', { name: evil })).toBeTruthy();
    expect(document.querySelector('img[src="x"]')).toBeNull();
    // Open or saved shows in the buttons, not in a status pill.
    expect(document.querySelector('.badge')).toBeNull();
    expect(screen.getByRole('button', { name: 'Switch to Open one' })).toBeTruthy();
  });

  it('sends open, park and rename commands', async () => {
    const { api, sent } = fakeApi();
    const t = topic({ id: 't1', name: 'Work', windowId: 9 });
    render(<App initial={loaded(store({ topics: [t] }))} api={api} />);
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Work' }));
    await waitFor(() => expect(sent).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Park Work' }));
    await waitFor(() => expect(sent).toHaveLength(2));
    menu('Work');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename Work' }));
    const input = screen.getByLabelText('New name for Work') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'Deep work' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() =>
      expect(sent).toEqual([
        { type: 'openTopic', topicId: 't1' },
        { type: 'parkTopic', topicId: 't1' },
        { type: 'renameTopic', topicId: 't1', name: 'Deep work' },
      ]),
    );
  });

  it('cancels a rename with Escape', () => {
    const { api, sent } = fakeApi();
    render(<App initial={loaded(store({ topics: [topic({ name: 'Work' })] }))} api={api} />);
    menu('Work');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename Work' }));
    const input = screen.getByLabelText('New name for Work');
    fireEvent.input(input, { target: { value: 'Nope' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.getByRole('heading', { name: 'Work' })).toBeTruthy();
    expect(sent).toEqual([]);
  });

  it('deletes with an undo toast', async () => {
    const { api, sent } = fakeApi();
    render(
      <App initial={loaded(store({ topics: [topic({ id: 't1', name: 'Gone' })] }))} api={api} />,
    );
    menu('Gone');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Gone' }));
    const undo = await screen.findByRole('button', { name: 'Undo' });
    expect(screen.getByText('Deleted "Gone".')).toBeTruthy();
    fireEvent.click(undo);
    await waitFor(() =>
      expect(sent).toEqual([
        { type: 'deleteTopic', topicId: 't1' },
        { type: 'undoDelete', topicId: 't1' },
      ]),
    );
  });

  it('saves the current window from the popover, then closes it', async () => {
    const { api, sent } = fakeApi();
    render(<App initial={loaded()} api={api} />);
    const button = screen.getByRole('button', { name: 'Save window' });
    fireEvent.click(button);
    const input = screen.getByLabelText('Save this window as') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    fireEvent.input(input, { target: { value: 'Japanese' } });
    fireEvent.submit(input.form!);
    await waitFor(() => expect(sent).toEqual([{ type: 'saveWindow', name: 'Japanese' }]));
    await waitFor(() => expect(screen.queryByLabelText('Save this window as')).toBeNull());
    expect(document.activeElement).toBe(button);
    expect(screen.getByText('Saved this window as "Japanese".')).toBeTruthy();
  });

  it('closes the save popover with Escape without saving', () => {
    const { api, sent } = fakeApi();
    render(<App initial={loaded()} api={api} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save window' }));
    fireEvent.keyDown(screen.getByLabelText('Save this window as'), { key: 'Escape' });
    expect(screen.queryByLabelText('Save this window as')).toBeNull();
    expect(sent).toEqual([]);
  });

  it('shows command errors', async () => {
    const { api } = fakeApi({ send: async () => ({ ok: false, error: 'Topic not found.' }) });
    render(<App initial={loaded(store({ topics: [topic({ name: 'X' })] }))} api={api} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open X' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Topic not found.');
  });

  it('marks the topic linked to this window and hides the save form', async () => {
    const { api } = fakeApi({ currentTopicId: async () => 'mine' });
    render(
      <App
        initial={loaded(store({ topics: [topic({ id: 'mine', name: 'Mine', windowId: 4 })] }))}
        api={api}
      />,
    );
    expect(await screen.findByText('This window')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save window' })).toBeNull();
  });

  it('unlinks an open topic from its window', async () => {
    const { api, sent } = fakeApi();
    render(
      <App
        initial={loaded(store({ topics: [topic({ id: 't', name: 'W', windowId: 3 })] }))}
        api={api}
      />,
    );
    menu('W');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Unlink W from its window' }));
    await waitFor(() => expect(sent).toEqual([{ type: 'detachWindow', topicId: 't' }]));
  });

  it('re-renders on storage changes', async () => {
    const { api, push } = fakeApi();
    render(<App initial={loaded()} api={api} />);
    push(loaded(store({ topics: [topic({ name: 'Arrived' })] })));
    expect(await screen.findByRole('heading', { name: 'Arrived' })).toBeTruthy();
  });

  it('shows a read error and offers only recovery actions', () => {
    const { api, sent } = fakeApi();
    render(<App initial={{ ok: false, error: 'bad data' }} api={api} />);
    expect(screen.getByRole('alert').textContent).toContain('could not be read');
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Download the stored data',
      'Start fresh…',
    ]);
    expect(sent).toEqual([]);
  });

  it('lists recently closed tabs with restore', async () => {
    const { api, sent } = fakeApi();
    const t = topic({
      id: 't1',
      name: 'Work',
      recentlyClosed: [{ ...savedTab({ id: 'c1', title: 'Lost tab' }), closedAt: 1 }],
    });
    render(<App initial={loaded(store({ topics: [t] }))} api={api} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show recently closed tabs of Work (1)' }));
    expect(screen.getByRole('dialog', { name: 'Work' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Restore Lost tab' }));
    await waitFor(() =>
      expect(sent).toEqual([
        { type: 'restoreTab', topicId: 't1', tabId: 'c1', from: 'recentlyClosed' },
      ]),
    );
  });

  it('reports tabs that failed to open', async () => {
    const { api } = fakeApi({ send: async () => ({ ok: true, data: { failed: 2 } }) });
    render(<App initial={loaded(store({ topics: [topic({ name: 'X' })] }))} api={api} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open X' }));
    expect(await screen.findByText('2 tabs could not be opened and moved to Parked.')).toBeTruthy();
  });

  it('lists parked tabs with restore', async () => {
    const { api, sent } = fakeApi();
    const t = topic({
      id: 't1',
      name: 'Work',
      parked: [{ ...savedTab({ id: 'p1', title: 'Idle tab' }), parkedAt: 1 }],
    });
    render(<App initial={loaded(store({ topics: [t] }))} api={api} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show parked tabs of Work (1)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore Idle tab' }));
    await waitFor(() =>
      expect(sent).toEqual([{ type: 'restoreTab', topicId: 't1', tabId: 'p1', from: 'parked' }]),
    );
  });

  it('renders 50 topics with 20 tabs each, building tab lists only when opened', () => {
    const { api } = fakeApi();
    const favicon = vi.fn((u: string) => `fav:${u}`);
    // Ten different sites per topic, so every card has more websites than icon slots.
    const topics = Array.from({ length: 50 }, (_, i) =>
      topic({
        name: `Topic ${i}`,
        tabs: Array.from({ length: 20 }, (_, j) =>
          savedTab({ url: `https://site${j % 10}.test/${j}` }),
        ),
      }),
    );
    render(<App initial={loaded(store({ topics }))} api={{ ...api, favicon }} />);
    expect(screen.getAllByRole('article')).toHaveLength(50);
    // Only the 6-site icon strip per card; tab lists render only in the drawer.
    expect(favicon).toHaveBeenCalledTimes(50 * 6);
    expect(document.querySelectorAll('.tab, .row')).toHaveLength(0);
  });

  it('Enter followed by blur renames once; Escape followed by blur renames nothing', async () => {
    const { api, sent } = fakeApi();
    render(
      <App initial={loaded(store({ topics: [topic({ id: 't1', name: 'Work' })] }))} api={api} />,
    );
    menu('Work');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename Work' }));
    let input = screen.getByLabelText('New name for Work');
    fireEvent.input(input, { target: { value: 'Play' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.blur(input);
    menu('Work');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename Work' }));
    input = screen.getByLabelText('New name for Work');
    fireEvent.input(input, { target: { value: 'Deep' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(sent).toEqual([{ type: 'renameTopic', topicId: 't1', name: 'Deep' }]),
    );
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'More actions for Work' }),
    );
  });

  it('shows no Undo when a delete fails', async () => {
    const { api } = fakeApi({ send: async () => ({ ok: false, error: 'Nope.' }) });
    render(<App initial={loaded(store({ topics: [topic({ name: 'X' })] }))} api={api} />);
    menu('X');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete X' }));
    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('hides the toast after 10 seconds unless hovered', async () => {
    vi.useFakeTimers();
    try {
      const { api } = fakeApi();
      render(<App initial={loaded(store({ topics: [topic({ name: 'X' })] }))} api={api} />);
      menu('X');
      fireEvent.click(screen.getByRole('menuitem', { name: 'Delete X' }));
      await vi.waitFor(() => screen.getByRole('button', { name: 'Undo' }));
      fireEvent.mouseEnter(document.querySelector('.toast')!);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeNull();
      fireEvent.mouseLeave(document.querySelector('.toast')!);
      await vi.advanceTimersByTimeAsync(10_001);
      expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports tabs left open by park', async () => {
    const { api } = fakeApi({ send: async () => ({ ok: true, data: { leftOpen: 1 } }) });
    render(
      <App initial={loaded(store({ topics: [topic({ name: 'X', windowId: 2 })] }))} api={api} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Park X' }));
    expect(
      await screen.findByText('1 tab could not be saved, so they were left open.'),
    ).toBeTruthy();
  });
});
