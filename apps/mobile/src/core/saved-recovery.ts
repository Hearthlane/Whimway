import { PlanSpec, type Itinerary } from "../../../../lib/schema";
import { persistSpec } from "../../../../lib/storage";

export function canUnlockSavedStops(
  spec: PlanSpec,
  error: { code?: string },
): boolean {
  return (
    spec.stops.some((stop) => stop.locked) &&
    ["LOCK_CONFLICT", "PLACE_UNAVAILABLE"].includes(error.code ?? "")
  );
}
export function unlockedSavedStops(spec: PlanSpec): PlanSpec {
  return PlanSpec.parse({
    ...spec,
    revision: spec.revision + 1,
    stops: spec.stops.map((stop) => ({ ...stop, locked: false })),
  });
}
export async function commitRecoveredSavedPlan(
  original: PlanSpec,
  recovered: Itinerary,
  storage: {
    read: () => Promise<PlanSpec[]>;
    write: (plans: PlanSpec[]) => Promise<void>;
  },
  signal?: AbortSignal,
): Promise<void> {
  const check = () => {
    if (signal?.aborted) throw new Error("The request was cancelled.");
  };
  check();
  if (
    recovered.id !== original.id ||
    recovered.revision !== original.revision + 1 ||
    recovered.stops.some((stop) => stop.locked)
  )
    throw new Error(
      "The recovered plan did not match your unlocked saved plan. Please try again.",
    );
  if (!recovered.stops.length)
    throw new Error(
      "None of these places are available now. Keep your saved plan and start a new outing.",
    );
  const previous = await storage.read();
  check();
  const latest = previous.find((plan) => plan.id === original.id);
  if (
    !latest ||
    JSON.stringify(persistSpec(latest)) !==
      JSON.stringify(persistSpec(original))
  )
    throw new Error(
      "Your saved plan changed during this request. Open the latest copy and try again.",
    );
  const next = previous.map((plan) =>
    plan.id === original.id ? persistSpec(recovered) : plan,
  );
  // The caller serializes this entire transaction with other device writes.
  // Cancellation during an asynchronous write restores the original snapshot.
  try {
    await storage.write(next);
    check();
  } catch (error) {
    await storage.write(previous);
    throw error;
  }
}
