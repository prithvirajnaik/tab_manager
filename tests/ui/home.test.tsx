// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { App } from '../../src/ui/App';
import type { Command } from '../../src/core/messages';
import type { Api } from '../../src/ui/api';
import type { BackgroundStore } from '../../src/ui/background';
import { savedTab, store, topic } from '../unit/factories';

afterEach(cleanup);
beforeEach(() => {
  history.replaceState(null, '', location.pathname);
  localStorage.clear();
  URL.createObjectURL = () => 'blob:fake';
  URL.revokeObjectURL = () => undefined;
});

function memoryBackground(initial: Blob | null = null) {
  let image = initial;
  const calls: string[] = [];
  const background: BackgroundStore = {
    get: async () => image,
    set: async (b) => {
      calls.push('set');
      image = b;
    },
    clear: async () => {
      calls.push('clear');
      image = null;
    },
  };
  return { background, calls };
}

function setup(extra: Partial<Api> = {}) {
  const searches: string[] = [];
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
    webSearch: async (t) => void searches.push(t),
    ...extra,
  };
  const s = store({ topics: [topic({ id: 'jp', name: 'Japanese', tabs: [savedTab()] })] });
  render(<App initial={{ ok: true, store: s }} api={api} />);
  return { searches, sent };
}

const rail = () => document.querySelector('.sidebar') as HTMLElement;
const sheet = () => document.querySelector('.sheet') as HTMLElement;
const railOpen = () => rail().classList.contains('sidebar--open');
const sheetOpen = () => sheet().classList.contains('sheet--open');
const ctrlK = () => fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
const esc = () => fireEvent.keyDown(document.body, { key: 'Escape' });

const box = () => screen.getByRole('combobox', { name: 'Search the web' });
const type = (text: string) => fireEvent.input(box(), { target: { value: text } });

describe('home', () => {
  it('starts calm: only the search bar, with the rail and panel put away', () => {
    setup();
    expect(box()).toBeTruthy();
    expect(screen.queryByText(/for your topics/)).toBeNull();
    expect(railOpen()).toBe(false);
    expect(sheetOpen()).toBe(false);
    expect(location.hash).toBe('');
  });

  it('focuses the search bar and sends a trimmed search to the browser on Enter', () => {
    const { searches } = setup();
    expect(document.activeElement).toBe(box());
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(searches).toEqual([]);
    type('  rust lifetimes ');
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(searches).toEqual(['rust lifetimes']);
  });

  it('suggests your topics and saved tabs under the bar, and opens the one picked', async () => {
    const { searches, sent } = setup();
    type('jap');
    const options = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      'Search the web for “jap”',
      'JapaneseTopic · 1 tab',
    ]);
    expect(options[0]?.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    expect(options[1]?.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(box(), { key: 'Enter' });
    await waitFor(() => expect(sent).toEqual([{ type: 'openTopic', topicId: 'jp' }]));
    expect(searches).toEqual([]);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('picks a suggestion with the pointer and closes the list with Escape', () => {
    const { searches } = setup();
    type('rust');
    fireEvent.click(screen.getByRole('option', { name: /Search the web for/ }));
    expect(searches).toEqual(['rust']);
    type('rusty');
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.keyDown(box(), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('leaves the search bar out when the browser cannot search', () => {
    setup({ webSearch: undefined });
    expect(screen.queryByRole('combobox', { name: 'Search the web' })).toBeNull();
  });
});

describe('rail and panel', () => {
  it('toggles the rail with Ctrl+K and puts it away with Escape', () => {
    setup();
    ctrlK();
    expect(railOpen()).toBe(true);
    esc();
    expect(railOpen()).toBe(false);
    ctrlK();
    ctrlK();
    expect(railOpen()).toBe(false);
  });

  it('opens the rail when the pointer reaches the left edge', () => {
    setup();
    fireEvent.pointerEnter(document.querySelector('.edge') as HTMLElement);
    expect(railOpen()).toBe(true);
  });

  it('closes the rail when the home page is clicked', () => {
    setup();
    ctrlK();
    fireEvent.pointerDown(document.querySelector('.scrim') as HTMLElement);
    expect(railOpen()).toBe(false);
  });

  it('raises the panel for a rail item, then closes the panel before the rail', () => {
    setup();
    ctrlK();
    fireEvent.click(within(rail()).getByRole('link', { name: /Recently closed/ }));
    expect(location.hash).toBe('#/closed');
    expect(sheetOpen()).toBe(true);
    expect(
      within(sheet()).getByRole('heading', { level: 1, name: 'Recently closed' }),
    ).toBeTruthy();

    esc();
    expect(sheetOpen()).toBe(false);
    expect(location.hash).toBe('');
    expect(railOpen()).toBe(true);
    esc();
    expect(railOpen()).toBe(false);
  });

  it('closes everything with Ctrl+K and the panel with its close button', () => {
    setup();
    ctrlK();
    fireEvent.click(within(rail()).getByRole('link', { name: /^Topics/ }));
    ctrlK();
    expect(sheetOpen()).toBe(false);
    expect(railOpen()).toBe(false);

    ctrlK();
    fireEvent.click(within(rail()).getByRole('link', { name: /^Topics/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }));
    expect(sheetOpen()).toBe(false);
  });

  it('opens straight to a view named in the address, with the rail shown', () => {
    history.replaceState(null, '', '#/settings');
    setup();
    expect(sheetOpen()).toBe(true);
    expect(railOpen()).toBe(true);
    expect(within(sheet()).getByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy();
  });

  it('keeps the panel open when Escape is used inside a text field', () => {
    history.replaceState(null, '', '#/');
    setup();
    const box = screen.getByLabelText('Search all topics');
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(sheetOpen()).toBe(true);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(sheetOpen()).toBe(false);
  });

  it('follows the browser back button', async () => {
    setup();
    ctrlK();
    fireEvent.click(within(rail()).getByRole('link', { name: /^Topics/ }));
    expect(sheetOpen()).toBe(true);
    history.replaceState(null, '', location.pathname);
    act(() => void window.dispatchEvent(new PopStateEvent('popstate')));
    await waitFor(() => expect(sheetOpen()).toBe(false));
  });
});

describe('home background', () => {
  beforeEach(() => history.replaceState(null, '', '#/settings'));
  const png = (size = 10, type = 'image/png') =>
    new File([new Uint8Array(size)], 'bg.png', { type });
  const choose = (file: File) =>
    fireEvent.change(screen.getByLabelText('Choose a home background image'), {
      target: { files: [file] },
    });

  it('shows a saved image behind the home page', async () => {
    const { background } = memoryBackground(new Blob(['x'], { type: 'image/png' }));
    setup({ background });
    await waitFor(() => expect(document.querySelector('.home--image')).not.toBeNull());
    expect((document.querySelector('.home') as HTMLElement).style.backgroundImage).toContain(
      'blob:fake',
    );
  });

  it('saves a chosen image and removes it again', async () => {
    const { background, calls } = memoryBackground();
    setup({ background });
    expect(document.querySelector('.home--image')).toBeNull();
    choose(png());
    await waitFor(() => expect(document.querySelector('.home--image')).not.toBeNull());
    expect(calls).toEqual(['set']);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(document.querySelector('.home--image')).toBeNull());
    expect(calls).toEqual(['set', 'clear']);
  });

  it('refuses a file that is not a usable image, or is too large', async () => {
    const { background, calls } = memoryBackground();
    setup({ background });
    choose(png(10, 'image/svg+xml'));
    expect((await screen.findByRole('alert')).textContent).toContain('PNG, JPEG, WebP or GIF');
    choose(png(9 * 1024 * 1024));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('8 MB'));
    expect(calls).toEqual([]);
  });

  it('leaves the setting out when the browser cannot keep a background', () => {
    setup();
    expect(screen.queryByText('Home background')).toBeNull();
  });
});
