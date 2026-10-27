import { debounce } from '../../src/core/debounce';

describe('debounce', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs once, after the last call in a burst', () => {
    const fn = vi.fn();
    const trigger = debounce(fn, 300);
    trigger();
    vi.advanceTimersByTime(200);
    trigger();
    vi.advanceTimersByTime(299);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('fires by maxWait even while calls keep coming', () => {
    const fn = vi.fn();
    const trigger = debounce(fn, 300, 1000);
    for (let i = 0; i < 10; i++) {
      trigger();
      vi.advanceTimersByTime(200);
    }
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('runs again for a later burst', () => {
    const fn = vi.fn();
    const trigger = debounce(fn, 100);
    trigger();
    vi.advanceTimersByTime(100);
    trigger();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
