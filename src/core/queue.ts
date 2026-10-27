export type WriteQueue = {
  run<T>(task: () => Promise<T>): Promise<T>;
};

/** Serializes async tasks so two read-modify-write sequences can never interleave. */
export function createWriteQueue(): WriteQueue {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run(task) {
      const result = tail.then(task);
      tail = result.catch(() => undefined);
      return result;
    },
  };
}
