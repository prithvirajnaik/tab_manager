/** A storage area such as chrome.storage.local, reduced to what the core needs. */
export type KeyValueArea = {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};

export type Clock = () => number;
