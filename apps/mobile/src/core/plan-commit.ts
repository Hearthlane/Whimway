export type PlanCommitOptions = {
  signal?: AbortSignal;
  persist?: boolean;
  refreshReminders?: boolean;
};
export type PlanPersistenceOptions = {
  signal?: AbortSignal;
  // The storage adapter calls this synchronously after its write/check, while
  // holding the same queue that protects rollback and all other plan writes.
  onCommit: () => void;
};
export async function commitPlan<T>(
  next: T,
  actions: {
    persist: (plan: T, options: PlanPersistenceOptions) => Promise<void>;
    commit: (plan: T) => void;
    refreshReminders: (plan: T) => Promise<void>;
  },
  options: PlanCommitOptions = {},
): Promise<void> {
  const check = () => {
    if (options.signal?.aborted) throw new Error("The request was cancelled.");
  };
  let accepted = false;
  const accept = () => {
    check();
    if (!accepted) {
      actions.commit(next);
      accepted = true;
    }
  };
  check();
  if (options.persist !== false)
    await actions.persist(next, { signal: options.signal, onCommit: accept });
  check();
  // Nonpersistent hydration and simple persistence adapters still share the
  // same acceptance check. Native storage accepts inside its transaction.
  if (!accepted) accept();
  check();
  // Acceptance is the durable/state boundary. Later cancellation stops the
  // caller's continuation; it never rolls back an accepted or newer plan.
  if (options.refreshReminders !== false) {
    await actions.refreshReminders(next);
    check();
  }
}
