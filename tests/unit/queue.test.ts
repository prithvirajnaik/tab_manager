import { createWriteQueue } from '../../src/core/queue';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('createWriteQueue', () => {
  it('runs tasks one at a time in submission order', async () => {
    const queue = createWriteQueue();
    const log: string[] = [];
    const slow = queue.run(async () => {
      log.push('a:start');
      await tick();
      await tick();
      log.push('a:end');
      return 'a';
    });
    const fast = queue.run(async () => {
      log.push('b:start');
      log.push('b:end');
      return 'b';
    });
    expect(await Promise.all([slow, fast])).toEqual(['a', 'b']);
    expect(log).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });

  it('keeps running after a task fails and surfaces the error to its caller', async () => {
    const queue = createWriteQueue();
    const failed = queue.run(async () => {
      throw new Error('boom');
    });
    const next = queue.run(async () => 42);
    await expect(failed).rejects.toThrow('boom');
    expect(await next).toBe(42);
  });

  it('prevents lost updates in read-modify-write sequences', async () => {
    const queue = createWriteQueue();
    let stored = 0;
    const increment = () =>
      queue.run(async () => {
        const read = stored;
        await tick();
        stored = read + 1;
      });
    await Promise.all(Array.from({ length: 20 }, increment));
    expect(stored).toBe(20);
  });
});
