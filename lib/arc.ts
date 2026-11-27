import { DateTime } from "luxon";
import { isAlcoholLed, isOutdoor } from "./planner-filters";
import type { CandidatePlace, PlanRequest, PlanSpec } from "./schema";

/**
 * The shape of a good outing, applied after any recommender (built-in or AI) has chosen the
 * places: meals land at mealtimes, outdoor stops happen in daylight, treats and drinks come
 * last, and visit lengths stretch so the plan fills the time the person asked for.
 */
type Ref = PlanSpec["stops"][number];
export type StopKind = "meal" | "treat" | "drinks" | "outdoor" | "activity";

const MEAL = /restaurant|food_court|diner|steak_house|brunch/;
const TREAT = /cafe|coffee|bakery|dessert|ice_cream|tea_house|confectionery|donut|juice/;

export function kindOfPlace(p: Pick<CandidatePlace, "types" | "category">): StopKind {
  const primary = `${p.types[0] ?? ""} ${p.category}`.toLowerCase();
  if (TREAT.test(primary)) return "treat";
  if (MEAL.test(primary)) return "meal";
  if (isAlcoholLed(p)) return "drinks";
  if (isOutdoor(p)) return "outdoor";
  return "activity";
}

/** Minutes from midnight. */
const WINDOWS = {
  brunch: [8 * 60 + 30, 11 * 60 + 30],
  lunch: [11 * 60 + 30, 14 * 60 + 30],
  dinner: [17 * 60 + 30, 21 * 60],
} as const;
const overlap = (a: number, b: number, [s, e]: readonly [number, number]) =>
  Math.max(0, Math.min(b, e) - Math.max(a, s));

/** Approximate Toronto sunset by month (local minutes), for keeping parks in daylight. */
const SUNSET = [1025, 1065, 1160, 1195, 1230, 1255, 1250, 1215, 1165, 1110, 1010, 1005];
export function sunsetMinutes(date: string) {
  return SUNSET[Math.max(0, Math.min(11, Number(date.slice(5, 7)) - 1))];
}

const startMinutes = (req: Pick<PlanRequest, "startTime">) => {
  const [h, m] = req.startTime.split(":").map(Number);
  return h * 60 + m;
};

/** How many proper meals an outing of this length and start time should include. */
export function mealsFor(req: Pick<PlanRequest, "startTime" | "duration" | "skipFood">) {
  if (req.skipFood) return 0;
  const a = startMinutes(req);
  const b = a + req.duration;
  const midday = overlap(a, b, [WINDOWS.brunch[0], WINDOWS.lunch[1]]) >= 60 ? 1 : 0;
  const dinner = overlap(a, b, WINDOWS.dinner) >= 60 ? 1 : 0;
  return Math.max(midday + dinner, req.duration >= 150 && (midday || dinner || a >= 17 * 60) ? 1 : 0);
}

/** How many stops fill an outing: about one per hour and a half, nudged by pace. */
export function stopsFor(req: Pick<PlanRequest, "duration" | "pace">) {
  // A few hours is still three stops' worth; long days add about one per hour and a half.
  const base = req.duration < 150 ? 2 : Math.max(3, Math.round(req.duration / 95));
  const pace = req.pace === "relaxed" ? -1 : req.pace === "packed" ? 1 : 0;
  return Math.max(2, Math.min(7, base + pace));
}

/**
 * Order stops into a natural day: a meal whenever the clock reaches a meal window, outdoor
 * stops while it's light, other activities in between, treats and drinks at the end.
 * The recommender's order is kept within each kind.
 */
export function arrange(
  refs: Ref[],
  places: Map<string, CandidatePlace>,
  req: Pick<PlanRequest, "startTime" | "date" | "prompt">,
  /** Whether a place is open from `minute` (of the day) for `length` minutes. */
  openAt: (place: CandidatePlace, minute: number, length: number) => boolean = () => true,
): Ref[] {
  const kind = (r: Ref) => {
    const p = places.get(r.placeId);
    return p ? kindOfPlace(p) : "activity";
  };
  const left = [...refs];
  const out: Ref[] = [];
  const dark = sunsetMinutes(req.date) - 30;
  // Brunch first only when asked for, or when the meal they chose is a brunch place.
  const brunchWanted =
    /\b(brunch|breakfast)\b/i.test(req.prompt) ||
    refs.some((r) => /brunch|breakfast/.test(`${places.get(r.placeId)?.category ?? ""} ${places.get(r.placeId)?.types.join(" ") ?? ""}`));
  let t = startMinutes(req);
  const served = new Set<string>();
  const take = (r: Ref) => {
    left.splice(left.indexOf(r), 1);
    out.push(r);
    t += r.minutes + 15;
  };
  const windowNow = (time: number) =>
    (Object.entries(WINDOWS) as [keyof typeof WINDOWS, readonly [number, number]][]).find(
      ([name, [s, e]]) =>
        time >= s - 20 &&
        time < e &&
        !served.has(name === "brunch" ? "lunch" : name) &&
        (name !== "brunch" || brunchWanted),
    );
  while (left.length) {
    const meals = left.filter((r) => kind(r) === "meal");
    const now = windowNow(t);
    // Something that will have closed by the time the meal is over goes first.
    const closing =
      now &&
      meals.length &&
      left.find(
        (r) =>
          kind(r) !== "meal" &&
          openAt(places.get(r.placeId)!, t, r.minutes) &&
          !openAt(places.get(r.placeId)!, t + meals[0].minutes + 15, r.minutes),
      );
    if (closing) {
      take(closing);
      continue;
    }
    if (meals.length && now) {
      served.add(now[0] === "brunch" ? "lunch" : now[0]);
      take(meals[0]);
      continue;
    }
    const outdoor = left.find((r) => kind(r) === "outdoor");
    const activity = left.find((r) => kind(r) === "activity");
    // Daylight first for parks and walks; after dark, indoor things.
    const next =
      outdoor && t + outdoor.minutes <= dark
        ? outdoor
        : (activity ??
          // Nothing else to do before the next meal: eat now rather than wander.
          meals[0] ??
          outdoor ??
          left.find((r) => kind(r) === "treat") ??
          left[0]);
    if (next === meals[0] && meals.length) {
      const w = windowNow(t + 60);
      if (w) served.add(w[0] === "brunch" ? "lunch" : w[0]);
    }
    take(next);
  }
  return out;
}

/**
 * Stretch or trim unlocked visit lengths so the stops, plus time to travel between them,
 * fill the requested duration. Locked stops keep exactly the time the person set.
 */
export function fitMinutes(
  refs: Ref[],
  places: Map<string, CandidatePlace>,
  req: Pick<PlanRequest, "duration">,
): Ref[] {
  if (!refs.length) return refs;
  // Leave room for real travel and slack, so stretching never pushes a stop out of the plan.
  const travel = 25 * (refs.length - 1);
  const lockedTime = refs.filter((r) => r.locked).reduce((n, r) => n + r.minutes, 0);
  const free = refs.filter((r) => !r.locked);
  const available = req.duration * 0.88 - travel - lockedTime;
  const current = free.reduce((n, r) => n + r.minutes, 0);
  if (!free.length || available <= 0 || current <= 0) return refs;
  // Only ever lengthen visits (up to 1.8x): a short plan is filled, a full one is left alone.
  // A film or show always gets the time a film or show takes.
  const factor = Math.max(1, Math.min(1.8, available / current));
  const bounds = (r: Ref): [number, number] => {
    const p = places.get(r.placeId);
    const k = p ? kindOfPlace(p) : "activity";
    const big = p && /museum|aquarium|zoo|amusement_park|science|theme_park|hiking/.test(p.types.join(" "));
    const film = p && /movie_theater|cinema|performing_arts|theater|concert/.test(p.types.join(" "));
    return film ? [110, 180] : k === "meal" ? [45, 90] : k === "treat" ? [25, 60] : k === "drinks" ? [40, 120] : big ? [60, 210] : [40, 150];
  };
  return refs.map((r) => {
    if (r.locked) return r;
    const [lo, hi] = bounds(r);
    return { ...r, minutes: Math.round(Math.max(lo, Math.min(hi, r.minutes * factor)) / 5) * 5 };
  });
}

/** True when the clock at a stop is after dark (for warnings and labels). */
export function afterDark(iso: string, zone: string, date: string) {
  const t = DateTime.fromISO(iso).setZone(zone);
  return t.hour * 60 + t.minute > sunsetMinutes(date);
}

/** "an escape room, then dinner, then dessert": what the outing is, from its actual stops. */
export function shapeSummary(
  stops: { place: Pick<CandidatePlace, "types" | "category">; arrival: string }[],
  req: Pick<PlanRequest, "startTime" | "vibes" | "companions" | "location">,
) {
  const phrase = (s: (typeof stops)[number]) => {
    const k = kindOfPlace(s.place);
    const hour = DateTime.fromISO(s.arrival).setZone(req.location.timezone).hour;
    if (k === "meal") return hour < 11 ? "brunch" : hour < 16 ? "lunch" : "dinner";
    if (k === "treat") return /ice_cream|dessert|bakery|donut|confection/.test(s.place.types.join(" ")) ? "something sweet" : "coffee";
    if (k === "drinks") return "drinks";
    const c = s.place.category.toLowerCase().replace(/_/g, " ");
    return `${/^[aeiou]/.test(c) ? "an" : "a"} ${c}`;
  };
  const parts = stops.map(phrase).filter((p, i, all) => all.indexOf(p) === i);
  const h = Number(req.startTime.slice(0, 2));
  const part = h < 12 ? "day" : h < 17 ? "afternoon" : "evening";
  const mood = req.vibes[0] ?? "easygoing";
  const who = { partner: "for two", friends: "with friends", solo: "on your own", family: "for the family" }[req.companions ?? "partner"];
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")}, then ${parts.at(-1)}` : (parts[0] ?? "");
  return `A ${mood} ${part} ${who}: ${list}.`.replace(/^A ([aeiou])/i, "An $1");
}
