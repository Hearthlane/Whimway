import type { Itinerary, TravelLeg } from "../../../../lib/schema";
import { reconcileDayProgress, type DayProgress } from "./storage-core";
export function pendingDayStops(plan: Itinerary, progress: DayProgress) {
  return plan.stops.filter(
    (stop) =>
      !progress.completed.includes(stop.placeId) &&
      !progress.skipped.includes(stop.placeId),
  );
}
export function advanceDayProgress(
  plan: Itinerary,
  progress: DayProgress,
  placeId: string,
  status: "completed" | "skipped",
): DayProgress {
  if (progress.planId !== plan.id)
    throw new Error(
      "This progress belongs to another outing. Reopen your day.",
    );
  const current = reconcileDayProgress(progress, plan);
  if (!plan.stops.some((stop) => stop.placeId === placeId))
    throw new Error("This stop is no longer in your itinerary.");
  if (current.completed.includes(placeId) || current.skipped.includes(placeId))
    return current;
  return reconcileDayProgress(
    { ...current, [status]: [...current[status], placeId] },
    plan,
  );
}
export function remainingDayMetrics(
  plan: Itinerary,
  progress: DayProgress,
  guideLeg?: TravelLeg,
) {
  const pending = pendingDayStops(plan, progress),
    current = pending[0];
  const guidance =
    current && guideLeg?.verified && guideLeg.to === current.placeId
      ? guideLeg
      : undefined;
  return {
    minutes: Math.round(
      pending.reduce((sum, stop) => sum + stop.minutes + stop.travel, 0) -
        (guidance ? (current?.travel ?? 0) : 0) +
        (guidance?.minutes ?? 0),
    ),
    costHigh: pending.reduce(
      (sum, stop) => sum + (stop.place.price.high ?? 0),
      0,
    ),
    unknownPrices: pending.some((stop) => stop.place.price.high === null),
  };
}
