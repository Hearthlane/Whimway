import type { Point, TravelLeg } from "../../../../lib/schema";
export type MapCoordinate = { latitude: number; longitude: number };
export const mapCoordinate = (point: Point): MapCoordinate => ({
  latitude: point.lat,
  longitude: point.lng,
});

/** Decode Google's encoded polyline, rejecting truncated / malformed data.
 * No line is fabricated when routing is unavailable. */
export function decodePolyline(value: string): MapCoordinate[] {
  if (!value || value.length > 250000) return [];
  const points: MapCoordinate[] = [];
  let index = 0,
    latitude = 0,
    longitude = 0;
  function component() {
    let result = 0,
      shift = 0,
      byte = 0;
    do {
      if (index >= value.length || shift > 30)
        throw new Error("Malformed polyline");
      byte = value.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63) throw new Error("Malformed polyline");
      result |= (byte & 31) << shift;
      shift += 5;
    } while (byte >= 32);
    return result & 1 ? ~(result >> 1) : result >> 1;
  }
  try {
    while (index < value.length) {
      latitude += component();
      longitude += component();
      const point = { latitude: latitude / 1e5, longitude: longitude / 1e5 };
      if (Math.abs(point.latitude) > 90 || Math.abs(point.longitude) > 180)
        return [];
      points.push(point);
      if (points.length > 30000) return [];
    }
    return points.length >= 2 ? points : [];
  } catch {
    return [];
  }
}
export function routeCoordinates(leg: TravelLeg): MapCoordinate[] {
  return leg.verified ? decodePolyline(leg.polyline) : [];
}
export function areaRegion(point: Point, radius = 1500) {
  const latitudeDelta = Math.max(0.005, Math.min(60, (radius * 2.8) / 111320));
  const longitudeDelta = Math.min(
    180,
    latitudeDelta / Math.max(0.05, Math.cos((point.lat * Math.PI) / 180)),
  );
  return { ...mapCoordinate(point), latitudeDelta, longitudeDelta };
}
