import { DateTime } from "luxon";
import { randomUUID } from "node:crypto";
import { dedupe, inside, distance } from "./geo";
import { localStart } from "./time";
import { hoursCheck } from "./hours";
export { hoursCheck } from "./hours";
import { AppError } from "./errors";
import { Selection as SelectionSchema } from "./schema";
import { interpretEdit, type EditOp } from "./magic-edit";
import {
  inGroup,
  interestOf,
  isEatery,
  readStated,
  type GuideGroup,
} from "./guide";
import { interpret } from "./intent";
import { demoReason } from "./providers/gta-demo";
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
import { isAlcoholLed, isBarLike, isOutdoor, notAnOuting, vibeFit } from "./planner-filters";
import { arrange, fitMinutes, kindOfPlace, shapeSummary, stopsFor } from "./arc";
import { crowdFor, type CrowdSignals } from "./crowd";
export { isOutdoor };
/** Review-weighted quality nudged by the user's learned category affinity. */
export function score(
  p: CandidatePlace,
  request?: Partial<Pick<PlanRequest, "affinity" | "vibes" | "budget">>,
  crowd: CrowdSignals = {},
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
  // A single venue that alone exceeds the per-person budget is a poor shortlist pick.
  const overBudget =
    request?.budget !== undefined &&
    p.price.high !== null &&
    p.price.high > request.budget;
  // Community sentiment nudges (±0.3 max); it never overrides constraints or the user's own taste.
  return (
    quality(p) +
    crowdFor(p, crowd) * 0.3 +
    taste * 0.15 +
    vibeFit(p, request?.vibes ?? []) * 0.2 -
    (overBudget ? 0.4 : 0)
  );
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
/** Open for the whole first `minutes` of the outing, whatever order the stops end up in. */
export function openThroughout(
  place: CandidatePlace,
  request: PlanRequest,
  minutes: number,
) {
  try {
    const start = localStart(
      request.date,
      request.startTime,
      request.location.timezone,
    );
    return !hoursCheck(place, start, start.plus({ minutes })).closed;
  } catch {
    return true;
  }
}
export function candidatesFor(request: PlanRequest, places: CandidatePlace[]) {
  return dedupe(places).filter(
    (p) =>
      !request.excludedPlaceIds.includes(p.id) &&
      // A place the person chose themselves stays, even if it is outside the usual radius.
      (!request.area.locked ||
        request.anchorPlaceIds.includes(p.id) ||
        inside(p.point, request.area.center, request.area.radius)) &&
      (!request.hardBudget ||
        (p.price.high !== null && p.price.high <= request.budget)) &&
      (!request.accessibility || p.wheelchairAccessible !== false) &&
      (!request.indoorOnly || !isOutdoor(p)) &&
      // Families with kids and anyone who said they don't drink never get bars or pubs.
      ((!request.alcoholFree && request.companions !== "family") ||
        request.anchorPlaceIds.includes(p.id) ||
        !isBarLike(p)) &&
      // Hotels, parking, travel agents and whole neighbourhoods aren't things to do.
      (request.anchorPlaceIds.includes(p.id) || !notAnOuting(p)) &&
      (!request.skipFood ||
        request.anchorPlaceIds.includes(p.id) ||
        !isEatery(p)),
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
  /** Community signals (what people find fun), loaded by the API before planning. */
  crowd: CrowdSignals = {};
  withCrowd(crowd: CrowdSignals) {
    this.crowd = crowd;
    return this;
  }
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
    const locked = previous
      ? previous.stops.filter((s) => s.locked)
      : request.anchorPlaceIds.map((placeId) => ({
          placeId,
          minutes: 60,
          locked: true,
          reason:
            (this.demo ? demoReason(placeId, request) : undefined) ??
            "Your pick. The rest of the plan is built around it.",
        }));
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
    const lockedPlaces = await Promise.all(
      locked.map((s) => this.details(s.placeId, request.location.currency)),
    );
    // The search follows the plan: if the stops already chosen are farther out than the
    // usual area (nothing close to home, so the picks are downtown), look around them too,
    // or there is nothing to add next to them.
    const spread = Math.max(
      0,
      ...lockedPlaces.map((p) => distance(request.area.center, p.point)),
    );
    if (spread > request.area.radius * 0.8)
      request = {
        ...request,
        area: {
          ...request.area,
          radius: Math.min(40000, Math.round(spread + 4000)),
        },
      };
    const retrievalRequest = focus
      ? {
          ...request,
          interests: [focus, ...request.interests.filter((i) => i !== focus)],
        }
      : request;
    let found = await this.places.search(retrievalRequest);
    // Nothing at all in the usual area (a suburb the catalogue barely covers): widen, as the
    // place lists do, rather than failing.
    if (
      !candidatesFor({ ...request, hardBudget: false }, found).length &&
      request.area.radius < 30000
    ) {
      request = {
        ...request,
        area: { ...request.area, radius: 30000, locked: false },
      };
      found = await this.places.search({ ...retrievalRequest, area: request.area });
    }
    // Places the person picked for a new plan get a sensible length for what they are:
    // a proper meal, a long visit for a museum or aquarium, an hour or so otherwise.
    if (!previous)
      for (const [i, s] of locked.entries()) {
        const p = lockedPlaces[i];
        const k = kindOfPlace(p);
        const big = /museum|aquarium|zoo|amusement_park|theme_park|science|hiking/.test(p.types.join(" "));
        const film = /movie_theater|cinema|performing_arts|theater/.test(p.types.join(" "));
        s.minutes =
          film ? 120 : k === "meal" ? 75 : k === "treat" ? 40 : big ? (request.duration >= 360 ? 150 : 90) : 60;
      }
    // Without a length they set, the outing is at least long enough for their own picks.
    if (!previous && locked.length && !request.fixedLength) {
      const needed = locked.reduce((n, l) => n + l.minutes, 0) + 35 * locked.length;
      if (needed > request.duration)
        request = { ...request, duration: Math.min(720, Math.ceil(needed / 15) * 15) };
    }
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
      (a, b) => score(b, request, this.crowd) - score(a, request, this.crowd),
    );
    // "Add dessert" must have dessert to choose from: seed the shortlist with what was asked for.
    const asked = (action?.match(/matching: ([^.]+)/)?.[1] ?? "")
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3);
    const wanted = asked.length
      ? candidates
          .filter((p) => {
            const t =
              `${p.name} ${p.category} ${p.types.join(" ")}`.toLowerCase();
            return asked.some((w) => t.includes(w));
          })
          .slice(0, 3)
      : [];
    const shortlist = diverseShortlist(
      candidates,
      [...lockedPlaces, ...wanted],
      12,
    );
    const lockedIdSet = new Set(locked.map((l) => l.placeId));
    candidates = candidatesFor(
      request,
      await Promise.all(
        shortlist.map((p) => this.details(p.id, request.location.currency)),
      ),
    ).filter(
      (p) =>
        lockedIdSet.has(p.id) ||
        // Strong, well-attested community dislike of this specific venue excludes it.
        ((this.crowd[`place:${p.id}`] ?? 0) > -0.5 && openDuring(p, request)),
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
          Object.fromEntries(
            candidates.map((p) => [p.id, crowdFor(p, this.crowd)]),
          ),
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
        stops: (() => {
          // Picks hold their place while the plan is built; afterwards they're ordinary
          // stops the person can change, so editing a guided plan isn't blocked.
          const refs = selection.stops.map((s) => ({
            ...s,
            locked: locked.some((l) => l.placeId === s.placeId),
          }));

          if (previous) return optimizeOrder(refs, candidates, request);
          // A new plan: meals at mealtimes, parks in daylight, filling the time asked for.
          const byId = new Map(candidates.map((p) => [p.id, p]));
          const day = localStart(request.date, "00:00", request.location.timezone);
          const openAt = (p: CandidatePlace, minute: number, length: number) =>
            !hoursCheck(p, day.plus({ minutes: minute }), day.plus({ minutes: minute + length })).closed;
          return optimizeOrder(
            arrange(fitMinutes(refs, byId, request), byId, request, openAt),
            candidates,
            request,
          );
        })(),
        demo: this.demo,
        areaSource: "user",
        revision: (previous?.revision ?? -1) + 1,
      };
      try {
        const scheduled = await schedule(spec, candidates, this.routes, attempt === 1);
        const plan = previous
          ? scheduled
          : { ...scheduled, stops: scheduled.stops.map((st) => ({ ...st, locked: false })) };
        // The summary must only name places that are in the plan: if it mentions any other
        // candidate (a stop that couldn't be kept), describe what's actually there.
        const inPlan = new Set(plan.stops.map((st) => st.placeId));
        const stray = candidates.some(
          (c) =>
            !inPlan.has(c.id) &&
            c.name.replace(/ \(.*\)$/, "").length > 3 &&
            plan.summary.includes(c.name.replace(/ \(.*\)$/, "").replace(/\.$/, "")),
        );
        return stray || plan.stops.length < spec.stops.length
          ? { ...plan, summary: shapeSummary(plan.stops, plan.request) }
          : plan;
      } catch (e) {
        // A favourite the plan is built around must be visited while it is open: move it to
        // the start of the outing before giving up.
        const anchors = previous ? [] : request.anchorPlaceIds;
        if (
          e instanceof AppError &&
          ["CLOSED", "TOO_LONG"].includes(e.code) &&
          anchors.length
        ) {
          const first = [
            ...spec.stops.filter((s) => anchors.includes(s.placeId)),
            ...spec.stops.filter((s) => !anchors.includes(s.placeId)),
          ];
          // Chosen places can be far apart or open at different hours: try each order, and
          // allow extra time for the journey between them, before giving up.
          // Last resort: shorter visits at the picks (a 90-minute show instead of two hours).
          const shorter = (list: typeof first) =>
            list.map((x) => ({ ...x, minutes: Math.max(45, Math.round((x.minutes * 0.75) / 5) * 5) }));
          const orders = [first, [...first].reverse(), shorter(first), shorter([...first].reverse())];
          for (const extra of [0, 90, 180])
            for (const stops of orders) {
              try {
                return await schedule(
                  {
                    ...spec,
                    stops,
                    request: {
                      ...spec.request,
                      duration: Math.min(720, spec.request.duration + extra),
                    },
                  },
                  candidates,
                  this.routes,
                  true,
                );
              } catch {}
            }
          const name =
            candidates.find((p) => p.id === anchors[0])?.name ?? "That place";
          throw new AppError(
            "ANCHOR_CLOSED",
            anchors.length > 1
              ? "Those places don’t fit into one outing at that time. Try an earlier start, or swap one of them."
              : `${name} isn’t open at that time. Try an earlier start or another day.`,
            422,
          );
        }
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
    // Stops the person named are theirs to change this time.
    if (op.unlock?.length)
      spec = {
        ...spec,
        stops: spec.stops.map((s, i) =>
          op.unlock!.includes(i) ? { ...s, locked: false } : s,
        ),
      };
    const request: PlanRequest = { ...spec.request, ...op.patch };
    const before = new Set(spec.stops.map((s) => s.placeId));
    let plan: Itinerary;
    if (op.kind === "endBy" && op.endBy !== undefined) {
      // Fit inside the end time: trim unlocked visits (to no less than 30 min), then drop
      // trailing unlocked stops that aren't the meal. Travel is estimated at 15 min a leg.
      const [h, m] = spec.request.startTime.split(":").map(Number);
      const window = op.endBy - (h * 60 + m);
      if (window < 45)
        throw new AppError("NOTHING_TO_CHANGE", "That end time is before the plan really gets going. Try a later time, or start earlier.", 422);
      let stops = spec.stops.map((st) => ({ ...st }));
      const total = () => stops.reduce((n, st) => n + st.minutes, 0) + 15 * (stops.length - 1);
      for (const st of stops)
        if (total() > window && !st.locked)
          st.minutes = Math.max(30, st.minutes - Math.min(st.minutes * 0.3, total() - window));
      while (total() > window && stops.length > 1) {
        const drop = [...stops].reverse().find((st) => !st.locked && kindOfPlace(places[spec.stops.findIndex((x) => x.placeId === st.placeId)]) !== "meal") ?? [...stops].reverse().find((st) => !st.locked);
        if (!drop) break;
        stops = stops.filter((st) => st !== drop);
      }
      stops = stops.map((st) => ({ ...st, minutes: Math.round(st.minutes / 5) * 5 }));
      plan = await this.edit({
        ...spec,
        request: { ...spec.request, duration: Math.max(60, Math.min(720, window)), fixedLength: true },
        stops,
      });
      return { plan, op, changed: [] };
    }
    if (op.kind === "reorder") {
      if (!op.mealAt && op.order?.every((v, i) => v === i))
        throw new AppError("NOTHING_TO_CHANGE", op.summary || "That's already the order.", 422);
      let order = op.order ?? spec.stops.map((_, i) => i);
      if (op.mealAt) {
        // Try each position for the meal and keep the one whose arrival is closest to the time asked.
        const { index, minute } = op.mealAt;
        const others = order.filter((i) => i !== index);
        const [h, m] = spec.request.startTime.split(":").map(Number);
        let best = order;
        let gap = Infinity;
        for (let pos = 0; pos <= others.length; pos++) {
          const o = [...others];
          o.splice(pos, 0, index);
          const arrive =
            h * 60 + m + o.slice(0, pos).reduce((n, i) => n + spec.stops[i].minutes + 15, 0);
          if (Math.abs(arrive - minute) < gap) {
            gap = Math.abs(arrive - minute);
            best = o;
          }
        }
        order = best;
      }
      plan = await this.edit({ ...spec, stops: order.map((i) => spec.stops[i]) });
      return { plan, op, changed: [] };
    }
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
        ...(op.targets.length < spec.stops.length ? { title: spec.title } : {}),
        summary: shapeSummary(plan.stops, plan.request),
        stops: plan.stops.map((s) => ({
          ...s,
          locked: userLocked.has(s.placeId),
        })),
      };
    }
    // Asking to change a stop must never quietly remove it. If nothing else fits at that
    // time (closed, over budget), keep the plan as it was and say why.
    if (
      (op.kind === "replace" &&
        // "Make it indoors" may rightly drop an outdoor stop that has no indoor stand-in.
        !op.patch?.indoorOnly &&
        plan.stops.length < spec.stops.length) ||
      // Asking to add a stop and getting none back is a failure to report, not success.
      (op.kind === "add" && plan.stops.length <= spec.stops.length)
    )
      throw new AppError(
        "NOTHING_TO_CHANGE",
        op.action.startsWith("Make it cheaper")
          ? "Nothing cheaper that fits is open at that time, so your plan is unchanged."
          : op.kind === "add"
            ? "I couldn't find another place that's open then and fits around your stops, so your plan is unchanged. Try a different kind of stop, or start earlier."
            : "I couldn't find a different place that's open then and fits, so your plan is unchanged. Try describing another kind of place.",
        422,
      );
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
    const plan = await schedule(
      { ...spec, revision: spec.revision + 1 },
      places,
      this.routes,
    ).catch((e) => {
      // Say which stop no longer fits, so the person knows what to move or remove.
      const name = e instanceof AppError && e.placeId
        ? places.find((p) => p.id === e.placeId)?.name
        : undefined;
      if (name && (e.code === "CLOSED" || e.code === "TOO_LONG"))
        throw new AppError(
          e.code,
          e.code === "CLOSED"
            ? `That change moves ${name} to a time when it's closed. Move or remove ${name} as well.`
            : `That change pushes ${name} past the end of your time window. Remove a stop or make the outing longer.`,
          422,
          undefined,
          e.placeId,
        );
      throw e;
    });
    // The summary always describes the stops the plan has now.
    return { ...plan, summary: shapeSummary(plan.stops, plan.request) };
  }
  async explore(request: PlanRequest, query?: string) {
    const basic = candidatesFor(
      { ...request, hardBudget: false },
      await this.places.search(request, query),
    );
    basic.sort(
      (a, b) => score(b, request, this.crowd) - score(a, request, this.crowd),
    );
    const detailed = await Promise.all(
      diverseShortlist(basic, [], 10).map((p) =>
        this.details(p.id, request.location.currency),
      ),
    );
    return candidatesFor(request, detailed);
  }
  /**
   * Guided planning: a few open, well-liked places of one kind (a cuisine, a type of fun),
   * nearest first within the chosen area. Widens to the whole region if the area has none.
   */
  /**
   * `openFor` is how long a place must stay open from the start time: long enough to be
   * either stop of a plan (default), or just an hour when someone is only browsing.
   */
  async options(
    request: PlanRequest,
    group: GuideGroup,
    limit = 8,
    openFor = 180,
  ) {
    const open: PlanRequest = {
      ...request,
      hardBudget: false,
      skipFood: false,
    };
    const collect = async (req: PlanRequest) => {
      const found = [
        ...(await this.places.search(req)),
        ...(await this.places.search(req, group.query).catch(() => [])),
      ];
      return candidatesFor(req, found).filter((p) => inGroup(p, group));
    };
    // A typed name ("CN Tower") means that place itself, ahead of anything that mentions it.
    const named = group.key === "custom" ? group.query.toLowerCase() : "";
    const exact = (p: CandidatePlace) =>
      named && p.name.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim() === named.replace(/[^a-z0-9 ]/g, "").trim() ? 5 : 0;
    const rank = async (pool: CandidatePlace[]) => {
      pool.sort(
        (a, b) =>
          exact(b) +
          score(b, request, this.crowd) -
          distance(b.point, request.area.center) / 4000 -
          (exact(a) +
            score(a, request, this.crowd) -
            distance(a.point, request.area.center) / 4000),
      );
      const detailed = await Promise.all(
        pool
          // Detailed lookups are the costly Google calls: fetch a bounded number.
          .slice(0, Math.min(limit * 2, 18))
          .map((p) => this.details(p.id, request.location.currency)),
      );
      // The person may put this stop first or second, so it has to be open for both slots.
      return detailed
        .filter((p) =>
          // Far-away places also need to stay open through the journey to reach them.
          openThroughout(
            p,
            request,
            openFor +
              Math.min(180, distance(p.point, request.area.center) / 250),
          ),
        )
        .slice(0, limit);
    };
    let places = await rank(await collect(open));
    let widened = false;
    if (places.length < 4) {
      const wider = await rank(
        await collect({
          ...open,
          area: {
            ...open.area,
            radius: Math.max(open.area.radius, 30000),
            locked: false,
          },
        }),
      );
      if (wider.length > places.length) {
        widened = true;
        places = wider;
      }
    }
    return {
      widened,
      places: places.map((p) => ({
        ...p,
        meters: Math.round(distance(p.point, request.area.center)),
      })),
    };
  }
  /**
   * Up to three different plans for the same request, so the person chooses instead of
   * being handed one. Each keeps the places they picked; they differ in how much is added
   * around them, and never repeat each other's added stops. `feedback` is what the person
   * said was missing from the last set ("more lively", "something outdoors").
   */
  async alternatives(
    request: PlanRequest,
    feedback = "",
    avoid: string[] = [],
  ): Promise<{ key: string; label: string; blurb: string; plan: Itinerary }[]> {
    const said = feedback.trim().slice(0, 300);
    const hints = said ? interpret(said, DateTime.now()) : undefined;
    const stated = said ? readStated(said) : {};
    const base: PlanRequest = {
      ...request,
      vibes: hints?.vibes.length ? hints.vibes.slice(0, 4) : request.vibes,
      // "We want games" or "somewhere for tacos" in feedback steers what is searched for.
      interests: [
        ...new Set([
          ...(stated.kind && interestOf[stated.kind]
            ? [interestOf[stated.kind] as PlanRequest["interests"][number]]
            : []),
          ...(stated.cuisine ? (["Food & drinks"] as const) : []),
          ...request.interests,
        ]),
      ].slice(0, 10),
      indoorOnly: hints?.indoorOnly ?? request.indoorOnly,
      skipFood: stated.food === "none" ? true : request.skipFood,
      prompt: [request.prompt, said].filter(Boolean).join(". ").slice(0, 1500),
    };
    const action = said
      ? `They looked at the last options and said: "${said}". Build around that.`
      : undefined;
    const evening = Number(request.startTime.slice(0, 2)) >= 17;
    const picked = request.anchorPlaceIds.length > 0;
    // Three ways to spend the same time the person asked for: fewer longer stops, a balance,
    // or more packed in. None of them stretches the outing past what was asked.
    const shapes = [
      {
        key: "simple",
        label: picked ? "Just your picks" : "Easy pace",
        pace: "relaxed" as const,
      },
      {
        key: "extra",
        label: picked ? "With something extra" : "A proper outing",
        pace: "balanced" as const,
      },
      {
        key: "full",
        label: evening ? "Pack in more" : "Make a day of it",
        pace: "packed" as const,
      },
    ];
    const blurbFor = (plan: Itinerary) => {
      const n = plan.stops.length;
      const mins = plan.totalMinutes;
      const length = mins >= 60 ? `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ""}` : `${mins} min`;
      const over = mins - base.duration;
      return `${n} stops over about ${length}${over >= 30 ? `, about ${Math.round(over / 30) / 2}h longer than you said` : ""}.`;
    };
    const out: {
      key: string;
      label: string;
      blurb: string;
      plan: Itinerary;
    }[] = [];
    const used = new Set(
      avoid.filter((id) => !request.anchorPlaceIds.includes(id)),
    );
    // Places the person picked themselves may already use the whole budget. Added stops
    // then get a modest allowance of their own, so "something extra" is still possible.
    const pickedCost = (
      await Promise.all(
        request.anchorPlaceIds.map((id) =>
          this.details(id, request.location.currency).catch(() => undefined),
        ),
      )
    ).reduce((n, p) => n + (p?.price.high ?? 0), 0);
    for (const shape of shapes) {
      const added = Math.max(
        0,
        stopsFor({ duration: base.duration, pace: shape.pace }) -
          request.anchorPlaceIds.length,
      );
      // Around the person's picks, look for different kinds of places (a café, a park, a
      // bar), not more of what they already chose. Each option leans a different way.
      const around: PlanRequest["interests"] = [
        ...new Set([
          ...base.interests.filter((i) => i !== "Surprise me"),
          ...(shape.key === "full"
            ? (["Interactive fun", "Arts & culture", "Food & drinks"] as const)
            : (["Relaxation", "Arts & culture", "Outdoors"] as const)),
        ]),
      ].slice(0, 10);
      const variant: PlanRequest = {
        ...base,
        interests: picked && added > 0 ? around : base.interests,
        budget: picked
          ? Math.max(base.budget, pickedCost + added * 20)
          : base.budget,
        pace: shape.pace,
        // "Pack in more" may run longer, but only when no length or end time was given.
        duration: base.fixedLength
          ? base.duration
          : Math.min(
              720,
              base.duration +
                (shape.key === "full" ? 120 : shape.key === "extra" ? 60 : 0),
            ),
        excludedPlaceIds: [
          ...new Set([...base.excludedPlaceIds, ...used]),
        ].slice(0, 100),
      };
      try {
        let plan = await this.generate(variant, undefined, action);
        // Excluding earlier options' places can starve a bigger plan. If it came out
        // thin, rebuild it from the full pool; the duplicate check below still applies.
        const wanted = stopsFor({ duration: base.duration, pace: shape.pace });
        if (plan.stops.length < wanted - 1 && used.size)
          plan = await this.generate(
            { ...variant, excludedPlaceIds: base.excludedPlaceIds },
            undefined,
            action,
          ).catch(() => plan);
        const ids = plan.stops
          .map((s) => s.placeId)
          .sort()
          .join();
        if (
          out.some(
            (o) =>
              o.plan.stops
                .map((s) => s.placeId)
                .sort()
                .join() === ids,
          )
        )
          continue;
        out.push({
          key: shape.key,
          label: shape.label,
          blurb: blurbFor(plan),
          plan,
        });
        // Later options should open differently, not avoid every place shown: excluding
        // only each option's first added stop keeps the pool big enough to fill them.
        const lead = plan.stops.find(
          (s) => !request.anchorPlaceIds.includes(s.placeId),
        );
        if (lead) used.add(lead.placeId);
      } catch (e) {
        // One shape not fitting (too late, too far) should not hide the others.
        if (!out.length && shape === shapes[shapes.length - 1]) throw e;
      }
    }
    return out;
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
  // Restaurants of every cuisine share one group, so a food-heavy area cannot crowd out
  // dessert, drinks and things to do.
  const kind = (p: CandidatePlace) =>
    /restaurant|diner/.test(p.category) ? "restaurant" : p.category;
  for (const p of candidates) {
    const group = groups.get(kind(p)) ?? [];
    group.push(p);
    groups.set(kind(p), group);
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
        // Locked stops and meals (placed at mealtime) stay where they are.
        if (
          best
            .slice(i, j + 1)
            .some((s) => s.locked || kindOfPlace(byId.get(s.placeId)!) === "meal")
        )
          continue;
        const proposal = [
          ...best.slice(0, i),
          ...best.slice(i, j + 1).reverse(),
          ...best.slice(j + 1),
        ];
        if (
          repeats(proposal) <= repeats(best) &&
          // The selection's order carries intent (a meal at mealtime, drinks last), so only
          // reorder when it removes real backtracking, not to shave a few metres.
          length(proposal) < length(best) * 0.8 &&
          length(best) - length(proposal) > 400
        )
          best = proposal;
      }
  return best;
}
