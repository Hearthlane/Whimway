import type { Itinerary } from "../../../../lib/schema";
import type { DayProgress } from "./storage-core";
import { advanceDayProgress, pendingDayStops } from "./day-progress";

export const completionCancellationWarning =
  "Your day is complete. Remaining reminders could not be canceled. Try again below.";
type Ignored = { status: "busy" | "inactive" };
type CancellationResult = { status: "cancelled" | "failed" };
type SavedResult = {
  status: "saved";
  progress: DayProgress;
  complete: boolean;
  reminderWarning?: string;
};

// Native effects are injected so completion/recovery ordering can be tested
// without pretending that a unit test scheduled or canceled OS notifications.
export function createDayCompletionCoordinator(dependencies: {
  saveProgress: (progress: DayProgress) => Promise<void>;
  updateReminders: (plan: Itinerary) => Promise<unknown>;
  cancelReminders: (planId: string) => Promise<void>;
}) {
  const operations = new Map<string, Promise<unknown>>();
  const cancellationFailures = new Map<string, string>();
  const cancel = async (planId: string): Promise<CancellationResult> => {
    try {
      await dependencies.cancelReminders(planId);
      // Preserve failure throughout a retry; only actual success clears it.
      cancellationFailures.delete(planId);
      return { status: "cancelled" };
    } catch {
      cancellationFailures.set(planId, completionCancellationWarning);
      return { status: "failed" };
    }
  };
  function once<T>(
    planId: string,
    isActive: () => boolean,
    action: () => Promise<T>,
  ): Promise<T | Ignored> {
    if (!isActive()) return Promise.resolve({ status: "inactive" });
    if (operations.has(planId)) return Promise.resolve({ status: "busy" });
    const operation = Promise.resolve()
      .then(async (): Promise<T | Ignored> => {
        if (!isActive()) return { status: "inactive" };
        return action();
      })
      .finally(() => {
        if (operations.get(planId) === operation) operations.delete(planId);
      });
    operations.set(planId, operation);
    return operation;
  }
  return {
    cancellationFailure: (planId: string) => cancellationFailures.get(planId),
    async whenIdle(planId: string) {
      // A resumed screen reads progress after an earlier authorized save has
      // settled, including one that completed while the screen was unfocused.
      await operations.get(planId)?.catch(() => undefined);
    },
    cancelRemaining(planId: string, isActive: () => boolean) {
      return once(planId, isActive, () => cancel(planId));
    },
    finish(options: {
      plan: Itinerary;
      progress: DayProgress;
      placeId: string;
      status: "completed" | "skipped";
      isActive: () => boolean;
      onSaved: (progress: DayProgress) => void;
    }): Promise<SavedResult | Ignored> {
      const { plan, progress, placeId, status, isActive, onSaved } = options;
      return once(plan.id, isActive, async () => {
        const updated = advanceDayProgress(plan, progress, placeId, status);
        await dependencies.saveProgress(updated);
        if (isActive()) onSaved(updated);
        if (!pendingDayStops(plan, updated).length) {
          const result = await cancel(plan.id);
          return {
            status: "saved" as const,
            progress: updated,
            complete: true,
            ...(result.status === "failed"
              ? { reminderWarning: completionCancellationWarning }
              : {}),
          };
        }
        try {
          await dependencies.updateReminders(plan);
          return {
            status: "saved" as const,
            progress: updated,
            complete: false,
          };
        } catch {
          return {
            status: "saved" as const,
            progress: updated,
            complete: false,
            reminderWarning:
              "Progress saved. Reminder updates failed; open plan reminders to retry.",
          };
        }
      });
    },
  };
}
