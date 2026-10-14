import { PlanRequest, type Itinerary } from "../../../../lib/schema";
export function updatedPlanSettings(
  previous: Itinerary["request"],
  values: Pick<Itinerary["request"], "budget" | "duration" | "mode">,
): Itinerary["request"] {
  return PlanRequest.parse({
    ...previous,
    ...values,
    // Zero is always Free. Moving back to a numeric amount restores the
    // ordinary budget preference; an explicit positive ceiling stays strict.
    hardBudget:
      values.budget === 0 || (previous.budget > 0 && previous.hardBudget),
  });
}
export function toggleStopLock(plan: Itinerary, placeId: string): Itinerary {
  if (!plan.stops.some((stop) => stop.placeId === placeId))
    throw new Error("This stop is no longer in your plan.");
  return {
    ...plan,
    revision: plan.revision + 1,
    stops: plan.stops.map((stop) =>
      stop.placeId === placeId ? { ...stop, locked: !stop.locked } : stop,
    ),
  };
}
