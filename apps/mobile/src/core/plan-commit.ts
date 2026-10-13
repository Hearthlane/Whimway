export type PlanCommitOptions = { signal?: AbortSignal; persist?: boolean };
export async function commitPlan<T>(
  next: T,
  actions: {
    persist: (plan: T) => Promise<void>;
    commit: (plan: T) => void;
    refreshReminders: (plan: T) => Promise<void>;
  },
  options: PlanCommitOptions = {},
): Promise<void> {
  const check = () => {
    if (options.signal?.aborted) throw new Error("The request was cancelled.");
  };
  check();
  if (options.persist !== false) await actions.persist(next);
  check();
  actions.commit(next);
  check();
  await actions.refreshReminders(next);
}
