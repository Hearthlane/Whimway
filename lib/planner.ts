import { DateTime } from "luxon";
import { randomUUID } from "node:crypto";
import { dedupe, inside, distance } from "./geo";
import { localStart } from "./time";
import { hoursCheck } from "./hours";
export { hoursCheck } from "./hours";
import { AppError } from "./errors";
import { Selection as SelectionSchema } from "./schema";
import { preferenceScore, retrievalPreferences } from "./providers/preferences";
import type {
  CandidatePlace,
  Itinerary,
  ItineraryStop,
  PlanRequest,
  PlanSpec,
  Selection,
  TravelLeg,
  ValidationIssue,
} from "./schema";
import type {
  PlacesProvider,
  RecommendationProvider,
  RouteProvider,
} from "./providers/types";
export function costTotal(places: CandidatePlace[]) {
  return {
    low: places.reduce((n, p) => n + (p.price.low ?? 0), 0),
    high: places.reduce((n, p) => n + (p.price.high ?? 0), 0),
    unknown: places.filter((p) => p.price.high === null).length,
    currency: places[0]?.price.currency ?? "USD",
  };
}
export function candidatesFor(request: PlanRequest, places: CandidatePlace[]) {
  return dedupe(places).filter(
    (p) =>
      !["CLOSED_PERMANENTLY", "CLOSED_TEMPORARILY"].includes(
        p.businessStatus ?? "",
      ) &&
      !request.excludedPlaceIds.includes(p.id) &&
      (!request.area.locked ||
        inside(p.point, request.area.center, request.area.radius)) &&
      (!request.hardBudget ||
        (p.price.high !== null && p.price.high <= request.budget)) &&
      (!request.accessibility || p.wheelchairAccessible !== false),
  );
}
export function validateRequest(request: PlanRequest, now = DateTime.now()) {
  if (distance(request.location.center, request.area.center) > 1)
    throw new AppError(
      "AREA_MISMATCH",
      "The area centre must match the selected location.",
    );
  let start: DateTime;
  try {
    start = localStart(
      request.date,
      request.startTime,
      request.location.timezone,
    );
  } catch (e) {
    throw new AppError("INVALID_TIME", (e as Error).message);
  }

  if (start.toMillis() <= now.toMillis())
    throw new AppError(
      "PAST_TIME",
      "Choose a future start time in the selected area’s timezone.",
    );
  if (start > now.plus({ days: 365 }))
    throw new AppError("FUTURE_TIME", "Choose a date within the next year.");
  return start;
}
export async function schedule(
  spec: PlanSpec,
  places: CandidatePlace[],
  routes: RouteProvider,
  allowPartial = false,
  now = DateTime.now(),
): Promise<Itinerary> {
  let cursor = validateRequest(spec.request, now);
  const start = cursor;
  const req = spec.request;
  const candidates = candidatesFor(req, places);
  const byId = new Map(candidates.map((p) => [p.id, p]));
  const issues: ValidationIssue[] = [];
  const stops: ItineraryStop[] = [];
  const legs: TravelLeg[] = [];
  let previous = req.start;
  let previousId = "start";
  let calls = 0;
  const skip = (
    ref: PlanSpec["stops"][number],
    code: string,
    message: string,
  ) => {
    if (!allowPartial || ref.locked) throw new AppError(code, message, 422);
    issues.push({ code, message, severity: "warning" });
  };
  for (const ref of spec.stops) {
    const place = byId.get(ref.placeId);
    if (!place) {
      skip(
        ref,
        "INVALID_PLACE",
        "A destination is unavailable or fails the area, budget, or accessibility constraints.",
      );
      continue;
    }
    if (stops.some((s) => s.placeId === ref.placeId)) {
      skip(ref, "DUPLICATE_PLACE", "Duplicate destinations were removed.");
      continue;
    }
    let leg: TravelLeg | undefined;
    if (previous) {
      if (++calls > 16)
        throw new AppError(
          "ROUTE_LIMIT",
          "Too many route calculations. Try fewer stops.",
          422,
        );
      try {
        leg = await routes.leg(
          previous,
          place.point,
          req.mode,
          previousId,
          place.id,
        );
      } catch (error) {
        if (!(error instanceof AppError) || error.code !== "NO_ROUTE")
          throw error;
        skip(
          ref,
          "NO_ROUTE",
          "A destination has no usable route in your selected travel mode. Replace it or choose another mode.",
        );
        continue;
      }
    }
    const arrival = cursor.plus({ minutes: leg?.minutes ?? 0 });
    const departure = arrival.plus({ minutes: ref.minutes });
    const hours = hoursCheck(place, arrival, departure);
    if (hours.closed) {
      skip(
        ref,
        "CLOSED",
        "A destination does not fit its published opening hours. Adjust the start time or replace it.",
      );
      continue;
    }
    if (departure.diff(start, "minutes").minutes > req.duration) {
      skip(
        ref,
        "TOO_LONG",
        "A stop could not fit in your time window. Try a longer outing or shorter visits.",
      );
      continue;
    }
    const costs = costTotal([...stops.map((s) => s.place), place]);
    if (req.hardBudget && (costs.unknown > 0 || costs.high > req.budget)) {
      skip(
        ref,
        "BUDGET",
        "A stop cannot be confirmed within the hard budget. Try a free activity or adjust the ceiling.",
      );
      continue;
    }
    if (leg) legs.push(leg);
    stops.push({
      ...ref,
      place,
      arrival: arrival.toISO()!,
      departure: departure.toISO()!,
      travel: leg?.minutes ?? 0,
      hoursStatus: hours.label,
      hoursConfidence: hours.confidence,
    });
    cursor = departure;
    previous = place.point;
    previousId = place.id;
  }
  if (!stops.length)
    throw new AppError(
      "NO_SUITABLE_PLACES",
      "No suitable stops fit these constraints. Expand the radius, change interests, relax the budget, or choose another time.",
      422,
    );
  if (req.end && previous) {
    const leg = await routes.leg(
      previous,
      req.end,
      req.mode,
      previousId,
      "end",
    );
    if (
      cursor.plus({ minutes: leg.minutes }).diff(start, "minutes").minutes >
      req.duration
    )
      throw new AppError(
        "END_TOO_FAR",
        "Travel to the ending point does not fit your time window.",
        422,
      );
    legs.push(leg);
    cursor = cursor.plus({ minutes: leg.minutes });
  }
  const cost = costTotal(stops.map((s) => s.place));
  cost.currency = req.location.currency;
  if (cost.unknown)
    issues.push({
      code: "UNKNOWN_COST",
      message: `${cost.unknown} stop${cost.unknown === 1 ? " has" : "s have"} unknown prices. The budget cannot be confirmed.`,
      severity: "warning",
    });
  if (stops.some((stop) => stop.place.price.confidence === "category-estimate"))
    issues.push({
      code: "BROWSING_ESTIMATE",
      message:
        "Browsing costs are category estimates, not verified free admission. Entry fees, optional purchases and other extras may cost more; confirm with venues.",
      severity: "warning",
    });
  if (cost.high > req.budget)
    issues.push({
      code: "OVER_BUDGET",
      message: "The published upper price range exceeds your preferred budget.",
      severity: "warning",
    });
  if (req.mode === "DRIVE")
    issues.push({
      code: "TRANSPORT_COST",
      message:
        "Fuel, parking and tolls are not included. Driving times exclude live traffic.",
      severity: "warning",
    });
  if (req.hardBudget)
    issues.push({
      code: "BUDGET_ESTIMATE",
      message:
        "The ceiling applies to published ranges and browsing estimates. Taxes, tips, transport and purchases may cost extra.",
      severity: "warning",
    });
  if (req.dietary || req.accessibility)
    issues.push({
      code: "REQUIREMENTS_UNVERIFIED",
      message:
        "Confirm dietary and accessibility needs with each venue before going.",
      severity: "warning",
    });
  if (stops.some((s) => s.hoursConfidence !== "applicable"))
    issues.push({
      code: "HOURS_UNCERTAIN",
      message:
        "Some hours are typical or unavailable. Confirm the chosen date; admission and reservations are not checked.",
      severity: "warning",
    });
  if (
    issues.some((i) =>
      ["CLOSED", "TOO_LONG", "INVALID_PLACE", "BUDGET", "NO_ROUTE"].includes(
        i.code,
      ),
    )
  )
    issues.push({
      code: "PARTIAL",
      message:
        "This is a partial itinerary. Expand your area or adjust constraints to find more stops.",
      severity: "warning",
    });
  return {
    ...spec,
    stops,
    legs,
    issues,
    totalMinutes: Math.ceil(cursor.diff(start, "minutes").minutes),
    totalMeters: legs.reduce((n, l) => n + l.meters, 0),
    cost,
    createdAt: new Date().toISOString(),
  };
}
export class Planner {
  constructor(
    private places: PlacesProvider,
    private routes: RouteProvider,
    private ai: RecommendationProvider,
    private demo = false,
  ) {}
  async generate(
    request: PlanRequest,
    previous?: PlanSpec,
    action?: string,
  ): Promise<Itinerary> {
    validateRequest(request);
    if (previous?.stops.every((s) => s.locked))
      throw new AppError(
        "ALL_LOCKED",
        "All stops are locked. Unlock a stop before remixing.",
        422,
      );
    const locked = previous?.stops.filter((s) => s.locked) ?? [];
    const retrievalRequest = retrievalPreferences(request, action);
    const found = await this.places.search(retrievalRequest);
    const lockedPlaces = await Promise.all(
      locked.map(async (s) => {
        try {
          return await this.places.details(
            s.placeId,
            request.location.currency,
          );
        } catch (error) {
          if (error instanceof AppError && error.code === "PLACE_UNAVAILABLE")
            throw new AppError(
              "LOCK_CONFLICT",
              "A locked destination is no longer available. Unlock it and choose a replacement before remixing.",
              422,
            );
          throw error;
        }
      }),
    );
    let candidates = candidatesFor({ ...request, hardBudget: false }, [
      ...found,
      ...lockedPlaces,
    ]);
    if (!candidates.length)
      throw new AppError(
        "NO_SUITABLE_PLACES",
        "No suitable destinations were found inside your area. Expand the radius, change interests, or relax the budget.",
        422,
      );
    // Hydrate a bounded shortlist before AI selection, so hours and cost are provider data.
    candidates.sort(
      (a, b) =>
        quality(b) +
        preferenceScore(request, b, action) -
        quality(a) -
        preferenceScore(request, a, action),
    );
    const shortlist = diverseShortlist(candidates, lockedPlaces, 10);
    candidates = candidatesFor(
      request,
      await Promise.all(
        shortlist.map((p) =>
          this.places.details(p.id, request.location.currency),
        ),
      ),
    );
    if (
      locked.some(
        (stop) => !candidates.some((place) => place.id === stop.placeId),
      )
    )
      throw new AppError(
        "LOCK_CONFLICT",
        "A locked destination is closed or fails the current area, budget or access constraints. Unlock it and choose a replacement before remixing.",
        422,
      );
    if (!candidates.length)
      throw new AppError(
        "NO_SUITABLE_PLACES",
        "These places have no verifiable prices within your hard budget. Try browsing or outdoor interests, or use an estimated budget.",
        422,
      );
    let selection: Selection | undefined;
    // A single bounded repair with deterministic feedback; no unbounded provider loops.
    for (let attempt = 0; attempt < 2; attempt++) {
      const parsed = SelectionSchema.safeParse(
        await this.ai.select(
          request,
          candidates,
          locked,
          action,
          previous?.stops,
        ),
      );
      if (!parsed.success)
        throw new AppError(
          "INVALID_AI_OUTPUT",
          "The planner returned invalid stop data. Try generating again.",
          502,
        );
      selection = parsed.data;
      if (!previous && selection.stops.length > 6)
        throw new AppError(
          "INVALID_AI_OUTPUT",
          "The planner returned too many destinations for a new outing.",
          502,
        );
      if (
        selection.stops.some(
          (stop) =>
            stop.minutes > 180 &&
            !locked.some((lock) => lock.placeId === stop.placeId),
        )
      )
        throw new AppError(
          "INVALID_AI_OUTPUT",
          "A new destination visit exceeds the supported planning duration.",
          502,
        );
      const ids = new Set(candidates.map((p) => p.id));
      if (selection.stops.some((s) => !ids.has(s.placeId)))
        throw new AppError(
          "INVALID_AI_OUTPUT",
          "The AI selected an unknown place ID.",
          502,
        );
      for (const lock of locked) {
        const s = selection.stops.find((x) => x.placeId === lock.placeId);
        if (!s || s.minutes !== lock.minutes || s.reason !== lock.reason)
          throw new AppError(
            "LOCK_CONFLICT",
            "A locked stop would change. Try another remix.",
            422,
          );
      }
      const spec: PlanSpec = {
        id: previous?.id ?? randomUUID(),
        title: selection.title,
        summary: selection.summary,
        request,
        stops: optimizeOrder(
          selection.stops.map((s) => ({
            ...s,
            locked: locked.some((l) => l.placeId === s.placeId),
          })),
          candidates,
          request,
        ),
        demo: this.demo,
        areaSource: "user",
        revision: (previous?.revision ?? -1) + 1,
      };
      try {
        return await schedule(spec, candidates, this.routes, attempt === 1);
      } catch (e) {
        if (
          !(e instanceof AppError) ||
          attempt === 1 ||
          !["CLOSED", "TOO_LONG", "BUDGET", "NO_ROUTE"].includes(e.code)
        )
          throw e;
        action = `${action ?? ""} Repair the proposed schedule: ${e.message}`;
      }
    }
    throw new AppError(
      "PLANNING_FAILED",
      "Could not build a valid outing. Try adjusting constraints.",
      422,
    );
  }
  async edit(spec: PlanSpec) {
    const places = await Promise.all(
      spec.stops.map((s) =>
        this.places.details(s.placeId, spec.request.location.currency),
      ),
    );
    return schedule(
      { ...spec, revision: spec.revision + 1 },
      places,
      this.routes,
    );
  }
  async explore(request: PlanRequest, query?: string) {
    const basic = candidatesFor(
      { ...request, hardBudget: false },
      await this.places.search(
        query ? request : retrievalPreferences(request),
        query,
      ),
    );
    basic.sort(
      (a, b) =>
        quality(b) +
        preferenceScore(request, b) -
        quality(a) -
        preferenceScore(request, a),
    );
    const detailed = await Promise.all(
      diverseShortlist(basic, [], 10).map((p) =>
        this.places.details(p.id, request.location.currency),
      ),
    );
    return candidatesFor(request, detailed);
  }
  async hydrate(spec: PlanSpec): Promise<Itinerary> {
    let hydrated = spec;
    if (
      spec.areaSource === "place-reference" &&
      spec.request.location.placeId
    ) {
      const location = await this.places.location(
        spec.request.location.placeId,
      );
      hydrated = {
        ...spec,
        areaSource: "user",
        request: {
          ...spec.request,
          location: { ...location, currency: spec.request.location.currency },
          area: { ...spec.request.area, center: location.center },
        },
      };
    }
    const results = await Promise.allSettled(
      hydrated.stops.map((s) =>
        this.places.details(s.placeId, hydrated.request.location.currency),
      ),
    );
    const places: CandidatePlace[] = [];
    for (const [index, result] of results.entries()) {
      if (result.status === "fulfilled") places.push(result.value);
      else if (
        !(result.reason instanceof AppError) ||
        result.reason.code !== "PLACE_UNAVAILABLE" ||
        hydrated.stops[index].locked
      )
        throw result.reason;
    }
    if (spec.areaSource === "shared-stops" && places.length) {
      const base = places[0].point.lng;
      const center = {
        lat: places.reduce((n, p) => n + p.point.lat, 0) / places.length,
        lng:
          ((base +
            places.reduce(
              (n, p) => n + (((p.point.lng - base + 540) % 360) - 180),
              0,
            ) /
              places.length +
            540) %
            360) -
          180,
      };
      hydrated = {
        ...hydrated,
        request: {
          ...hydrated.request,
          location: { ...hydrated.request.location, center },
          area: {
            ...hydrated.request.area,
            center,
            radius: Math.max(
              100,
              Math.min(
                20000,
                Math.ceil(
                  Math.max(...places.map((p) => distance(p.point, center))),
                ),
              ),
            ),
            locked: false,
          },
        },
      };
    }
    // Historical plans may reopen; current provider details and route data always refresh.
    return schedule(
      hydrated,
      places,
      this.routes,
      true,
      localStart(
        hydrated.request.date,
        hydrated.request.startTime,
        hydrated.request.location.timezone,
      ).minus({ minutes: 1 }),
    );
  }
}
function quality(p: CandidatePlace) {
  const count = p.reviews ?? 0;
  return ((p.rating ?? 3) * count + 3.7 * 30) / (count + 30);
}

export function diverseShortlist(
  candidates: CandidatePlace[],
  locked: CandidatePlace[],
  cap: number,
) {
  const groups = new Map<string, CandidatePlace[]>();
  for (const p of candidates) {
    const group = groups.get(p.category) ?? [];
    group.push(p);
    groups.set(p.category, group);
  }
  const result = dedupe(locked);
  const seen = new Set(result.map((p) => p.id));
  while (result.length < cap && [...groups.values()].some((g) => g.length)) {
    for (const group of groups.values()) {
      const p = group.shift();
      if (p && !seen.has(p.id) && result.length < cap) {
        result.push(p);
        seen.add(p.id);
      }
    }
  }
  return result;
}
// Geography guides a bounded 2-opt pass; Google Routes still supplies all displayed travel data.
export function optimizeOrder(
  refs: PlanSpec["stops"],
  places: CandidatePlace[],
  request: PlanRequest,
) {
  const byId = new Map(places.map((p) => [p.id, p]));
  if (refs.some((s) => !byId.has(s.placeId))) return refs;
  const length = (items: typeof refs) =>
    items.reduce((n, s, i) => {
      const from = i ? byId.get(items[i - 1].placeId)!.point : request.start;
      return n + (from ? distance(from, byId.get(s.placeId)!.point) : 0);
    }, 0) +
    (request.end && items.length
      ? distance(byId.get(items.at(-1)!.placeId)!.point, request.end)
      : 0);
  const repeats = (items: typeof refs) =>
    items
      .slice(1)
      .filter(
        (s, i) =>
          byId.get(s.placeId)!.category ===
          byId.get(items[i].placeId)!.category,
      ).length;
  let best = [...refs];
  for (let pass = 0; pass < 2; pass++)
    for (let i = 0; i < best.length - 1; i++)
      for (let j = i + 1; j < best.length; j++) {
        if (best.slice(i, j + 1).some((s) => s.locked)) continue;
        const proposal = [
          ...best.slice(0, i),
          ...best.slice(i, j + 1).reverse(),
          ...best.slice(j + 1),
        ];
        if (
          repeats(proposal) <= repeats(best) &&
          length(proposal) < length(best) - 1
        )
          best = proposal;
      }
  return best;
}
