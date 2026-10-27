// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/preact';
import { App } from '../../src/ui/App';
import type { Api, LoadResult } from '../../src/ui/api';
import type { Command } from '../../src/core/messages';
import { savedTab, store, topic } from '../unit/factories';

afterEach(cleanup);

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
    currentWindowId: async () => null,
    ...overrides,
  };
  return { api, sent, push: (l: LoadResult) => push(l) };
}

const loaded = (s = store()): LoadResult => ({ ok: true, store: s });

describe('App', () => {
  it('shows an empty state and the save form when there are no topics', () => {
    const { api } = fakeApi();
    render(<App initial={loaded()} api={api} />);
    expect(screen.getByRole('heading', { name: 'No topics yet' })).toBeTruthy();
    expect(screen.getByLabelText('Save this window as')).toBeTruthy();
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
    expect(screen.getByText('Open', { selector: '.badge' })).toBeTruthy();
    expect(screen.getByText('Saved', { selector: '.badge' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Switch to' })).toBeTruthy();
  });

  it('sends open, park and rename commands', async () => {
    const { api, sent } = fakeApi();
    const t = topic({ id: 't1', name: 'Work', windowId: 9 });
    render(<App initial={loaded(store({ topics: [t] }))} api={api} />);
    fireEvent.click(screen.getByRole('button', { name: 'Switch to' }));
    await waitFor(() => expect(sent).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Park' }));
    await waitFor(() => expect(sent).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: 'Rename Work' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Rename Work' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Delete Gone' }));
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

  it('saves the current window and clears the form', async () => {
    const { api, sent } = fakeApi();
    render(<App initial={loaded()} api={api} />);
    const input = screen.getByLabelText('Save this window as') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'Japanese' } });
    fireEvent.submit(input.form!);
    await waitFor(() => expect(sent).toEqual([{ type: 'saveWindow', name: 'Japanese' }]));
    await waitFor(() => expect(input.value).toBe(''));
  });

  it('shows command errors', async () => {
    const { api } = fakeApi({ send: async () => ({ ok: false, error: 'Topic not found.' }) });
    render(<App initial={loaded(store({ topics: [topic()] }))} api={api} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Topic not found.');
  });

  it('marks the topic linked to this window and hides the save form', async () => {
    const { api } = fakeApi({ currentWindowId: async () => 4 });
    render(
      <App initial={loaded(store({ topics: [topic({ name: 'Mine', windowId: 4 })] }))} api={api} />,
    );
    expect(await screen.findByText('This window')).toBeTruthy();
    expect(screen.queryByLabelText('Save this window as')).toBeNull();
  });

  it('re-renders on storage changes', async () => {
    const { api, push } = fakeApi();
    render(<App initial={loaded()} api={api} />);
    push(loaded(store({ topics: [topic({ name: 'Arrived' })] })));
    expect(await screen.findByRole('heading', { name: 'Arrived' })).toBeTruthy();
  });

  it('shows a read error without offering to change anything', () => {
    const { api } = fakeApi();
    render(<App initial={{ ok: false, error: 'bad data' }} api={api} />);
    expect(screen.getByRole('alert').textContent).toContain('could not be read');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('lists recently closed tabs with restore', async () => {
    const { api, sent } = fakeApi();
    const t = topic({
      id: 't1',
      recentlyClosed: [{ ...savedTab({ id: 'c1', title: 'Lost tab' }), closedAt: 1 }],
    });
    render(<App initial={loaded(store({ topics: [t] }))} api={api} />);
    fireEvent.click(screen.getByRole('button', { name: 'Restore Lost tab' }));
    await waitFor(() =>
      expect(sent).toEqual([
        { type: 'restoreTab', topicId: 't1', tabId: 'c1', from: 'recentlyClosed' },
      ]),
    );
  });

  it('reports tabs that failed to open', async () => {
    const { api } = fakeApi({ send: async () => ({ ok: true, data: { failed: 2 } }) });
    render(<App initial={loaded(store({ topics: [topic()] }))} api={api} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(await screen.findByText('2 tabs could not be opened and moved to Parked.')).toBeTruthy();
  });

  it('lists parked tabs with restore', async () => {
    const { api, sent } = fakeApi();
    const t = topic({
      id: 't1',
      parked: [{ ...savedTab({ id: 'p1', title: 'Idle tab' }), parkedAt: 1 }],
    });
    render(<App initial={loaded(store({ topics: [t] }))} api={api} />);
    fireEvent.click(screen.getByRole('button', { name: 'Restore Idle tab' }));
    await waitFor(() =>
      expect(sent).toEqual([{ type: 'restoreTab', topicId: 't1', tabId: 'p1', from: 'parked' }]),
    );
  });

  it('renders 50 topics with 20 tabs each quickly', () => {
    const { api } = fakeApi();
    const topics = Array.from({ length: 50 }, (_, i) =>
      topic({ name: `Topic ${i}`, tabs: Array.from({ length: 20 }, () => savedTab()) }),
    );
    const start = performance.now();
    render(<App initial={loaded(store({ topics }))} api={api} />);
    const elapsed = performance.now() - start;
    expect(screen.getAllByRole('article')).toHaveLength(50);
    // Generous for jsdom on CI; a real browser is far faster.
    expect(elapsed).toBeLessThan(1500);
  });
});
