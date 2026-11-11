import { decodePolyline } from "@shared/geo";
import type { Itinerary, Point } from "@shared/schema";

export type MapModel = {
  stops: { id: string; n: number; point: Point; name: string }[];
  /** One path per leg. `verified` = provider route geometry; otherwise a straight estimate. */
  paths: { points: Point[]; verified: boolean }[];
};
export function mapModel(plan: Itinerary): MapModel {
  const stops = plan.stops.map((s, i) => ({ id: s.placeId, n: i + 1, point: s.place.point, name: s.place.name }));
  const paths = plan.stops.slice(1).map((s, i) => {
    const leg = plan.legs.find((l) => l.to === s.placeId && l.from === plan.stops[i].placeId);
    if (leg?.polyline) {
      try {
        return { points: decodePolyline(leg.polyline), verified: leg.verified };
      } catch {
        // Fall through to a straight estimate.
      }
    }
    return { points: [plan.stops[i].place.point, s.place.point], verified: false };
  });
  return { stops, paths };
}
export function bounds(points: Point[]) {
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  return { minLat: Math.min(...lats), maxLat: Math.max(...lats), minLng: Math.min(...lngs), maxLng: Math.max(...lngs) };
}
