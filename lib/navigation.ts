import type { Itinerary, PlanRequest, Point } from "./schema";

const coordinates = (point: Point) => `${point.lat},${point.lng}`;
const mapsMode = { WALK: "walking", TRANSIT: "transit", DRIVE: "driving" };
export const travelVerb = { WALK: "walk", TRANSIT: "transit", DRIVE: "drive" };
export const travelNoun = {
  WALK: "walking",
  TRANSIT: "by transit",
  DRIVE: "driving",
};
/** Directions to a single stop from the previous one (or current location). */
export function stopDirectionsUrl(
  to: { point: Point; placeId: string },
  mode: PlanRequest["mode"],
  from?: Point,
) {
  const params = new URLSearchParams({
    api: "1",
    destination: coordinates(to.point),
    destination_place_id: to.placeId,
    travelmode: mapsMode[mode],
  });
  if (from) params.set("origin", coordinates(from));
  return `https://www.google.com/maps/dir/?${params}`;
}

export function navigationUrl(plan: Itinerary) {
  if (plan.demo || !plan.stops.length) return undefined;
  const first = plan.stops[0];
  const last = plan.stops.at(-1)!;
  const params = new URLSearchParams({
    api: "1",
    origin: coordinates(plan.request.start ?? first.place.point),
    destination: coordinates(plan.request.end ?? last.place.point),
    travelmode: mapsMode[plan.request.mode],
  });
  if (!plan.request.start) params.set("origin_place_id", first.placeId);
  if (!plan.request.end) params.set("destination_place_id", last.placeId);
  const between = plan.stops.slice(
    plan.request.start ? 0 : 1,
    plan.request.end ? undefined : -1,
  );
  // Google Maps URLs do not support waypoints for transit; use per-stop links instead.
  if (plan.request.mode === "TRANSIT" && plan.stops.length > 1)
    return undefined;
  if (between.length) {
    params.set(
      "waypoints",
      between.map((s) => coordinates(s.place.point)).join("|"),
    );
    params.set("waypoint_place_ids", between.map((s) => s.placeId).join("|"));
  }
  return `https://www.google.com/maps/dir/?${params}`;
}
