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
  it('changes the auto-park mode and days', async () => {
    const { sent } = setup();
    fireEvent.change(screen.getByLabelText('Auto-park'), { target: { value: 'dry-run' } });
    const days = screen.getByLabelText('after') as HTMLInputElement;
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

  it('ignores an out-of-range number of days', async () => {
    const { sent } = setup();
    const days = screen.getByLabelText('after') as HTMLInputElement;
    fireEvent.input(days, { target: { value: '0' } });
    fireEvent.change(days, { target: { value: '0' } });
    expect(sent).toEqual([]);
    await waitFor(() => expect(days.value).toBe('14'));
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
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText('1 tab would be parked:')).toBeTruthy();
    expect(screen.getByText('Idle page')).toBeTruthy();
    expect(sent).toEqual([{ type: 'autoPark', dryRun: true }]);
  });

  it('restores unsorted parked tabs one at a time or all at once', async () => {
    const { sent } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Restore Loose page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore all' }));
    await waitFor(() =>
      expect(sent).toEqual([
        { type: 'restoreUnsorted', tabId: 'u1' },
        { type: 'restoreAllParked', topicId: null },
      ]),
    );
  });

  it("restores all of a topic's parked tabs from its card", async () => {
    const { sent } = setup();
    const details = screen.getByText('Parked (1)').closest('details')!;
    details.open = true;
    fireEvent(details, new Event('toggle'));
    fireEvent.click(screen.getByRole('button', { name: 'Restore all parked tabs of Work' }));
    await waitFor(() => expect(sent).toEqual([{ type: 'restoreAllParked', topicId: 't' }]));
  });
});
