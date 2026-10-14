import type { Itinerary } from "../../../../lib/schema";
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
