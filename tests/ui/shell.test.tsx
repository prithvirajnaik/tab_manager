// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { App } from '../../src/ui/App';
import type { Api, LoadResult } from '../../src/ui/api';
import type { Command } from '../../src/core/messages';
import type { Store } from '../../src/core/model';
import { savedTab, store, topic } from '../unit/factories';

afterEach(cleanup);
beforeEach(() => {
  history.replaceState(null, '', '#/');
  localStorage.clear();
});

function setup(s: Store = data()) {
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
  };
  render(<App initial={{ ok: true, store: s }} api={api} />);
  return { sent, push: (next: Store) => push({ ok: true, store: next }) };
}

function data() {
  return store({
    topics: [
      topic({
        id: 'jp',
        name: 'Japanese',
        updatedAt: 1,
        tabs: [savedTab({ title: 'Kana' })],
        recentlyClosed: [{ ...savedTab({ id: 'c1', title: 'Old grammar' }), closedAt: 1 }],
      }),
      topic({ id: 'ai', name: 'AI', updatedAt: 5, tabs: [savedTab(), savedTab()] }),
    ],
  });
}

const cardNames = () =>
  screen.getAllByRole('article').map((a) => within(a).getByRole('heading').textContent);

describe('navigation', () => {
  it('names each rail icon on hover, with counts and none for zero', () => {
    setup();
    const nav = screen.getByRole('navigation', { name: 'Tab Topics' });
    const link = (name: RegExp) => within(nav).getByRole('link', { name });
    expect(link(/^Topics/).getAttribute('data-tip')).toBe('Topics (2)');
    expect(link(/Recently closed/).getAttribute('data-tip')).toBe('Recently closed (1)');
    expect(link(/Parked tabs/).getAttribute('data-tip')).toBe('Parked tabs');
    expect(link(/^Topics/).getAttribute('aria-current')).toBe('page');
  });

  it('switches views through the sidebar and the URL hash', async () => {
    setup();
    fireEvent.click(screen.getByRole('link', { name: /Recently closed/ }));
    expect(location.hash).toBe('#/closed');
    expect(screen.getByRole('heading', { level: 1, name: 'Recently closed' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Japanese' }).textContent).toContain('Old grammar');
    expect(screen.queryByRole('article')).toBeNull();

    history.replaceState(null, '', '#/settings');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Parking' })).toBeTruthy();
  });

  it('restores from the recently closed view', async () => {
    history.replaceState(null, '', '#/closed');
    const { sent } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Restore Old grammar' }));
    await waitFor(() =>
      expect(sent).toEqual([
        { type: 'restoreTab', topicId: 'jp', tabId: 'c1', from: 'recentlyClosed' },
      ]),
    );
  });

  it('explains empty views instead of showing zeros', () => {
    history.replaceState(null, '', '#/parked');
    setup(store({ topics: [topic({ name: 'X' })] }));
    expect(screen.getByRole('heading', { name: 'Nothing parked' })).toBeTruthy();
    expect(screen.getByText(/not looked at for 14 days/)).toBeTruthy();
  });
});

describe('topic drawer', () => {
  it('opens from a card chip, switches lists, and returns focus on Escape', () => {
    setup();
    const chip = screen.getByRole('button', { name: 'Show tabs of Japanese (1)' });
    chip.focus();
    fireEvent.click(chip);
    const dialog = screen.getByRole('dialog', { name: 'Japanese' });
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Close' }));
    expect(within(dialog).getByRole('tab', { name: /Tabs/ }).getAttribute('aria-selected')).toBe(
      'true',
    );
    fireEvent.keyDown(within(dialog).getByRole('tab', { name: /Tabs/ }), { key: 'ArrowRight' });
    expect(within(dialog).getByRole('tabpanel').textContent).toContain('Nothing is parked');
    fireEvent.click(within(dialog).getByRole('tab', { name: /Recently closed/ }));
    expect(within(dialog).getByRole('tabpanel').textContent).toContain('Old grammar');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(chip);
  });

  it('closes when its topic is deleted elsewhere', async () => {
    const { push } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Show tabs of Japanese (1)' }));
    const next = data();
    next.topics.shift();
    push(next);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('topic menu', () => {
  it('moves with arrow keys and closes with Escape, back on its button', () => {
    setup();
    const button = screen.getByRole('button', { name: 'More actions for Japanese' });
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const items = screen.getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['Rename', 'Delete']);
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0]!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('closes on a click outside', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Japanese' }));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('topics toolbar', () => {
  it('shows no stats line, and a card says only when it was updated', () => {
    setup();
    expect(screen.queryByText(/ open$/)).toBeNull();
    expect(document.querySelector('.toolbar .count')).toBeNull();
    const meta = screen
      .getAllByRole('article')
      .map((a) => a.querySelector('.card__meta')?.textContent);
    expect(meta.every((m) => m?.startsWith('Updated '))).toBe(true);
  });

  it('sorts, and freezes "Last updated" so cards do not jump on updates', async () => {
    const { push } = setup();
    expect(cardNames()).toEqual(['Japanese', 'AI']);
    fireEvent.change(screen.getByLabelText('Sort topics'), { target: { value: 'updated' } });
    expect(cardNames()).toEqual(['AI', 'Japanese']);
    expect(localStorage.getItem('tab-topics:sort')).toBe('updated');

    // Japanese is now the most recently updated, but the order stays put.
    const next = data();
    next.topics[0]!.updatedAt = 99;
    next.topics.push(topic({ id: 'new', name: 'New one', updatedAt: 50 }));
    push(next);
    await waitFor(() => expect(cardNames()).toEqual(['New one', 'AI', 'Japanese']));

    fireEvent.change(screen.getByLabelText('Sort topics'), { target: { value: 'name' } });
    expect(cardNames()).toEqual(['AI', 'Japanese', 'New one']);
  });

  it('remembers the sort and layout for the next visit', () => {
    localStorage.setItem('tab-topics:sort', 'name');
    localStorage.setItem('tab-topics:layout', 'list');
    setup();
    expect(cardNames()).toEqual(['AI', 'Japanese']);
    expect(screen.getByRole('button', { name: 'List view' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(document.querySelector('.grid--list')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Grid view' }));
    expect(document.querySelector('.grid--list')).toBeNull();
    expect(localStorage.getItem('tab-topics:layout')).toBe('grid');
  });

  it('ignores a stored preference it does not know', () => {
    localStorage.setItem('tab-topics:sort', 'bogus');
    setup();
    expect((screen.getByLabelText('Sort topics') as HTMLSelectElement).value).toBe('created');
  });
});

describe('topic card sites', () => {
  const sites = () =>
    store({
      topics: [
        topic({
          id: 'x',
          name: 'Mixed',
          tabs: [
            savedTab({ url: 'https://youtube.com/1' }),
            savedTab({ url: 'https://youtube.com/2' }),
            savedTab({ url: 'https://youtube.com/3' }),
            savedTab({ url: 'https://github.com/' }),
          ],
        }),
      ],
    });

  it('shows one icon per website, with a count badge only where there are several tabs', () => {
    setup(sites());
    const icons = [...document.querySelectorAll('.icons li')];
    expect(icons.map((li) => li.getAttribute('title'))).toEqual([
      'youtube.com · 3 tabs',
      'github.com · 1 tab',
    ]);
    expect(icons.map((li) => li.querySelector('.icons__n')?.textContent ?? null)).toEqual([
      '3',
      null,
    ]);
  });

  it('shows how many more websites there are past the icon row', () => {
    const tabs = Array.from({ length: 9 }, (_, i) => savedTab({ url: `https://s${i}.test/` }));
    setup(store({ topics: [topic({ name: 'Wide', tabs })] }));
    expect(document.querySelectorAll('.icons li:not(.icons__more)')).toHaveLength(6);
    expect(document.querySelector('.icons__more')?.textContent).toBe('+3');
  });

  it('shows the tab, parked and closed counts as buttons that open the drawer', () => {
    setup(data());
    const stats = within(screen.getAllByRole('article')[0]!).getAllByRole('button', {
      name: /^Show /,
    });
    expect(stats.map((b) => [b.getAttribute('title'), b.textContent])).toEqual([
      ['Tabs', '1'],
      ['Recently closed', '1'],
    ]);
  });
});

describe('appearance settings', () => {
  beforeEach(() => {
    history.replaceState(null, '', '#/settings');
    document.documentElement.removeAttribute('data-theme');
  });

  it('switches the theme, remembers it, and goes back to following the system', () => {
    setup();
    const root = document.documentElement;
    expect(root.hasAttribute('data-theme')).toBe(false);
    expect((screen.getByLabelText('System') as HTMLInputElement).checked).toBe(true);

    fireEvent.click(screen.getByLabelText('Dark'));
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('tab-topics:theme')).toBe('dark');

    fireEvent.click(screen.getByLabelText('Light'));
    expect(root.getAttribute('data-theme')).toBe('light');

    fireEvent.click(screen.getByLabelText('System'));
    expect(root.hasAttribute('data-theme')).toBe(false);
  });

  it('starts from the remembered theme', () => {
    localStorage.setItem('tab-topics:theme', 'dark');
    setup();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect((screen.getByLabelText('Dark') as HTMLInputElement).checked).toBe(true);
  });

  it('shares layout and sort with the topics toolbar', () => {
    setup();
    fireEvent.click(screen.getByLabelText('List'));
    fireEvent.change(screen.getByLabelText('Sort topics by'), { target: { value: 'name' } });
    expect(localStorage.getItem('tab-topics:layout')).toBe('list');
    expect(localStorage.getItem('tab-topics:sort')).toBe('name');
    fireEvent.click(screen.getByRole('link', { name: /^Topics/ }));
    expect(document.querySelector('.grid--list')).not.toBeNull();
    expect(cardNames()).toEqual(['AI', 'Japanese']);
    expect(screen.getByRole('button', { name: 'List view' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });
});

describe.each([
  ['glass', 'Glass effect', 'data-glass'],
  ['transparency', 'Transparency', 'data-transparency'],
] as const)('%s setting', (key, label, attr) => {
  beforeEach(() => {
    history.replaceState(null, '', '#/settings');
    document.documentElement.removeAttribute('data-glass');
    document.documentElement.removeAttribute('data-transparency');
  });
  const strength = (name: string) =>
    within(screen.getByRole('group', { name: `${label} strength` })).getByLabelText(name);

  it('is off by default, with the strength choice disabled', () => {
    setup();
    expect(document.documentElement.hasAttribute(attr)).toBe(false);
    expect((screen.getByRole('switch', { name: label }) as HTMLInputElement).checked).toBe(false);
    expect(strength('Medium').closest('fieldset')?.disabled).toBe(true);
  });

  it('turns on, changes strength, remembers both, and turns off', () => {
    setup();
    fireEvent.click(screen.getByRole('switch', { name: label }));
    expect(document.documentElement.getAttribute(attr)).toBe('medium');
    fireEvent.click(strength('Strong'));
    expect(document.documentElement.getAttribute(attr)).toBe('strong');
    expect(localStorage.getItem(`tab-topics:${key}`)).toBe('on');
    expect(localStorage.getItem(`tab-topics:${key}-level`)).toBe('strong');
    fireEvent.click(screen.getByRole('switch', { name: label }));
    expect(document.documentElement.hasAttribute(attr)).toBe(false);
    expect(localStorage.getItem(`tab-topics:${key}-level`)).toBe('strong');
  });

  it('starts from the remembered setting', () => {
    localStorage.setItem(`tab-topics:${key}`, 'on');
    localStorage.setItem(`tab-topics:${key}-level`, 'subtle');
    setup();
    expect(document.documentElement.getAttribute(attr)).toBe('subtle');
    expect((screen.getByRole('switch', { name: label }) as HTMLInputElement).checked).toBe(true);
  });

  it('is independent of the other effect', () => {
    setup();
    fireEvent.click(screen.getByRole('switch', { name: label }));
    const other = attr === 'data-glass' ? 'data-transparency' : 'data-glass';
    expect(document.documentElement.hasAttribute(other)).toBe(false);
  });
});
