import type { CandidatePlace, Point } from "./schema";
export function distance(a: Point, b: Point) {
  const rad = (n: number) => (n * Math.PI) / 180;
  const dlat = rad(b.lat - a.lat),
    dlng = rad(b.lng - a.lng);
  const h =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dlng / 2) ** 2;
  return (
    6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)))
  );
}
export function inside(a: Point, center: Point, radius: number) {
  return distance(a, center) <= radius + 0.1;
}
export function dedupe(places: CandidatePlace[]) {
  const seen = new Set<string>();
  return places.filter((p) => {
    if (
      seen.has(p.id) ||
      p.businessStatus === "CLOSED_PERMANENTLY" ||
      p.businessStatus === "CLOSED_TEMPORARILY"
    )
      return false;
    seen.add(p.id);
    return true;
  });
}
export function decodePolyline(encoded: string): Point[] {
  const points: Point[] = [];
  let index = 0,
    lat = 0,
    lng = 0;
  while (index < encoded.length) {
    const read = () => {
      let result = 0,
        shift = 0,
        b = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 31) << shift;
        shift += 5;
        if (shift > 30 || index > encoded.length)
          throw new Error("Invalid route geometry");
      } while (b >= 32);
      return result & 1 ? ~(result >> 1) : result >> 1;
    };
    lat += read();
    lng += read();
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}
export function safeUrl(value?: string) {
  if (!value) return undefined;
  try {
    const u = new URL(value);
    return u.protocol === "https:" ? u.href : undefined;
  } catch {
    return undefined;
  }
}
