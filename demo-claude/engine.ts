// Keyless demo engine: the real Whimway planner, demo GTA venues, and a pluggable
// "brain" that picks venues. In the hosted demo the brain is Claude (via the page);
// if Claude is unavailable it falls back to the built-in demo planner.
import { DateTime } from "luxon";
import { Planner } from "../lib/planner";
import {
  FixturePlaces,
  FixtureRoutes,
  FixtureAI,
} from "../lib/providers/fixtures";
import { voice } from "../lib/providers/demo-voice";
import { interpret, buildRequest, describe } from "../lib/intent";
import { emptyProfile } from "../lib/profile";
import { areas } from "../lib/areas";
import type {
  CandidatePlace,
  Itinerary,
  PlanRequest,
  PlanSpec,
  Selection,
} from "../lib/schema";

export type Brain = (prompt: string) => Promise<unknown>;
let brain: Brain | null = null;
export let lastSource: "claude" | "fallback" = "fallback";
export let lastNote = "";
export function setBrain(b: Brain | null) {
  brain = b;
}

const fallback = new FixtureAI();
const voiceKey = (id: string) => id.replace(/^gta-/, "");

function brief(p: CandidatePlace) {
  const v = voice[voiceKey(p.id)];
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    area: p.address.split(",").slice(-2, -1)[0]?.trim(),
    price:
      p.price.high != null
        ? `$${p.price.low ?? 0}-${p.price.high} pp`
        : "unknown",
    rating: p.rating,
    hours: p.hours.slice(0, 1).join(""),
    note: v?.date ?? "",
  };
}

class ClaudeAI {
  async select(
    req: PlanRequest,
    candidates: CandidatePlace[],
    locked: { placeId: string; minutes: number; reason: string }[],
    action?: string,
    previousStops?: PlanSpec["stops"],
    crowd: Record<string, number> = {},
  ): Promise<Selection> {
    const fall = () => {
      lastSource = "fallback";
      return fallback.select(
        req,
        candidates,
        locked,
        action,
        previousStops,
        crowd,
      );
    };
    if (!brain) return fall();
    const ids = new Set(candidates.map((c) => c.id));
    // How many stops this option should have (the planner asks for a short, a middle and a
    // long option); for edits, one more than before when adding, else the same as before.
    const want = action?.startsWith("Add")
      ? locked.length + 1
      : previousStops?.length
        ? Math.max(previousStops.length, locked.length + 1)
        : req.pace === "relaxed"
          ? 2
          : req.pace === "packed"
            ? 4
            : 3;
    const start = DateTime.fromISO(`${req.date}T${req.startTime}`);
    const prompt = [
      "You are the planning brain inside Whimway, an app that turns a vague idea into a concrete outing in the Greater Toronto Area.",
      `Pick exactly ${want} venues (counting any locked stops) ONLY from the candidate list, in the order they should be visited, and write the plan's copy.`,
      want === 2
        ? "This is the short, easy option: just two stops, no rush."
        : want === 3
          ? "This is the in-between option: three stops with one extra thing to do."
          : "This is the long option: four stops for a full night or day out.",
      "Rules: use exact candidate ids; keep the total visit time near the requested duration; respect the budget; a meal around dinner time if the outing spans it; stops should be reasonably close together; vary categories; keep any locked stops (include them with their id).",
      "Voice: warm, specific, plain. Reasons say why THIS place suits THIS group, 1-2 short sentences, no hype words, no emoji.",
      `Request: ${describe(req)}. Group: ${req.companions}, ${req.participants} people. Starts ${start.toFormat("cccc h:mm a")}, about ${Math.round(req.duration / 60)} hours. Budget: ${req.budget ? `$${req.budget} per person` : "flexible"}. Travel: ${req.mode}. Vibes: ${req.vibes.join(", ") || "any"}. Interests: ${req.interests.join(", ") || "any"}.`,
      req.prompt ? `Their words: "${req.prompt}"` : "",
      action
        ? `They asked to change the plan: "${action}". Keep stops that still fit; change what the request targets.`
        : "",
      previousStops?.length
        ? `Previous plan stop ids: ${previousStops.map((s) => s.placeId).join(", ")}`
        : "",
      locked.length
        ? `Locked stops (must keep): ${locked.map((l) => l.placeId).join(", ")}`
        : "",
      `Candidates (JSON): ${JSON.stringify(candidates.map(brief))}`,
      'Answer with JSON only: {"title": string (max 60 chars, evocative, no colon), "summary": string (1-2 sentences, max 220 chars), "note": string (one sentence, first person, how you read their request), "stops": [{"placeId": string, "minutes": integer 30-150, "reason": string}]}',
    ]
      .filter(Boolean)
      .join("\n");
    try {
      const raw = (await brain(prompt)) as {
        title?: string;
        summary?: string;
        note?: string;
        stops?: { placeId?: string; minutes?: number; reason?: string }[];
      };
      const seen = new Set<string>();
      const stops = (raw?.stops ?? [])
        .filter(
          (s) =>
            s.placeId &&
            ids.has(s.placeId) &&
            !seen.has(s.placeId) &&
            seen.add(s.placeId),
        )
        .slice(0, 8)
        .map((s) => ({
          placeId: s.placeId!,
          minutes: Math.max(30, Math.min(150, Math.round(s.minutes ?? 75))),
          reason: String(s.reason ?? "").slice(0, 230),
        }));
      // Stops the person picked (or kept) are fixed: keep Claude's order, but never its
      // rewrite of their time or description, which the planner would reject.
      for (let i = 0; i < stops.length; i++) {
        const l = locked.find((x) => x.placeId === stops[i].placeId);
        if (l) stops[i] = l;
      }
      for (const l of locked) if (!seen.has(l.placeId)) stops.unshift(l);
      // Keep to the intended size: drop extra unlocked stops from the end.
      while (stops.length > Math.max(want, locked.length)) {
        const i = [...stops]
          .reverse()
          .findIndex((x) => !locked.some((l) => l.placeId === x.placeId));
        if (i < 0) break;
        stops.splice(stops.length - 1 - i, 1);
      }
      if (stops.length < 2 || !raw.title) return fall();
      lastSource = "claude";
      lastNote = String(raw.note ?? "").slice(0, 240);
      return {
        title: String(raw.title).slice(0, 110),
        summary: String(raw.summary ?? "").slice(0, 330),
        stops,
      };
    } catch (e) {
      console.warn("Claude unavailable, using the built-in planner", e);
      return fall();
    }
  }
}

export type Prefs = {
  companions: NonNullable<PlanRequest["companions"]>;
  vibes: PlanRequest["vibes"];
  homeArea: string;
  mode: PlanRequest["mode"];
};

function plannerFor(req: PlanRequest) {
  return new Planner(
    new FixturePlaces(req),
    new FixtureRoutes(),
    new ClaudeAI(),
    true,
  );
}

// The planner's deterministic checks can drop stops Claude picked (closed, too far, over budget).
// If that leaves a thin plan, re-plan once with the built-in demo planner instead.
const usedClaude = () => (lastSource as string) === "claude";
const weak = (p: Itinerary) =>
  p.stops.length < 2 || p.issues.some((i) => i.severity === "error");
async function guarded<T>(run: () => Promise<T>, plan: (r: T) => Itinerary) {
  lastNote = "";
  lastSource = "fallback";
  let first: T | undefined;
  try {
    first = await run();
  } catch (e) {
    if (!usedClaude()) throw e;
  }
  if (first !== undefined && (!usedClaude() || !weak(plan(first))))
    return first;
  const saved = brain;
  brain = null;
  try {
    const second = await run();
    lastNote =
      "Claude’s first pick didn’t survive the hours and travel checks, so this one comes from the built-in planner.";
    return second;
  } finally {
    brain = saved;
  }
}

export async function plan(text: string, prefs: Prefs) {
  const now = DateTime.now().setZone("America/Toronto");
  const profile = { ...emptyProfile(), ...prefs };
  const draft = interpret(text, now);
  const req = buildRequest(text, draft, profile, now);
  const itinerary = await guarded(
    () => plannerFor(req).generate(req),
    (p) => p,
  );
  return {
    itinerary,
    heard: describe(req, now),
    source: lastSource,
    note: lastNote,
  };
}

export async function edit(itinerary: Itinerary, instruction: string) {
  const res = await guarded(
    () =>
      plannerFor(itinerary.request).magicEdit(
        itinerary as unknown as PlanSpec,
        instruction,
      ),
    (r) => r.plan,
  );
  return { ...res, source: lastSource, note: lastNote };
}

export const areaList = areas.map((a) => ({ key: a.key, name: a.name }));

// ── Guided planning (the step-by-step flow) ──────────────────────────────────────────────
import {
  activities,
  cuisines,
  customGroup,
  groupByKey,
  inGroup,
  readStated,
} from "../lib/guide";
import { defaultRadius } from "../lib/areas";

export type Answers = {
  day: number;
  time: string;
  food?: "meal" | "light" | "none" | "any";
  cuisine?: string;
  foodPlaceId?: string;
  fun?: "yes" | "none" | "any";
  kind?: string;
  funPlaceId?: string;
  mode: PlanRequest["mode"];
  who?: NonNullable<PlanRequest["companions"]>;
  cuisineText?: string;
  kindText?: string;
  mood?: PlanRequest["vibes"];
  budget?: number;
  note?: string;
};
const people = { partner: 2, friends: 4, solo: 1, family: 4 };
const interestFor: Record<string, PlanRequest["interests"][number]> = {
  games: "Interactive fun",
  shows: "Arts & culture",
  culture: "Arts & culture",
  sights: "Hidden gems",
  attractions: "Family",
  outdoors: "Outdoors",
  shopping: "Shopping",
  drinks: "Nightlife",
};
export const guideGroups = {
  cuisines: cuisines.map(({ key, label, hint }) => ({ key, label, hint })),
  activities: activities.map(({ key, label, hint }) => ({ key, label, hint })),
};

export function guidedRequest(a: Answers, prefs: Prefs): PlanRequest {
  const now = DateTime.now().setZone("America/Toronto");
  const note = (a.note ?? "").trim();
  const who = a.who ?? prefs.companions;
  const base = buildRequest(
    note,
    interpret(note, now),
    { ...emptyProfile(), ...prefs },
    now,
  );
  const chosen = [a.foodPlaceId, a.funPlaceId].filter(Boolean) as string[];
  const interests = [
    ...(a.food && a.food !== "none" ? (["Food & drinks"] as const) : []),
    ...(a.kind && interestFor[a.kind] ? [interestFor[a.kind]] : []),
  ];
  const decided = Boolean(
    (a.food === "none" || a.foodPlaceId) && (a.fun === "none" || a.funPlaceId),
  );
  const cuisine =
    a.cuisine === "custom"
      ? a.cuisineText
      : a.cuisine
        ? groupByKey(a.cuisine)?.label.toLowerCase()
        : undefined;
  const kind =
    a.kind === "custom"
      ? a.kindText
      : a.kind
        ? groupByKey(a.kind)?.label.toLowerCase()
        : undefined;
  return {
    ...base,
    companions: who,
    participants: people[who],
    vibes: a.mood?.length ? a.mood : base.vibes,
    budget: a.budget ?? base.budget,
    budgetBasis: a.budget ? "person" : base.budgetBasis,
    date: now.plus({ days: a.day }).toISODate()!,
    startTime: a.time,
    mode: a.mode,
    area: { ...base.area, radius: defaultRadius(a.mode) },
    interests: interests.length ? [...new Set(interests)] : base.interests,
    skipFood: a.food === "none",
    anchorPlaceIds: chosen,
    pace: decided ? "relaxed" : "balanced",
    duration: chosen.length === 2 ? 210 : decided ? 150 : 240,
    prompt: [
      [
        a.food === "none"
          ? "no food"
          : cuisine
            ? `${cuisine} food`
            : a.food === "light"
              ? "coffee or dessert"
              : "",
        a.fun === "none" ? "" : (kind ?? ""),
      ]
        .filter(Boolean)
        .join(", "),
      note,
    ]
      .filter(Boolean)
      .join(". ")
      .slice(0, 1500),
  };
}

export async function options(
  a: Answers,
  prefs: Prefs,
  groupKey: string,
  text?: string,
) {
  const group =
    groupKey === "custom" && text ? customGroup(text) : groupByKey(groupKey);
  if (!group) return { places: [], widened: false };
  const req = { ...guidedRequest(a, prefs), anchorPlaceIds: [] };
  const res = await plannerFor(req).options(req, group);
  return {
    ...res,
    places: res.places.map((p) => ({ ...p, kind: photoKind(p, groupKey) })),
  };
}

export async function planGuided(a: Answers, prefs: Prefs) {
  const req = guidedRequest(a, prefs);
  const itinerary = await guarded(
    () => plannerFor(req).generate(req),
    (p) => p,
  );
  return { itinerary, heard: null, source: lastSource, note: lastNote };
}
export function nowHour() {
  return DateTime.now().setZone("America/Toronto").hour;
}
export function dayName(d: number) {
  return d === 0
    ? "Today"
    : d === 1
      ? "Tomorrow"
      : DateTime.now()
          .setZone("America/Toronto")
          .plus({ days: d })
          .toFormat("cccc");
}

/** Which category photo stands in for a place (the demo has no venue photos). */
export function photoKind(
  p: Pick<CandidatePlace, "category" | "types">,
  chosen?: string,
) {
  const current = chosen ? groupByKey(chosen) : undefined;
  return current && inGroup(p, current)
    ? current.key
    : ([...cuisines, ...activities].find((g) => inGroup(p, g))?.key ??
        "sights");
}

/**
 * "Just say it": what the person's words already settle (who, when, budget, any food or
 * activity they named) and which guided questions that makes unnecessary.
 */
export function readText(text: string, prefs: Prefs) {
  const now = DateTime.now().setZone("America/Toronto");
  const req = buildRequest(
    text,
    interpret(text, now),
    { ...emptyProfile(), ...prefs },
    now,
  );
  const stated = readStated(text);
  const day = Math.max(
    0,
    Math.round(
      DateTime.fromISO(req.date, { zone: "America/Toronto" })
        .startOf("day")
        .diff(now.startOf("day"), "days").days,
    ),
  );
  const skip = ["who", "when", "travel", "extras"];
  if (stated.food) skip.push("food");
  if (stated.cuisine) skip.push("cuisine");
  if (stated.kind) skip.push("fun", "kind");
  const heard = describe(req, now);
  return {
    answers: {
      who: req.companions ?? prefs.companions,
      day,
      time: req.startTime,
      mode: req.mode,
      mood: req.vibes,
      note: text.slice(0, 400),
      ...stated,
    },
    skip,
    heard: [heard.who, heard.when, heard.budget, heard.area].filter(Boolean),
  };
}

/** A few different plans to choose from; `feedback` is what was missing from the last set. */
export async function planOptions(
  a: Answers,
  prefs: Prefs,
  feedback = "",
  avoid: string[] = [],
) {
  const req = guidedRequest(a, prefs);
  return withFallback(() => plannerFor(req).alternatives(req, feedback, avoid));
}

// ── Discover and direct edits (match the full app) ─────────────────────────────────────
/** Real demo places of one kind, or matching what was typed, open at the chosen time. */
export async function discover(
  prefs: Prefs,
  opts: {
    areaKey: string;
    when: "now" | "tonight" | "tomorrow";
    group?: string;
    text?: string;
  },
) {
  const now = DateTime.now().setZone("America/Toronto");
  const area = areas.find((a) => a.key === opts.areaKey) ?? areas[0];
  const base = buildRequest(
    "",
    interpret("", now),
    { ...emptyProfile(), ...prefs },
    now,
    { area },
  );
  const start =
    opts.when === "now"
      ? now.plus({ minutes: 30 - (now.minute % 30) })
      : opts.when === "tonight"
        ? now.set({ hour: Math.max(18, now.hour + 1), minute: 0 })
        : now.plus({ days: 1 }).set({ hour: 18, minute: 30 });
  const at =
    opts.when !== "tomorrow" && (start.hour >= 23 || start.day !== now.day)
      ? now.plus({ days: 1 }).set({ hour: 18, minute: 30 })
      : start;
  const req: PlanRequest = {
    ...base,
    date: at.toISODate()!,
    startTime: at.toFormat("HH:mm"),
    duration: 180,
    anchorPlaceIds: [],
  };
  const group = opts.text
    ? customGroup(opts.text)
    : groupByKey(opts.group ?? "games");
  if (!group) return { places: [], widened: false, request: req };
  const res = await plannerFor(req).options(req, group, 12, 60);
  return {
    ...res,
    request: req,
    places: res.places.map((p) => ({ ...p, kind: photoKind(p, opts.group) })),
  };
}

/** Plan options built around one place the person found in Discover. */
export async function planAround(
  request: PlanRequest,
  placeId: string,
  name: string,
) {
  const req: PlanRequest = {
    ...request,
    duration: 210,
    anchorPlaceIds: [placeId],
    prompt: `Plan something around ${name}`,
  };
  return withFallback(() => plannerFor(req).alternatives(req));
}

/** Move a stop earlier or later, give it 15 minutes more or less, or remove it. */
export async function arrange(
  itinerary: Itinerary,
  index: number,
  action: "earlier" | "later" | "remove" | "longer" | "shorter",
) {
  const refs = itinerary.stops.map((s) => ({
    placeId: s.placeId,
    minutes: s.minutes,
    locked: false,
    reason: s.reason,
  }));
  if (action === "remove") refs.splice(index, 1);
  else if (action === "earlier" || action === "later") {
    const to = action === "earlier" ? index - 1 : index + 1;
    [refs[index], refs[to]] = [refs[to], refs[index]];
  } else
    refs[index].minutes = Math.max(
      15,
      Math.min(180, refs[index].minutes + (action === "longer" ? 15 : -15)),
    );
  return plannerFor(itinerary.request).edit({
    ...(itinerary as unknown as PlanSpec),
    stops: refs,
  });
}

/**
 * Run a set of plan options with Claude; if anything in that path fails, or Claude's
 * picks leave no usable option, run it again with the built-in planner and say so.
 */
async function withFallback(
  run: () => Promise<
    { key: string; label: string; blurb: string; plan: Itinerary }[]
  >,
) {
  lastNote = "";
  lastSource = "fallback";
  try {
    const options = await run();
    if (options.length) return { options, source: lastSource, note: lastNote };
  } catch (e) {
    if (!usedClaude()) throw e;
  }
  if (!usedClaude()) return { options: [], source: lastSource, note: lastNote };
  const saved = brain;
  brain = null;
  try {
    const options = await run();
    return {
      options,
      source: "fallback" as const,
      note: "Claude’s picks didn’t fit the hours and travel checks, so these come from the built-in planner.",
    };
  } finally {
    brain = saved;
  }
}
