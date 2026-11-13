import { AsyncLocalStorage } from "node:async_hooks";
/** Per-operation provider accounting, used for "cost per generated plan" analytics. */
export type ProviderStats = {
  attempts: Record<string, number>;
  inputTokens: number;
  outputTokens: number;
};
type Store = { signal: AbortSignal; stats: ProviderStats };
const requests = new AsyncLocalStorage<Store>();
export function providerSignal() {
  return requests.getStore()?.signal;
}
export function providerStats() {
  return requests.getStore()?.stats;
}
export function withProviderContext<T>(
  signal: AbortSignal,
  operation: () => Promise<T>,
  budgetMs = 90000,
) {
  return requests.run(
    {
      signal: AbortSignal.any([signal, AbortSignal.timeout(budgetMs)]),
      stats: { attempts: {}, inputTokens: 0, outputTokens: 0 },
    },
    operation,
  );
}
