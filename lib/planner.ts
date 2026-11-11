import { DateTime } from "luxon";
import { randomUUID } from "node:crypto";
import { dedupe, inside, distance } from "./geo";
import { localStart } from "./time";
import { hoursCheck } from "./hours";
export { hoursCheck } from "./hours";
import { AppError } from "./errors";
import { Selection as SelectionSchema } from "./schema";
import { interpretEdit, type EditOp } from "./magic-edit";
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
import { isOutdoor, vibeFit } from "./planner-filters";
export { isOutdoor };
/** Review-weighted quality nudged by the user's learned category affinity. */
export function score(
  p: CandidatePlace,
  request?: Partial<Pick<PlanRequest, "affinity" | "vibes">>,
) {
  const affinity = request?.affinity ?? {};
  const taste = Math.max(
    -3,
    Math.min(
      3,
      [p.category, ...p.types].reduce(
        (n, key) => n + (affinity[key.toLowerCase()] ?? 0),
        0,
      ),
    ),
  );
  return quality(p) + taste * 0.15 + vibeFit(p, request?.vibes ?? []) * 0.2;
}
/**
 * True unless known hours show the place closed for every 30-minute slot of the
 * outing. Unknown hours pass (and are labelled later), so we never invent closures.
 */
export function openDuring(place: CandidatePlace, request: PlanRequest) {
  let start: DateTime;
  try {
    start = localStart(
      request.date,
      request.startTime,
      request.location.timezone,
    );
  } catch {
    return true;
  }
  for (let t = 0; t + 30 <= request.duration; t += 30) {
    const check = hoursCheck(
      place,
      start.plus({ minutes: t }),
      start.plus({ minutes: t + 30 }),
    );
    if (!check.closed) return true;
  }
  return false;
}
export function candidatesFor(request: PlanRequest, places: CandidatePlace[]) {
  return dedupe(places).filter(
    (p) =>
      !request.excludedPlaceIds.includes(p.id) &&
      (!request.area.locked ||
        inside(p.point, request.area.center, request.area.radius)) &&
      (!request.hardBudget ||
        (p.price.high !== null && p.price.high <= request.budget)) &&
      (!request.accessibility || p.wheelchairAccessible !== false) &&
      (!request.indoorOnly || !isOutdoor(p)),
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
    if (!allowPartial || ref.locked)
      throw new AppError(code, message, 422, undefined, ref.placeId);
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
      leg = await routes.leg(
        previous,
        place.point,
        req.mode,
        previousId,
        place.id,
      );
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
      ["CLOSED", "TOO_LONG", "INVALID_PLACE", "BUDGET"].includes(i.code),
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
  // Per-operation memo: one request never pays twice for the same place details.
  private memo = new Map<string, Promise<CandidatePlace>>();
  private details(id: string, currency: string) {
    const key = `${id}:${currency}`;
    let hit = this.memo.get(key);
    if (!hit) {
      hit = this.places.details(id, currency);
      hit.catch(() => this.memo.delete(key));
      this.memo.set(key, hit);
    }
    return hit;
  }
  async generate(
    request: PlanRequest,
    previous?: PlanSpec,
    action?: string,
    options: { extend?: boolean } = {},
  ): Promise<Itinerary> {
    validateRequest(request);
    if (!options.extend && previous?.stops.every((s) => s.locked))
      throw new AppError(
        "ALL_LOCKED",
        "All stops are locked. Unlock a stop before remixing.",
        422,
      );
    const locked = previous?.stops.filter((s) => s.locked) ?? [];
    const focus: PlanRequest["interests"][number] | undefined =
      action?.includes("More food")
        ? "Food & drinks"
        : action?.includes("More hidden gems")
          ? "Hidden gems"
          : action?.includes("More exciting")
            ? "Interactive fun"
            : action?.includes("More relaxing")
              ? "Relaxation"
              : undefined;
    const retrievalRequest = focus
      ? {
          ...request,
          interests: [focus, ...request.interests.filter((i) => i !== focus)],
        }
      : request;
    const found = await this.places.search(retrievalRequest);
    const lockedPlaces = await Promise.all(
      locked.map((s) => this.details(s.placeId, request.location.currency)),
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
    candidates.sort((a, b) => score(b, request) - score(a, request));
    const shortlist = diverseShortlist(candidates, lockedPlaces, 12);
    const lockedIdSet = new Set(locked.map((l) => l.placeId));
    candidates = candidatesFor(
      request,
      await Promise.all(
        shortlist.map((p) => this.details(p.id, request.location.currency)),
      ),
    ).filter((p) => lockedIdSet.has(p.id) || openDuring(p, request));
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
          !["CLOSED", "TOO_LONG", "BUDGET"].includes(e.code)
        )
          throw e;
        action = `${action ?? ""} Repair the proposed schedule: ${e.message}`;
        // Deterministic feedback: never offer the venue that just failed validation again.
        if (e.placeId && !locked.some((l) => l.placeId === e.placeId))
          candidates = candidates.filter((p) => p.id !== e.placeId);
      }
    }
    throw new AppError(
      "PLANNING_FAILED",
      "Could not build a valid outing. Try adjusting constraints.",
      422,
    );
  }
  /**
   * Magic Edit: apply a free-text instruction as a structured, minimal change.
   * Kept stops are temporarily locked so they survive verbatim; the user's own
   * locks are restored afterwards.
   */
  async magicEdit(
    spec: PlanSpec,
    instruction: string,
  ): Promise<{ plan: Itinerary; op: EditOp; changed: string[] }> {
    const currency = spec.request.location.currency;
    const places = await Promise.all(
      spec.stops.map((s) => this.details(s.placeId, currency)),
    );
    const op = interpretEdit(
      instruction,
      spec.stops.map((s, i) => ({
        placeId: s.placeId,
        locked: s.locked,
        name: places[i].name,
        category: places[i].category,
        types: places[i].types,
        priceHigh: places[i].price.high,
        travel: i ? distance(places[i - 1].point, places[i].point) : 0,
      })),
      spec.request,
    );
    if (op.kind === "noop")
      throw new AppError("NOTHING_TO_CHANGE", op.summary, 422);
    const request: PlanRequest = { ...spec.request, ...op.patch };
    const before = new Set(spec.stops.map((s) => s.placeId));
    let plan: Itinerary;
    if (op.kind === "remove") {
      plan = await this.edit({
        ...spec,
        request,
        stops: spec.stops.filter((_, i) => !op.targets.includes(i)),
      });
    } else {
      const replaced = op.targets.map((i) => spec.stops[i].placeId);
      const editRequest = {
        ...request,
        excludedPlaceIds: [
          ...new Set([...request.excludedPlaceIds, ...replaced]),
        ].slice(-100),
      };
      const userLocked = new Set(
        spec.stops.filter((s) => s.locked).map((s) => s.placeId),
      );
      plan = await this.generate(
        editRequest,
        {
          ...spec,
          request: editRequest,
          stops: spec.stops.map((s, i) => ({
            ...s,
            locked: s.locked || !op.targets.includes(i),
          })),
        },
        op.action,
        { extend: op.kind === "add" },
      );
      plan = {
        ...plan,
        // Targeted edits keep the plan's identity; only a full rework renames it.
        ...(op.targets.length < spec.stops.length
          ? { title: spec.title, summary: spec.summary }
          : {}),
        stops: plan.stops.map((s) => ({
          ...s,
          locked: userLocked.has(s.placeId),
        })),
      };
    }
    return {
      plan,
      op,
      changed: plan.stops
        .filter((s) => !before.has(s.placeId))
        .map((s) => s.placeId),
    };
  }
  async edit(spec: PlanSpec) {
    const places = await Promise.all(
      spec.stops.map((s) =>
        this.details(s.placeId, spec.request.location.currency),
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
      await this.places.search(request, query),
    );
    basic.sort((a, b) => score(b, request) - score(a, request));
    const detailed = await Promise.all(
      diverseShortlist(basic, [], 10).map((p) =>
        this.details(p.id, request.location.currency),
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
        this.details(s.placeId, hydrated.request.location.currency),
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
