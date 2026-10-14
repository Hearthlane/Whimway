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
import { safeUrl, decodePolyline } from "../geo";
import { AppError, providerFetch, requireEnv } from "../errors";
import type { PlacesProvider, RouteProvider } from "./types";
import { z } from "zod";
import { currencyForCountry } from "./currency-data";
import { providerSignal } from "../server/provider-context";
export { currencies } from "./currency-data";
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
        types: z.array(z.string()),
      }),
    )
    .optional(),
  accessibilityOptions: z
    .object({ wheelchairAccessibleEntrance: z.boolean().optional() })
    .optional(),
});
const fields =
  "id,displayName,location,formattedAddress,primaryType,types,googleMapsUri,businessStatus,rating,userRatingCount";
const detailFields = `${fields},websiteUri,photos,priceRange,currentOpeningHours,regularOpeningHours,addressComponents,accessibilityOptions`;
const locationFields =
  "id,displayName,location,formattedAddress,addressComponents";
const operationReuseLimit = 64;
function checkOperation() {
  const signal = providerSignal();
  if (signal?.aborted)
    throw signal.reason?.name === "TimeoutError"
      ? new AppError(
          "REQUEST_TIMEOUT",
          "Planning took too long. Try fewer stops or adjust your outing and try again.",
          504,
        )
      : new AppError("REQUEST_CANCELLED", "This request was cancelled.", 499);
}
async function reuseWithinOperation<T>(
  pending: Map<string, Promise<T>>,
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  checkOperation();
  let result = pending.get(key);
  if (!result) {
    result = load();
    if (pending.size < operationReuseLimit) pending.set(key, result);
  }
  try {
    const value = await result;
    checkOperation();
    return value;
  } catch (error) {
    if (pending.get(key) === result) pending.delete(key);
    throw error;
  }
}
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
  const lower = range?.startPrice ? moneyAmount(range.startPrice) : null;
  const upper = range?.endPrice ? moneyAmount(range.endPrice) : null;
  const valid = Boolean(
    range?.startPrice &&
    range?.endPrice &&
    range.startPrice.currencyCode === currency &&
    range.endPrice.currencyCode === currency &&
    lower !== null &&
    upper !== null &&
    Number.isFinite(lower) &&
    Number.isFinite(upper) &&
    lower >= 0 &&
    upper >= lower,
  );
  const freeBrowse = browse && !range;
  const low = valid ? lower : freeBrowse ? 0 : null,
    high = valid ? upper : freeBrowse ? 0 : null;
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
      source: valid ? "provider-range" : freeBrowse ? "free-browse" : "unknown",
      confidence: valid
        ? "published-range"
        : freeBrowse
          ? "category-estimate"
          : "unknown",
      optional: freeBrowse,
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
async function call(path: string, body?: unknown, mask = fields) {
  const r = await providerFetch(`https://places.googleapis.com/v1/${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": requireEnv("GOOGLE_MAPS_SERVER_KEY"),
      "X-Goog-FieldMask": mask,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
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
  // The API creates a fresh provider for every operation. Never share these
  // promises across provider instances or persist provider-derived data.
  private readonly detailsInOperation = new Map<
    string,
    Promise<CandidatePlace>
  >();
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
        (r.places ?? []).map((p: unknown) =>
          normalize(p, req.location.currency),
        ),
      )
      .slice(0, 36);
  }
  async details(id: string, currency: string) {
    if (!/^[\w-]+$/.test(id))
      throw new AppError("INVALID_PLACE", "Invalid place ID.");
    const result = await reuseWithinOperation(
      this.detailsInOperation,
      JSON.stringify([id, currency]),
      () => this.fetchDetails(id, currency),
    );
    return structuredClone(result);
  }
  private async fetchDetails(id: string, currency: string) {
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
        locationFields,
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
      currency: currencyForCountry(country),
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
  const r = await providerFetch(
    `https://maps.googleapis.com/maps/api/geocode/json?latlng=${point.lat},${point.lng}&key=${encodeURIComponent(requireEnv("GOOGLE_MAPS_SERVER_KEY"))}`,
  );
  const data = await r.json();
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS")
    throw new AppError(
      "LOCATION_FAILED",
      "Could not look up this area. Check Geocoding API configuration.",
      502,
    );
  const result = data.results?.[0];
  const country = result?.address_components?.find((x: { types: string[] }) =>
    x.types.includes("country"),
  )?.short_name;
  return {
    center: point,
    name: result?.formatted_address ?? "Dropped pin",
    timezone: tzLookup(point.lat, point.lng),
    currency: currencyForCountry(country),
  };
}
export class GoogleRoutes implements RouteProvider {
  private readonly routesInOperation = new Map<
    string,
    Promise<Omit<TravelLeg, "from" | "to">>
  >();
  async leg(
    from: Point,
    to: Point,
    mode: PlanRequest["mode"],
    fromId: string,
    toId: string,
  ): Promise<TravelLeg> {
    // Key all effective provider options, including precise ordered endpoints.
    // IDs describe itinerary edges, not the route, and are remapped per caller.
    const body = JSON.stringify({
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
    });
    const route = await reuseWithinOperation(this.routesInOperation, body, () =>
      this.computeRoute(body),
    );
    return { from: fromId, to: toId, ...route };
  }
  private async computeRoute(
    body: string,
  ): Promise<Omit<TravelLeg, "from" | "to">> {
    const response = await providerFetch(
      "https://routes.googleapis.com/directions/v2:computeRoutes",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": requireEnv("GOOGLE_MAPS_SERVER_KEY"),
          "X-Goog-FieldMask":
            "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline",
        },
        body,
      },
    );
    const data = z
      .object({
        routes: z
          .array(
            z.object({
              duration: z
                .string()
                .regex(/^\d+(\.\d+)?s$/)
                .refine((value) => Number.isFinite(parseFloat(value))),
              distanceMeters: z.number().nonnegative(),
              polyline: z.object({
                encodedPolyline: z
                  .string()
                  .min(1)
                  .max(250000)
                  .regex(/^[\x3f-\x7e]+$/),
              }),
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
    try {
      const points = decodePolyline(r.polyline.encodedPolyline);
      const alreadyThere =
        points.length === 1 &&
        r.distanceMeters === 0 &&
        parseFloat(r.duration) === 0;
      if (
        (!alreadyThere && points.length < 2) ||
        points.length > 30000 ||
        points.some(
          (point) => Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180,
        )
      )
        throw new Error("Invalid route geometry");
    } catch {
      throw new AppError(
        "NO_ROUTE",
        "The routing service returned unusable route geometry. Try another travel mode or destination.",
        422,
      );
    }
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
      { headers: { "X-Goog-Api-Key": requireEnv("GOOGLE_MAPS_SERVER_KEY") } },
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
