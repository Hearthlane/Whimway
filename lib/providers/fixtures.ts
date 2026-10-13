// Explicitly synthetic provider fixtures. Never used for live requests or production.
import {
  CandidatePlace,
  type PlanRequest,
  type Location,
  type Point,
  type Selection,
} from "../schema";
import { distance } from "../geo";
import { AppError } from "../errors";
import type {
  PlacesProvider,
  RecommendationProvider,
  RouteProvider,
} from "./types";
export const fixtureLocations: Location[] = [
  {
    name: "CF Toronto Eaton Centre",
    placeId: "fixture-toronto",
    center: { lat: 43.6544, lng: -79.3807 },
    timezone: "America/Toronto",
    currency: "CAD",
  },
  {
    name: "Shibuya, Tokyo",
    placeId: "fixture-shibuya",
    center: { lat: 35.6595, lng: 139.7005 },
    timezone: "Asia/Tokyo",
    currency: "JPY",
  },
  {
    name: "Remote area (empty fixture)",
    placeId: "fixture-sparse",
    center: { lat: 64.2, lng: -110.5 },
    timezone: "America/Edmonton",
    currency: "CAD",
  },
];
export function fixturePlaces(req: PlanRequest): CandidatePlace[] {
  if (req.location.center.lat > 60) return [];
  const jp = req.location.timezone === "Asia/Tokyo";
  const base = fixtureLocations[jp ? 1 : 0].center;
  const labels = jp
    ? [
        "Shibuya Crossing",
        "Yoyogi Park",
        "Shibuya PARCO",
        "Hachikō Memorial Statue",
        "Shibuya Stream",
        "Miyashita Park",
      ]
    : [
        "CF Toronto Eaton Centre",
        "Allan Gardens",
        "Art Gallery of Ontario",
        "Nathan Phillips Square",
        "St. Lawrence Market",
        "Trinity Square",
      ];
  return labels.map((name, i) =>
    CandidatePlace.parse({
      id: `fixture-${jp ? "jp" : "ca"}-${i}`,
      name,
      point: {
        lat: base.lat + [0, 0.003, -0.005, 0.002, -0.007, 0.004][i],
        lng: base.lng + [0, 0.003, -0.005, -0.004, 0.003, 0.006][i],
      },
      address: "Synthetic test address · not live place data",
      category: [
        "shopping mall",
        "park",
        "art gallery",
        "plaza",
        "market",
        "park",
      ][i],
      types: [
        [
          "shopping_mall",
          "park",
          "art_gallery",
          "tourist_attraction",
          "market",
          "park",
        ][i],
      ],
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}`,
      rating: 4.3,
      reviews: 500,
      photos: [],
      price: {
        low: 0,
        high: i === 2 ? (jp ? 1500 : 25) : 0,
        currency: req.location.currency,
        source: i === 2 ? "provider-range" : "free-browse",
        confidence: i === 2 ? "published-range" : "category-estimate",
        optional: i !== 2,
      },
      hours: ["Fixture hours: 00:00–24:00 (not verified)"],
      periods: [{ open: { day: 0, hour: 0, minute: 0 } }],
      hoursSource: "typical",
      wheelchairAccessible: true,
      businessStatus: "OPERATIONAL",
    }),
  );
}
export class FixturePlaces implements PlacesProvider {
  constructor(private req: PlanRequest) {}
  async search(req: PlanRequest, query?: string) {
    const all = fixturePlaces(req);
    return query
      ? all.filter(
          (p) =>
            p.name.toLowerCase().includes(query.toLowerCase()) ||
            p.category.includes(query.toLowerCase()),
        )
      : all;
  }
  async details(id: string) {
    const place = fixturePlaces(this.req).find((p) => p.id === id);
    if (!place)
      throw new AppError(
        "PLACE_UNAVAILABLE",
        "This saved destination is no longer available.",
        422,
      );
    return place;
  }
  async location(id: string) {
    const p = fixtureLocations.find((l) => l.placeId === id);
    if (!p)
      throw new AppError("LOCATION_FAILED", "Fixture location not found.");
    return p;
  }
}
export class FixtureRoutes implements RouteProvider {
  async leg(
    from: Point,
    to: Point,
    mode: PlanRequest["mode"],
    fromId: string,
    toId: string,
  ) {
    const meters = Math.round(distance(from, to) * 1.2);
    return {
      from: fromId,
      to: toId,
      minutes: Math.ceil(meters / (mode === "WALK" ? 75 : 400)),
      meters,
      polyline: "",
      verified: false,
    };
  }
}
export class FixtureAI implements RecommendationProvider {
  async select(
    req: PlanRequest,
    candidates: CandidatePlace[],
    locked: { placeId: string; minutes: number; reason: string }[],
    action?: string,
  ): Promise<Selection> {
    const available = candidates.filter(
      (p) => !locked.some((l) => l.placeId === p.id),
    );
    if (action?.includes("cheaper"))
      available.sort(
        (a, b) => (a.price.high ?? Infinity) - (b.price.high ?? Infinity),
      );
    if (action?.includes("relaxing"))
      available.sort(
        (a, b) =>
          Number(b.types.includes("park")) - Number(a.types.includes("park")),
      );
    if (action) available.reverse();
    const n = action?.includes("shorter") ? 2 : 4;
    return {
      title:
        req.location.timezone === "Asia/Tokyo"
          ? "A little Shibuya adventure"
          : "A day with a little more whim",
      summary:
        "Development fixture: inspect planning, maps, and editing. These venue details, prices and hours are synthetic.",
      stops: [
        ...locked,
        ...available.slice(0, Math.max(0, n - locked.length)).map((p) => ({
          placeId: p.id,
          minutes: 40,
          reason: "A varied stop in this explicitly labelled test itinerary.",
        })),
      ],
    };
  }
}
