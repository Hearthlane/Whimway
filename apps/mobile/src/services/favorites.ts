import { DateTime } from "luxon";
import { PlanRequest, type CandidatePlace } from "../../../../lib/schema";
import type { FavoritePlaceRef } from "./storage-core";
import { api } from "./api";

export async function getFavoritePlaceDetails(
  ref: FavoritePlaceRef,
  signal?: AbortSignal,
): Promise<CandidatePlace> {
  // The existing details endpoint shares the planner contract. Real details
  // use only id/currency; the neutral request carries no personal location.
  const request = PlanRequest.parse({
    location: {
      name: "Saved place",
      center: { lat: 0, lng: 0 },
      timezone: ref.timezone,
      currency: ref.currency,
    },
    area: { center: { lat: 0, lng: 0 }, radius: 100, locked: false },
    date: DateTime.now().setZone(ref.timezone).toISODate(),
    startTime: "12:00",
    duration: 60,
    budget: 0,
    participants: 1,
    mode: "WALK",
  });
  return api<CandidatePlace>(
    "place",
    { id: ref.placeId, currency: ref.currency, request, demo: ref.demo },
    { signal },
  );
}
