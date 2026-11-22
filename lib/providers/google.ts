import tzLookup from "tz-lookup";
import { DateTime } from "luxon";
import {
  CandidatePlace,
  PlacePhoto,
  type Location,
  type PlanRequest,
  type Point,
  type TravelLeg,
} from "../schema";
import { safeUrl } from "../geo";
import { AppError, providerFetch, requireEnv } from "../errors";
import { nearestArea } from "../areas";
import type { PlacesProvider, RouteProvider } from "./types";
import { z } from "zod";
const Money = z.object({
  currencyCode: z.string().optional(),
  units: z.union([z.string(), z.number()]).optional(),
  nanos: z.number().optional(),
});
const RawDate = z.object({
  year: z.number().int(),
  month: z.number().int(),
  day: z.number().int(),
});
const RawOpeningPoint = z.object({
  day: z.number().int().min(0).max(6),
  hour: z.number().int().min(0).max(23).optional(),
  minute: z.number().int().min(0).max(59).optional(),
  date: RawDate.optional(),
  truncated: z.boolean().optional(),
});
const RawHours = z.object({
  weekdayDescriptions: z.array(z.string()).optional(),
  periods: z
    .array(
      z.object({ open: RawOpeningPoint, close: RawOpeningPoint.optional() }),
    )
    .optional(),
});
const RawPlace = z.object({
  id: z.string(),
  displayName: z.object({ text: z.string() }).optional(),
  location: z.object({ latitude: z.number(), longitude: z.number() }),
  formattedAddress: z.string().optional(),
  primaryType: z.string().optional(),
  types: z.array(z.string()).optional(),
  googleMapsUri: z.string().optional(),
  websiteUri: z.string().optional(),
  rating: z.number().optional(),
  userRatingCount: z.number().optional(),
  businessStatus: z.string().optional(),
  photos: z
    .array(
      z.object({
        name: z.string(),
        authorAttributions: z
          .array(
            z.object({
              displayName: z.string().optional(),
              uri: z.string().optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
  priceRange: z
    .object({ startPrice: Money.optional(), endPrice: Money.optional() })
    .optional(),
  currentOpeningHours: RawHours.optional(),
  regularOpeningHours: RawHours.optional(),
  addressComponents: z
    .array(
      z.object({
        shortText: z.string().optional(),
        // Google occasionally omits types on a component; treat it as untyped.
        types: z.array(z.string()).default([]),
      }),
    )
    .optional(),
  accessibilityOptions: z
    .object({ wheelchairAccessibleEntrance: z.boolean().optional() })
    .optional(),
});
/**
 * With GOOGLE_MAPS_SERVER_KEY=proxy-injected the key lives in a network secret and the
 * egress proxy adds the X-Goog-Api-Key header, but only when the request carries none.
 * So the placeholder is never sent; a real key is sent as usual.
 */
const INJECTED = "proxy-injected";
function googleKey(): Record<string, string> {
  const key = requireEnv("GOOGLE_MAPS_SERVER_KEY");
  return key === INJECTED ? {} : { "X-Goog-Api-Key": key };
}
const fields =
  "id,displayName,location,formattedAddress,primaryType,types,googleMapsUri,businessStatus,rating,userRatingCount";
const detailFields = `${fields},websiteUri,photos,priceRange,currentOpeningHours,regularOpeningHours,addressComponents,accessibilityOptions`;
export const currencies: Record<string, string> = {
  CA: "CAD",
  US: "USD",
  JP: "JPY",
  GB: "GBP",
  FR: "EUR",
  DE: "EUR",
  ES: "EUR",
  IT: "EUR",
  NL: "EUR",
  PT: "EUR",
  IE: "EUR",
  AT: "EUR",
  BE: "EUR",
  FI: "EUR",
  GR: "EUR",
  AU: "AUD",
  NZ: "NZD",
  IN: "INR",
  SG: "SGD",
  KR: "KRW",
  CN: "CNY",
  HK: "HKD",
  TW: "TWD",
  TH: "THB",
  MX: "MXN",
  BR: "BRL",
  CH: "CHF",
  SE: "SEK",
  NO: "NOK",
  DK: "DKK",
  PL: "PLN",
  CZ: "CZK",
  ZA: "ZAR",
  AE: "AED",
  ID: "IDR",
  MY: "MYR",
  PH: "PHP",
  VN: "VND",
  TR: "TRY",
  HU: "HUF",
  IS: "ISK",
  IL: "ILS",
};
const moneyAmount = (m: z.infer<typeof Money>) =>
  Number(m.units ?? 0) + (m.nanos ?? 0) / 1e9;
export function normalize(input: unknown, currency: string): CandidatePlace {
  const p = RawPlace.parse(input);
  const type = p.primaryType ?? p.types?.[0] ?? "place";
  const browse = [
    "park",
    "shopping_mall",
    "public_library",
    "hiking_area",
    "beach",
    "garden",
  ].includes(type);
  const range = p.priceRange;
  const valid = Boolean(
    range?.startPrice &&
    range?.endPrice &&
    range.startPrice.currencyCode === currency &&
    range.endPrice.currencyCode === currency,
  );
  const low = valid ? moneyAmount(range!.startPrice!) : browse ? 0 : null,
    high = valid ? moneyAmount(range!.endPrice!) : browse ? 0 : null;
  const hours = p.currentOpeningHours ?? p.regularOpeningHours;
  const timezone = tzLookup(p.location.latitude, p.location.longitude);
  const today = DateTime.now().setZone(timezone).startOf("day");
  const dayString = (d: z.infer<typeof RawDate> | undefined) =>
    d
      ? `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`
      : undefined;
  const normalizePeriods = (periods: z.infer<typeof RawHours>["periods"]) =>
    (periods ?? []).map((period) => ({
      open: {
        day: period.open.day,
        hour: period.open.hour ?? 0,
        minute: period.open.minute ?? 0,
        date: dayString(period.open.date),
        truncated: period.open.truncated,
      },
      close: period.close
        ? {
            day: period.close.day,
            hour: period.close.hour ?? 0,
            minute: period.close.minute ?? 0,
            date: dayString(period.close.date),
            truncated: period.close.truncated,
          }
        : undefined,
    }));
  const periods = normalizePeriods(
    p.currentOpeningHours?.periods ?? p.regularOpeningHours?.periods,
  );
  const regularPeriods = normalizePeriods(p.regularOpeningHours?.periods);
  const dates = periods.flatMap((period) =>
    period.open.date ? [period.open.date] : [],
  );
  return CandidatePlace.parse({
    id: p.id,
    name: p.displayName?.text ?? "Unnamed place",
    point: { lat: p.location.latitude, lng: p.location.longitude },
    address: p.formattedAddress ?? "",
    category: type.replaceAll("_", " "),
    types: p.types ?? [],
    mapsUrl:
      safeUrl(p.googleMapsUri) ??
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.displayName?.text ?? "Place")}&query_place_id=${encodeURIComponent(p.id)}`,
    website: safeUrl(p.websiteUri),
    rating: p.rating,
    reviews: p.userRatingCount,
    businessStatus: p.businessStatus,
    photos: (p.photos ?? []).slice(0, 2).map((x) => ({
      name: x.name,
      authors: (x.authorAttributions ?? []).map((a) => ({
        name: a.displayName ?? "Photo contributor",
        uri: safeUrl(a.uri),
      })),
    })),
    price: {
      low,
      high,
      currency,
      source: valid ? "provider-range" : browse ? "free-browse" : "unknown",
      confidence: valid
        ? "published-range"
        : browse
          ? "category-estimate"
          : "unknown",
      optional: browse,
    },
    hours: hours?.weekdayDescriptions ?? [],
    periods,
    regularPeriods,
    timezone,
    hoursWindow:
      p.currentOpeningHours?.periods !== undefined
        ? { from: today.toISODate()!, to: today.plus({ days: 6 }).toISODate()! }
        : undefined,
    hoursSource: p.currentOpeningHours
      ? "applicable"
      : p.regularOpeningHours
        ? "typical"
        : "unknown",
    hoursDate: DateTime.now()
      .setZone(tzLookup(p.location.latitude, p.location.longitude))
      .toISODate()!,
    hoursDates: dates,
    wheelchairAccessible: p.accessibilityOptions?.wheelchairAccessibleEntrance,
  });
}
/**
 * Short-lived, bounded cache of successful Google responses, shared by every request on
 * this server. Guided planning asks for the same places several times while someone
 * browses and picks options; this keeps that to one paid call. Entries live minutes,
 * not days, in line with Google's limits on storing Places content. Concurrent identical
 * calls share one request.
 */
const CACHE_MAX = 500;
const cache = new Map<
  string,
  { at: number; ttl: number; value: Promise<unknown> }
>();
export function cached<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
): Promise<T> {
  if (process.env.WHIMWAY_PROVIDER_CACHE === "off") return load();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) {
    cache.delete(key);
    cache.set(key, hit); // most recently used last
    return hit.value as Promise<T>;
  }
  const value = load();
  cache.set(key, { at: Date.now(), ttl: ttlMs, value });
  value.catch(() => cache.delete(key)); // never keep failures
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return value;
}
/** Test hook. */
export const providerCache = cache;

async function call(path: string, body?: unknown, mask = fields) {
  const key = `places|${path}|${mask}|${body ? JSON.stringify(body) : ""}`;
  // Details change rarely within an hour; searches are kept for 15 minutes.
  const ttl = body ? 15 * 60_000 : 60 * 60_000;
  return cached(key, ttl, async () => {
    const r = await providerFetch(`https://places.googleapis.com/v1/${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        ...googleKey(),
        "X-Goog-FieldMask": mask,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json();
    if (!r.ok || data?.error)
      throw Object.assign(new Error("google"), { data });
    return data;
  }).catch((e: { data?: unknown }) => {
    // Callers handle Google's error body themselves, as before.
    if (e && typeof e === "object" && "data" in e) return e.data;
    throw e;
  });
}
const searches: Record<string, string> = {
  "Food & drinks": "restaurants and cafes",
  Shopping: "shopping",
  "Interactive fun": "escape rooms bowling interactive activities",
  Outdoors: "parks and gardens",
  "Arts & culture": "museums art galleries",
  Relaxation: "quiet cafes gardens",
  Nightlife: "bars live music",
  Family: "family activities playgrounds",
  "Hidden gems": "local cultural attractions",
  "Surprise me": "interesting things to do",
};
export class GooglePlaces implements PlacesProvider {
  async search(req: PlanRequest, query?: string) {
    const categories = query
      ? [query]
      : (req.interests.length ? req.interests : ["Surprise me"])
          .slice(0, 2)
          .map((i) => searches[i]);
    const mask = `places.${fields.split(",").join(",places.")}`;
    const jobs = categories.map((q) =>
      call(
        "places:searchText",
        {
          textQuery: `${q} near ${req.location.name}`,
          maxResultCount: 12,
          locationBias: {
            circle: {
              center: {
                latitude: req.area.center.lat,
                longitude: req.area.center.lng,
              },
              radius: req.area.radius,
            },
          },
          languageCode: "en",
        },
        mask,
      ),
    );
    if (!query) {
      const types: Record<string, string[]> = {
        "Food & drinks": ["restaurant", "cafe"],
        Shopping: ["shopping_mall"],
        "Interactive fun": ["bowling_alley"],
        Outdoors: ["park"],
        "Arts & culture": ["museum", "art_gallery"],
        Relaxation: ["park", "cafe"],
        Nightlife: ["bar"],
        Family: ["park", "amusement_park"],
        "Hidden gems": ["museum", "art_gallery"],
        "Surprise me": ["park", "museum", "cafe"],
      };
      jobs.push(
        call(
          "places:searchNearby",
          {
            includedTypes: [
              ...new Set(req.interests.flatMap((i) => types[i] ?? [])),
            ].slice(0, 10),
            maxResultCount: 12,
            locationRestriction: {
              circle: {
                center: {
                  latitude: req.area.center.lat,
                  longitude: req.area.center.lng,
                },
                radius: req.area.radius,
              },
            },
            languageCode: "en",
          },
          mask,
        ),
      );
    }
    const results = await Promise.all(jobs);
    return results
      .flatMap((r) =>
        // One malformed result is dropped instead of failing the whole search.
        (r.places ?? []).flatMap((p: unknown) => {
          try {
            return [normalize(p, req.location.currency)];
          } catch {
            return [];
          }
        }),
      )
      .slice(0, 36);
  }
  async details(id: string, currency: string) {
    if (!/^[\w-]+$/.test(id))
      throw new AppError("INVALID_PLACE", "Invalid place ID.");
    try {
      return normalize(
        await call(`places/${encodeURIComponent(id)}`, undefined, detailFields),
        currency,
      );
    } catch (error) {
      if (error instanceof AppError && error.upstreamStatus === 404)
        throw new AppError(
          "PLACE_UNAVAILABLE",
          "This destination is no longer retrievable. Replace it or remove it from the plan.",
          422,
        );
      throw error;
    }
  }
  async location(id: string, session?: string): Promise<Location> {
    if (!/^[\w-]+$/.test(id))
      throw new AppError("INVALID_PLACE", "Invalid location ID.");
    const raw = RawPlace.parse(
      await call(
        `places/${encodeURIComponent(id)}${session ? `?sessionToken=${encodeURIComponent(session)}` : ""}`,
        undefined,
        `${fields},addressComponents`,
      ),
    );
    const country = raw.addressComponents?.find((a) =>
      a.types.includes("country"),
    )?.shortText;
    return {
      placeId: raw.id,
      name: raw.displayName?.text ?? raw.formattedAddress ?? "Selected area",
      center: { lat: raw.location.latitude, lng: raw.location.longitude },
      timezone: tzLookup(raw.location.latitude, raw.location.longitude),
      currency: currencies[country ?? ""] ?? "USD",
    };
  }
}
export async function autocomplete(input: string, sessionToken: string) {
  const data = await call(
    "places:autocomplete",
    { input, sessionToken, includeQueryPredictions: false },
    "suggestions.placePrediction.placeId,suggestions.placePrediction.text",
  );
  return (data.suggestions ?? []).flatMap(
    (x: { placePrediction?: { placeId: string; text: { text: string } } }) =>
      x.placePrediction
        ? [{ id: x.placePrediction.placeId, text: x.placePrediction.text.text }]
        : [],
  );
}
export async function resolvePoint(point: Point): Promise<Location> {
  // The key goes in the header, like the other Google calls, so a network secret that
  // injects X-Goog-Api-Key works here too. A real key in the environment is also sent as
  // the query parameter for older Geocoding setups.
  const key = requireEnv("GOOGLE_MAPS_SERVER_KEY");
  const query = key === INJECTED ? "" : `&key=${encodeURIComponent(key)}`;
  const r = await providerFetch(
    `https://maps.googleapis.com/maps/api/geocode/json?latlng=${point.lat},${point.lng}${query}`,
    { headers: googleKey() },
  );
  const data = await r.json();
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    // Geocoding reads the key only from the query string, so with a proxy-injected key it
    // refuses. Inside the beta region the nearest neighbourhood is a good enough name.
    const near = key === INJECTED ? nearestArea(point) : undefined;
    if (near)
      return {
        center: point,
        name: near.name,
        timezone: near.timezone,
        currency: near.currency,
      };
    throw new AppError(
      "LOCATION_FAILED",
      "Could not look up this area. Check Geocoding API configuration.",
      502,
    );
  }
  const result = data.results?.[0];
  const country = result?.address_components?.find((x: { types: string[] }) =>
    x.types.includes("country"),
  )?.short_name;
  return {
    center: point,
    name: result?.formatted_address ?? "Dropped pin",
    timezone: tzLookup(point.lat, point.lng),
    currency: currencies[country ?? ""] ?? "USD",
  };
}
export class GoogleRoutes implements RouteProvider {
  async leg(
    from: Point,
    to: Point,
    mode: PlanRequest["mode"],
    fromId: string,
    toId: string,
  ): Promise<TravelLeg> {
    // The same pair of stops is routed again for every option and edit; reuse it briefly.
    const key = `route|${mode}|${from.lat.toFixed(5)},${from.lng.toFixed(5)}|${to.lat.toFixed(5)},${to.lng.toFixed(5)}`;
    const leg = await cached(key, 15 * 60_000, () =>
      this.fetchLeg(from, to, mode),
    );
    return { ...leg, from: fromId, to: toId };
  }
  private async fetchLeg(
    from: Point,
    to: Point,
    mode: PlanRequest["mode"],
  ): Promise<Omit<TravelLeg, "from" | "to">> {
    const response = await providerFetch(
      "https://routes.googleapis.com/directions/v2:computeRoutes",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...googleKey(),
          "X-Goog-FieldMask":
            "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline",
        },
        body: JSON.stringify({
          origin: {
            location: { latLng: { latitude: from.lat, longitude: from.lng } },
          },
          destination: {
            location: { latLng: { latitude: to.lat, longitude: to.lng } },
          },
          travelMode: mode,
          computeAlternativeRoutes: false,
          polylineQuality: "OVERVIEW",
          routingPreference: mode === "DRIVE" ? "TRAFFIC_UNAWARE" : undefined,
        }),
      },
    );
    const data = z
      .object({
        routes: z
          .array(
            z.object({
              duration: z.string().regex(/^\d+(\.\d+)?s$/),
              distanceMeters: z.number(),
              polyline: z.object({ encodedPolyline: z.string() }),
            }),
          )
          .min(1),
      })
      .safeParse(await response.json());
    if (!data.success)
      throw new AppError(
        "NO_ROUTE",
        "No usable route was returned. Try another transport mode or different stops.",
        422,
      );
    const r = data.data.routes[0];
    return {
      minutes: Math.ceil(parseFloat(r.duration) / 60),
      meters: r.distanceMeters,
      polyline: r.polyline.encodedPolyline,
      verified: true,
    };
  }
}
export async function photoUrl(name: string) {
  if (!/^places\/[\w-]+\/photos\/[\w-]+$/.test(name))
    throw new AppError("INVALID_PHOTO", "Invalid photo reference.");
  const data = await (
    await providerFetch(
      `https://places.googleapis.com/v1/${name}/media?maxWidthPx=1000&skipHttpRedirect=true`,
      { headers: googleKey() },
    )
  ).json();
  const url = safeUrl(data.photoUri);
  if (
    !url ||
    !["googleusercontent.com", "gstatic.com"].some((host) =>
      new URL(url).hostname.endsWith(`.${host}`),
    )
  )
    throw new AppError("INVALID_PHOTO", "Photo unavailable.", 502);
  return url;
}
export { PlacePhoto };

/**
 * Real map images (Maps Static API) for the browser build. Static Maps reads the key only
 * from the URL, so this needs a real key on the server: GOOGLE_MAPS_STATIC_KEY, or
 * GOOGLE_MAPS_SERVER_KEY when it holds the key itself rather than "proxy-injected".
 */
export function staticMapKey() {
  const own = process.env.GOOGLE_MAPS_STATIC_KEY;
  const server = process.env.GOOGLE_MAPS_SERVER_KEY;
  return own || (server && server !== INJECTED ? server : "");
}
export type StaticMapInput = {
  stops: Point[];
  /** Encoded route geometry per leg, or empty for a straight line. */
  paths: string[];
  width: number;
  height: number;
};
// Quiet basemap so the route and numbered stops stand out, in the app's ink colour.
const MAP_STYLE = [
  "feature:poi|visibility:off",
  "feature:transit|element:labels.icon|visibility:off",
  "element:labels.text.fill|color:0x4e5674",
  "feature:road|element:geometry|color:0xffffff",
  "feature:landscape|element:geometry|color:0xf1f3f7",
  "feature:water|element:geometry|color:0xcfe0ff",
  "feature:park|element:geometry|color:0xdcefe3",
];
export function staticMapUrl(input: StaticMapInput, key: string) {
  const q = new URLSearchParams({
    size: `${input.width}x${input.height}`,
    scale: "2",
    maptype: "roadmap",
    language: "en",
    key,
  });
  for (const style of MAP_STYLE) q.append("style", style);
  input.stops.forEach((s, i) =>
    q.append(
      "markers",
      `color:0x10173A|label:${(i + 1) % 10}|${s.lat.toFixed(6)},${s.lng.toFixed(6)}`,
    ),
  );
  input.stops.slice(1).forEach((to, i) => {
    const from = input.stops[i];
    const enc = input.paths[i];
    q.append(
      "path",
      enc
        ? `color:0x10173ACC|weight:5|enc:${enc}`
        : `color:0x10173A88|weight:4|${from.lat.toFixed(6)},${from.lng.toFixed(6)}|${to.lat.toFixed(6)},${to.lng.toFixed(6)}`,
    );
  });
  return `https://maps.googleapis.com/maps/api/staticmap?${q}`;
}
export async function staticMap(input: StaticMapInput) {
  const key = staticMapKey();
  if (!key)
    throw new AppError(
      "MAP_UNAVAILABLE",
      "Map images need a Google key on the server.",
      503,
    );
  const url = staticMapUrl(input, key);
  return cached(`staticmap|${url}`, 60 * 60_000, async () => {
    const r = await providerFetch(url);
    const type = r.headers.get("content-type") ?? "";
    if (!r.ok || !type.startsWith("image/"))
      throw new AppError(
        "MAP_UNAVAILABLE",
        "Google did not return a map image.",
        502,
      );
    return { type, body: new Uint8Array(await r.arrayBuffer()) };
  });
}

/**
 * Real map tiles (Map Tiles API) for the browser build. Unlike Static Maps this reads the
 * key from the X-Goog-Api-Key header, so it works with a proxy-injected key too. A
 * session token (valid about two weeks) is created once and reused.
 */
let tileSession: { token: string; until: number } | null = null;
const TILE_STYLES = [
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  {
    featureType: "transit",
    elementType: "labels.icon",
    stylers: [{ visibility: "off" }],
  },
  { elementType: "labels.text.fill", stylers: [{ color: "#4e5674" }] },
  {
    featureType: "road",
    elementType: "geometry",
    stylers: [{ color: "#ffffff" }],
  },
  {
    featureType: "landscape",
    elementType: "geometry",
    stylers: [{ color: "#f1f3f7" }],
  },
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ color: "#cfe0ff" }],
  },
  {
    featureType: "poi.park",
    elementType: "geometry",
    stylers: [{ color: "#dcefe3" }],
  },
];
async function tileToken() {
  if (tileSession && Date.now() < tileSession.until) return tileSession.token;
  const r = await providerFetch(
    "https://tile.googleapis.com/v1/createSession",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...googleKey() },
      body: JSON.stringify({
        mapType: "roadmap",
        language: "en-US",
        region: "CA",
        scale: "scaleFactor2x",
        highDpi: true,
        styles: TILE_STYLES,
      }),
    },
  );
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.session)
    throw new AppError(
      "MAP_UNAVAILABLE",
      "Map tiles are not enabled for this Google key.",
      503,
    );
  // Renew a day early.
  const expiry = Number(data.expiry) * 1000;
  tileSession = {
    token: data.session,
    until: (Number.isFinite(expiry) ? expiry : Date.now() + 7 * 864e5) - 864e5,
  };
  return tileSession.token;
}
export async function mapTile(z: number, x: number, y: number) {
  return cached(`tile|${z}|${x}|${y}`, 60 * 60_000, async () => {
    const token = await tileToken();
    const r = await providerFetch(
      `https://tile.googleapis.com/v1/2dtiles/${z}/${x}/${y}?session=${encodeURIComponent(token)}`,
      { headers: googleKey() },
    );
    const type = r.headers.get("content-type") ?? "";
    if (r.status === 401 || r.status === 403) tileSession = null;
    if (!r.ok || !type.startsWith("image/"))
      throw new AppError(
        "MAP_UNAVAILABLE",
        "Google did not return a map tile.",
        502,
      );
    return { type, body: new Uint8Array(await r.arrayBuffer()) };
  });
}
/** Test hook. */
export function resetTileSession() {
  tileSession = null;
}
