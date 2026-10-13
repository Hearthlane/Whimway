import { DateTime } from "luxon";
import { PlanRequest, PlanSpec } from "@/lib/schema";
import { fixtureLocations, fixturePlaces } from "@/lib/providers/fixtures";
export function request(index = 0) {
  const l = fixtureLocations[index];
  return PlanRequest.parse({
    location: l,
    area: { center: l.center, radius: 2000, locked: true },
    date: DateTime.now().setZone(l.timezone).plus({ days: 2 }).toISODate(),
    startTime: "12:00",
    duration: 240,
    budget: index === 1 ? 12000 : 65,
    participants: 3,
    mode: "WALK",
  });
}
export function spec(index = 0) {
  const req = request(index);
  return PlanSpec.parse({
    id: "c394c03b-cf7b-4b6a-8f24-69d119cb8e80",
    title: "Test outing",
    summary: "Fixture",
    request: req,
    stops: fixturePlaces(req)
      .slice(0, 3)
      .map((p) => ({
        placeId: p.id,
        minutes: 40,
        locked: false,
        reason: "Test stop",
      })),
    demo: true,
    revision: 0,
  });
}
