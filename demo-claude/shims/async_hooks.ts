// Browser stand-in: the demo has no per-request provider accounting.
export class AsyncLocalStorage<T> {
  getStore(): T | undefined {
    return undefined;
  }
  run<R>(_store: T, fn: () => R): R {
    return fn();
  }
}
