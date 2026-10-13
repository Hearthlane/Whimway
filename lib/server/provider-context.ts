import { AsyncLocalStorage } from "node:async_hooks";
const requests = new AsyncLocalStorage<AbortSignal>();
export function providerSignal() {
  return requests.getStore();
}
export function withProviderContext<T>(
  signal: AbortSignal,
  operation: () => Promise<T>,
  budgetMs = 90000,
) {
  return requests.run(
    AbortSignal.any([signal, AbortSignal.timeout(budgetMs)]),
    operation,
  );
}
