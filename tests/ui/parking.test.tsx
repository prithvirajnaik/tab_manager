// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { App } from '../../src/ui/App';
import type { Api } from '../../src/ui/api';
import type { Command, CommandResponse } from '../../src/core/messages';
import { savedTab, store, topic } from '../unit/factories';

afterEach(cleanup);

function setup(reply: (c: Command) => CommandResponse = () => ({ ok: true })) {
  const sent: Command[] = [];
  const api: Api = {
    send: async (c) => {
      sent.push(c);
      return reply(c);
    },
    subscribe: () => () => undefined,
    favicon: (u) => `fav:${u}`,
    currentTopicId: async () => null,
    download: () => undefined,
    rawStore: async () => '{}',
  };
  const s = store({
    topics: [
      topic({
        id: 't',
        name: 'Work',
        parked: [{ ...savedTab({ id: 'p1', title: 'Old doc' }), parkedAt: 1 }],
      }),
    ],
    unsortedParked: [{ ...savedTab({ id: 'u1', title: 'Loose page' }), parkedAt: 1 }],
  });
  render(<App initial={{ ok: true, store: s }} api={api} />);
  return { sent };
}

describe('parking panel', () => {
  beforeEach(() => history.replaceState(null, '', '#/settings'));

  it('changes the auto-park mode and days', async () => {
    const { sent } = setup();
    fireEvent.click(screen.getByLabelText('Preview only'));
    const days = screen.getByLabelText('Park after') as HTMLSelectElement;
    // The field is disabled while the first command runs.
    await waitFor(() => expect(days.disabled).toBe(false));
    fireEvent.change(days, { target: { value: '30' } });
    await waitFor(() =>
      expect(sent).toEqual([
        { type: 'updateSettings', autoParkMode: 'dry-run' },
        { type: 'updateSettings', autoParkDays: 30 },
      ]),
    );
  });

  it('offers a stored number of days that is not a preset', () => {
    const s = store();
    s.settings.autoParkDays = 21;
    const api: Api = {
      send: async () => ({ ok: true }),
      subscribe: () => () => undefined,
      favicon: (u) => u,
      currentTopicId: async () => null,
      download: () => undefined,
      rawStore: async () => '{}',
    };
    render(<App initial={{ ok: true, store: s }} api={api} />);
    const days = screen.getByLabelText('Park after') as HTMLSelectElement;
    expect(days.value).toBe('21');
    expect([...days.options].map((o) => o.value)).toEqual(['3', '7', '14', '21', '30', '60', '90']);
  });

  it('previews what would be parked without parking', async () => {
    const { sent } = setup((c) =>
      c.type === 'autoPark'
        ? {
            ok: true,
            data: {
              dryRun: true,
              tabs: [{ topicId: 't', topicName: 'Work', url: 'https://idle/', title: 'Idle page' }],
            },
          }
        : { ok: true },
    );
    fireEvent.click(screen.getByRole('button', { name: 'See what would be parked' }));
    expect(await screen.findByText('1 tab would be parked:')).toBeTruthy();
    expect(screen.getByText('Idle page')).toBeTruthy();
    expect(sent).toEqual([{ type: 'autoPark', dryRun: true }]);
  });
});

describe('parked view', () => {
  beforeEach(() => history.replaceState(null, '', '#/parked'));

  it('lists parked tabs by topic, then those without a topic', () => {
    setup();
    expect(screen.getByRole('heading', { level: 1, name: 'Parked tabs' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Work' }).textContent).toContain('Old doc');
    expect(screen.getByRole('region', { name: 'No topic' }).textContent).toContain('Loose page');
  });

  it('restores parked tabs one at a time or all at once', async () => {
    const { sent } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Restore Loose page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore Old doc' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Restore all parked tabs without a topic' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Restore all parked tabs of Work' }));
    await waitFor(() =>
      expect(sent).toEqual([
        { type: 'restoreUnsorted', tabId: 'u1' },
        { type: 'restoreTab', topicId: 't', tabId: 'p1', from: 'parked' },
        { type: 'restoreAllParked', topicId: null },
        { type: 'restoreAllParked', topicId: 't' },
      ]),
    );
  });

  it("restores all of a topic's parked tabs from its drawer", async () => {
    history.replaceState(null, '', '#/');
    const { sent } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Show parked tabs of Work (1)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore all parked tabs of Work' }));
    await waitFor(() => expect(sent).toEqual([{ type: 'restoreAllParked', topicId: 't' }]));
  });
});
