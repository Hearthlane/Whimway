import type { Itinerary, Point } from "./schema";

const coordinates = (point: Point) => `${point.lat},${point.lng}`;

export function navigationUrl(plan: Itinerary) {
  if (plan.demo || !plan.stops.length) return undefined;
  const first = plan.stops[0];
  const last = plan.stops.at(-1)!;
  const params = new URLSearchParams({
    api: "1",
    origin: coordinates(plan.request.start ?? first.place.point),
    destination: coordinates(plan.request.end ?? last.place.point),
    travelmode: plan.request.mode === "WALK" ? "walking" : "driving",
  });
  if (!plan.request.start) params.set("origin_place_id", first.placeId);
  if (!plan.request.end) params.set("destination_place_id", last.placeId);
  const between = plan.stops.slice(
    plan.request.start ? 0 : 1,
    plan.request.end ? undefined : -1,
  );
  if (between.length) {
    params.set(
      "waypoints",
      between.map((s) => coordinates(s.place.point)).join("|"),
    );
    params.set("waypoint_place_ids", between.map((s) => s.placeId).join("|"));
  }
  return `https://www.google.com/maps/dir/?${params}`;
}
