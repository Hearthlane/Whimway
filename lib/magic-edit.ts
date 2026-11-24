import { isOutdoor, vibeTypes } from "./planner-filters";
import type { PlanRequest } from "./schema";
import { vibes as allVibes } from "./schema";

/**
 * Magic Edit: turns a free-text instruction into a *structured* itinerary operation.
 *
 * The output says exactly which stops are replaced, which are kept, and which
 * request constraints change. Only the replaced stops go back to the AI; kept
 * stops are temporarily locked so the planner must preserve them verbatim.
 * User-locked stops are never touched.
 */
export type EditStop = {
  placeId: string;
  locked: boolean;
  name: string;
  category: string;
  types: string[];
  priceHigh: number | null;
  travel: number;
};
export type EditOp = {
  kind: "replace" | "remove" | "add" | "reorder" | "endBy" | "noop";
  /** For "endBy": finish by this minute of the day. */
  endBy?: number;
  /** Indices of stops to regenerate (replace) or drop (remove). */
  targets: number[];
  /** For "reorder": the new order, as indices into the current stops. */
  order?: number[];
  /** For "reorder": put this meal stop where the plan reaches about this minute of the day. */
  mealAt?: { index: number; minute: number };
  /** Kept stops the person named outright: they asked to change them, so they may. */
  unlock?: number[];
  /** Instruction passed to the selection model, describing what the new stops should be. */
  action: string;
  patch: Partial<
    Pick<
      PlanRequest,
      "budget" | "mode" | "indoorOnly" | "duration" | "vibes" | "area"
    >
  >;
  /** One-line explanation shown to the user before/after applying. */
  summary: string;
};

const ordinals: [RegExp, (n: number) => number][] = [
  [/\b(first|1st|opening|stop (?:one|1))\b/, () => 0],
  [/\b(second|2nd|stop (?:two|2))\b/, () => 1],
  [/\b(third|3rd|stop (?:three|3))\b/, () => 2],
  [/\b(fourth|4th|stop (?:four|4))\b/, () => 3],
  [/\b(fifth|5th|stop (?:five|5))\b/, () => 4],
  [/\b(sixth|6th|stop (?:six|6))\b/, () => 5],
  [/\b(last|final|end|closing|last one)\b/, (n) => n - 1],
  [/\bmiddle\b/, (n) => Math.floor((n - 1) / 2)],
];
const categoryRefs: [RegExp, RegExp][] = [
  [
    /\b(dinner|lunch|brunch|restaurant|meal|food|eat)\b/,
    /restaurant|food|meal|diner|steak|sushi|pizza|ramen|bistro/,
  ],
  [
    /\b(drinks?|bar|cocktails?|pub|brewery|nightcap)\b/,
    /bar|pub|brewery|night_club|wine|cocktail|lounge/,
  ],
  [/\b(coffee|caf[eé]|tea)(?![a-z])/, /cafe|coffee|tea|bakery/],
  [
    /\b(dessert|ice cream|sweets?|treat)\b/,
    /dessert|ice_cream|bakery|chocolate|confectionery/,
  ],
  [/\b(museum|gallery|art)\b/, /museum|gallery|art/],
  [/\b(park|walk|outdoor\w*|garden)\b/, /park|garden|plaza|beach|hiking|trail/],
  [/\b(movie|cinema|film|show)\b/, /cinema|movie|theater|theatre/],
  [/\b(shop\w*|market|store)\b/, /shop|store|market|mall|book/],
  [
    /\b(activity|game|arcade|bowling)\b/,
    /bowling|arcade|amusement|game|escape|karaoke|activity/,
  ],
];

const fits = (s: EditStop, re: RegExp) =>
  re.test([s.category, ...s.types].join(" ").toLowerCase());

function referenced(text: string, stops: EditStop[]) {
  const hits = new Set<number>();
  for (const [re, at] of ordinals)
    if (re.test(text))
      hits.add(Math.max(0, Math.min(stops.length - 1, at(stops.length))));
  for (const [ref, types] of categoryRefs)
    if (ref.test(text)) stops.forEach((s, i) => fits(s, types) && hits.add(i));
  // Names: "swap Bar Raval" / "not the aquarium"
  stops.forEach((s, i) => {
    const name = s.name.toLowerCase();
    const words = name.split(/\W+/).filter((w) => w.length > 4);
    if (text.includes(name) || words.some((w) => text.includes(w))) hits.add(i);
  });
  return [...hits].sort((a, b) => a - b);
}

const KNOWN =
  /\b(add|remove|drop|skip|cut|swap|replace|change|switch|instead|different|new|another|more|less|cheaper|expensive|budget|free|indoors?|inside|rain|cold|walk\w*|closer|shorter|longer|earlier|later|first|last|start|end|before|after|move|keep|romantic|fun|quiet|calm|chill|lively|cozy|fancy|fancier|nice|dinner|lunch|brunch|breakfast|food|eat|drinks?|bar|coffee|dessert|ice cream|sweet|museum|gallery|park|movie|show|shop\w*|game|arcade|bowling|karaoke|sushi|pizza|tacos?|view|surprise|everything|stop|place|sober|alcohol|halal|vegetarian|vegan|kids?|family)\b/;
/** Whether an instruction has anything in it to act on. */
function understood(text: string, stops: EditStop[]) {
  return (
    KNOWN.test(text) ||
    allVibes.some((v) => text.includes(v)) ||
    referenced(text, stops).length > 0 ||
    /\d{1,2}(:\d{2})?\s*(am|pm)/.test(text)
  );
}

/** Minutes from midnight in "dinner at 6:30", "move lunch to noon". */
function clock(text: string) {
  if (/\b(noon|midday)\b/.test(text)) return 12 * 60;
  const m = text.match(/\b(?:at|to|for|around|by)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (!m) return undefined;
  let h = Number(m[1]) % 12;
  if (m[3] === "pm" || (!m[3] && h < 8)) h += 12;
  return h * 60 + Number(m[2] ?? 0);
}

/**
 * Reordering requests: "X first", "X last", "move X to the start/end", "X before Y",
 * "swap the order", "dinner at 6:30" (moves the meal to about that time).
 */
function reorder(
  text: string,
  stops: EditStop[],
): { order: number[]; summary: string; mealAt?: { index: number; minute: number } } | undefined {
  const n = stops.length;
  if (n < 2) return undefined;
  const idx = [...Array(n).keys()];
  const moveTo = (i: number, to: number) => {
    const o = idx.filter((x) => x !== i);
    o.splice(to, 0, i);
    return o;
  };
  const label = (i: number) => stops[i].name;
  const subject = (phrase: string) => referenced(` ${phrase} `, stops)[0];
  const first = text.match(/\b(?:have |do |put |start with )?(?:the )?([a-z0-9 &'-]{3,40}?)\s+(?:first|at the (?:start|beginning))\b/);
  const last = text.match(/\b(?:have |do |put |end with )?(?:the )?([a-z0-9 &'-]{3,40}?)\s+(?:last|at the end)\b/);
  const move = text.match(/\bmove\s+(?:the )?(.+?)\s+to\s+(?:the\s+)?(start|beginning|front|first|end|last)\b/);
  const before = text.match(/\b(?:the )?([a-z0-9 &'-]{3,40}?)\s+before\s+(?:the )?([a-z0-9 &'-]{3,40})\b/);
  if (move) {
    const i = subject(move[1]);
    if (i !== undefined) {
      const toStart = /start|beginning|front|first/.test(move[2]);
      return { order: moveTo(i, toStart ? 0 : n - 1), summary: `Moving ${label(i)} to the ${toStart ? "start" : "end"}; same places, new times.` };
    }
  }
  if (first && !/\b(add|swap|replace)\b/.test(text)) {
    const i = subject(first[1]);
    if (i !== undefined)
      return i === 0
        ? { order: idx, summary: `${label(i)} is already first.` }
        : { order: moveTo(i, 0), summary: `Putting ${label(i)} first; same places, new times.` };
  }
  if (last && !/\b(add|swap|replace)\b/.test(text)) {
    const i = subject(last[1]);
    if (i !== undefined && i !== n - 1)
      return { order: moveTo(i, n - 1), summary: `Putting ${label(i)} last; same places, new times.` };
  }
  if (before) {
    const a = subject(before[1]);
    const b = subject(before[2]);
    if (a !== undefined && b !== undefined && a > b) {
      const o = idx.filter((x) => x !== a);
      o.splice(o.indexOf(b), 0, a);
      return { order: o, summary: `Putting ${label(a)} before ${label(b)}; same places, new times.` };
    }
  }
  if (/\b(swap|switch|reverse|flip) the order\b/.test(text)) {
    const refs = referenced(text, stops);
    if (refs.length === 2) {
      const o = [...idx];
      [o[refs[0]], o[refs[1]]] = [o[refs[1]], o[refs[0]]];
      return { order: o, summary: `Swapping ${label(refs[0])} and ${label(refs[1])}.` };
    }
    return { order: [...idx].reverse(), summary: "Reversing the order; same places, new times." };
  }
  // "dinner at 6:30", "move lunch to noon": put the meal where the clock reaches about that time.
  const at = clock(text);
  const meal = text.match(/\b(dinner|lunch|brunch|breakfast)\b/);
  if (at !== undefined && meal) {
    // The meal for that time: not a brunch café for dinner, and not a stop they locked in.
    const i = stops.findIndex(
      (s) =>
        fits(s, categoryRefs[0][1]) &&
        !s.locked &&
        !(meal[1] === "dinner" && /brunch|breakfast|caf/.test(s.category.toLowerCase())),
    );
    if (i >= 0)
      return {
        order: idx,
        mealAt: { index: i, minute: at },
        summary: `Moving ${label(i)} to about ${String(Math.floor(at / 60) % 12 || 12)}:${String(at % 60).padStart(2, "0")} ${at >= 720 ? "PM" : "AM"}; same places.`,
      };
  }
  return undefined;
}

/** Outdoor by its name or kind even when the provider's type says "tourist attraction". */
function looksOutdoor(s: EditStop) {
  return /\b(park|garden|trail|alley|district|square|plaza|harbourfront|waterfront|beach|bluffs?|island|market street|ravine|patio)\b/i.test(`${s.name} ${s.category}`);
}

/** Parse "keep the first two" style instructions into kept indices. */
function kept(text: string, n: number) {
  const m = text.match(
    /\bkeep(?:ing)?\s+(?:the\s+)?(first|last)\s+(two|three|2|3|one|1)\b/,
  );
  if (!m) return undefined;
  const count = { one: 1, "1": 1, two: 2, "2": 2, three: 3, "3": 3 }[m[2]]!;
  return m[1] === "first"
    ? Array.from({ length: Math.min(count, n) }, (_, i) => i)
    : Array.from({ length: Math.min(count, n) }, (_, i) => n - 1 - i);
}

export function interpretEdit(
  instruction: string,
  stops: EditStop[],
  request: Pick<
    PlanRequest,
    "budget" | "mode" | "duration" | "vibes" | "area" | "indoorOnly"
  >,
): EditOp {
  const op = interpret(instruction, stops, request);
  // Only stops this edit actually changes are unlocked.
  const unlock = (op.unlock ?? []).filter((i) => op.targets.includes(i));
  return { ...op, unlock };
}

function interpret(
  instruction: string,
  stops: EditStop[],
  request: Pick<
    PlanRequest,
    "budget" | "mode" | "duration" | "vibes" | "area" | "indoorOnly"
  >,
): EditOp {
  const text = ` ${instruction.toLowerCase().replace(/[’']/g, "'")} `;
  const n = stops.length;
  // A kept stop the person names directly ("swap the third stop", "replace STACKT") is theirs
  // to change: naming it is the unlock.
  const named = new Set(
    referenced(text, stops).filter(
      (i) =>
        stops[i].locked &&
        (ordinals.some(([re]) => re.test(text)) ||
          text.includes(stops[i].name.toLowerCase())),
    ),
  );
  const free = (indices: number[]) =>
    indices.filter(
      (i) => i >= 0 && i < n && (!stops[i].locked || named.has(i)),
    );

  // Nothing recognisable at all ("asdkjh qwe"): say so instead of guessing.
  if (!understood(text, stops))
    return {
      kind: "noop",
      targets: [],
      action: "",
      patch: {},
      summary:
        "I didn't understand that. Try something like “swap dinner for sushi”, “make it cheaper” or “add dessert at the end”.",
    };

  // "Home by 4", "finish by 3:30": fit the plan inside that end time.
  const finish = text.match(/\b(?:home|back|done|finish(?:ed)?|end|wrap up|out)\s+(?:in [a-z ]+ )?(?:by|before|at)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (finish && !/\b(longer|later|extend)\b/.test(text)) {
    let h = Number(finish[1]) % 12;
    if (finish[3] === "pm" || (!finish[3] && h < 9)) h += 12;
    return {
      kind: "endBy",
      targets: [],
      endBy: h * 60 + Number(finish[2] ?? 0),
      action: "",
      patch: {},
      summary: `Fitting the plan to finish by ${finish[1]}${finish[2] ? `:${finish[2]}` : ""}${finish[3] ? ` ${finish[3].toUpperCase()}` : h >= 12 ? " PM" : " AM"}: shorter visits first, then dropping the last stop if needed.`,
    };
  }
  // "Make it longer", "go until 8pm", "fill the day": add a stop and the time for it.
  const until = text.match(/\b(?:until|till|til|to)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (/\b(longer|extend|more time|fill (?:the|our) (?:day|evening|afternoon)|keep going)\b/.test(text) || (until && /\b(go|last|stay|make|fill|keep)\b/.test(text))) {
    const extra = until ? undefined : 75;
    return {
      kind: "add",
      targets: [],
      action: `Add exactly one new stop that suits the plan${/adventur|fun|active/.test(text) ? ", something adventurous or active" : ""}. Keep every existing stop.`,
      patch: { duration: Math.min(720, request.duration + (extra ?? 120)) },
      summary: until ? `Adding a stop so the plan runs to about ${until[1]}${until[3] ? ` ${until[3].toUpperCase()}` : ""}; your stops stay.` : "Adding a stop and about an hour; your stops stay.",
    };
  }

  // Order: "brunch first", "move the museum to the end", "dinner at 6:30".
  const order = reorder(text, stops);
  if (order)
    return {
      kind: "reorder",
      targets: [],
      order: order.order,
      mealAt: order.mealAt,
      action: "",
      patch: {},
      summary: order.summary,
    };
  // Asking about a meal the plan doesn't have ("make dinner fancier", "dinner at 7"): add one.
  const meal = text.match(/\b(dinner|lunch|brunch|breakfast)\b/)?.[1];
  if (
    meal &&
    // A brunch place doesn't count as dinner.
    !stops.some(
      (s) =>
        fits(s, categoryRefs[0][1]) &&
        !(meal === "dinner" && /brunch|breakfast/.test(s.category.toLowerCase())),
    ) &&
    !/\b(remove|drop|skip|no|without)\b/.test(text) &&
    n < 8
  )
    return {
      kind: "add",
      targets: [],
      action: `Add exactly one new stop matching: ${meal} restaurant${/fanc|nice|special|upscale|romantic/.test(text) ? ", somewhere special" : ""}. Keep every existing stop.`,
      patch: { duration: Math.min(720, request.duration + 75) },
      summary: `There was no ${meal} in this plan, so I'm adding one; your other stops stay.`,
    };
  const all = free(stops.map((_, i) => i));
  const lockedNote = stops.some((s) => s.locked)
    ? " Locked stops stay put."
    : "";
  const names = (ix: number[]) => ix.map((i) => `stop ${i + 1}`).join(" & ");
  const patch: EditOp["patch"] = {};
  const newVibes = allVibes.filter(
    (v) =>
      new RegExp(`\\b${v}`).test(text) ||
      (v === "romantic" && /\bromance\b/.test(text)),
  );
  if (newVibes.length)
    patch.vibes = [...new Set([...newVibes, ...request.vibes])].slice(0, 4);

  // 1. Removal: "drop the bar", "skip the last stop"
  if (/\b(remove|drop|skip|cut|lose|get rid of|delete)\b/.test(text)) {
    // Only what follows the verb, up to "and/then/,": "remove the dinner, end with dessert" keeps dessert.
    const clause = text.match(/\b(?:remove|drop|skip|cut|lose|get rid of|delete)\b(.*?)(?:,|;|\band\b|\bthen\b|\bbut\b|$)/)?.[1] ?? text;
    const targets = free(referenced(` ${clause} `, stops));
    if (targets.length && targets.length < n)
      return {
        kind: "remove",
        unlock: [...named],
        targets,
        action: "",
        patch: {},
        summary: `Removing ${names(targets)}; everything else stays.${lockedNote}`,
      };
  }

  // 2. Additions: "add dessert at the end", "one more stop"
  if (
    /\b(add|one more|another stop|extra stop|squeeze in|include)\b/.test(
      text,
    ) &&
    n < 8
  ) {
    const what = text
      .replace(
        /\b(add|please|can you|could you|one more|another|extra|squeeze in|include|stop|at the end|a|an)\b/g,
        " ",
      )
      .replace(/\s+/g, " ")
      .trim();
    return {
      kind: "add",
      targets: [],
      action: `Add exactly one new stop${what ? ` matching: ${what}` : ""}. Keep every existing stop.`,
      patch: { duration: Math.min(720, request.duration + 60) },
      summary: `Adding one stop${what ? ` (${what})` : ""} and an extra hour; your current stops stay.`,
    };
  }

  // 3. Explicit targeting: "replace dinner with ...", "keep the first two, change the last"
  const keep = kept(text, n);
  let targets = keep ? all.filter((i) => !keep.includes(i)) : [];
  const replaceClause = text.match(
    /\b(?:replace|swap|change|switch|instead of|different|new)\b(.*?)(?:\bwith\b|\bfor\b|$)/,
  );
  if (!targets.length && replaceClause)
    targets = free(referenced(replaceClause[1] || text, stops));
  if (!targets.length && !keep) {
    const refs = free(referenced(text, stops));
    if (
      refs.length &&
      refs.length < n &&
      /\b(replace|swap|change|switch|instead|different|new|another|other)\b/.test(
        text,
      )
    )
      targets = refs;
  }
  const withWhat = text.match(/\bwith\s+(.+)$/)?.[1]?.trim();

  // 4. Global retunes
  if (
    /\b(cheaper|less expensive|budget|save money|broke|cost less|too expensive|affordable|free)\b/.test(
      text,
    )
  ) {
    patch.budget = Math.max(0, Math.round(request.budget * 0.6));
    if (!targets.length) {
      const paid = all
        .filter(
          (i) => stops[i].priceHigh === null || (stops[i].priceHigh ?? 0) > 0,
        )
        .sort(
          (a, b) => (stops[b].priceHigh ?? 999) - (stops[a].priceHigh ?? 999),
        );
      targets = paid.length
        ? paid.slice(0, Math.max(1, Math.ceil(paid.length / 2)))
        : [];
    }
    if (!targets.length)
      return {
        kind: "noop",
        targets: [],
        action: "",
        patch: {},
        summary: stops.some((st) => st.locked && (st.priceHigh ?? 1) > 0)
          ? "The stops that cost money are locked in. Tap one and choose “Let it change” to swap it for something cheaper."
          : "Every stop is already free, so there's nothing cheaper to swap in.",
      };
    return {
      kind: "replace",
      unlock: [...named],
      targets,
      action: `Make it cheaper: choose free or lower-priced options${withWhat ? `, ideally ${withWhat}` : ""}. Prefer published low prices.`,
      patch,
      summary: `Swapping ${names(targets)} for lower-cost picks; per-person budget lowered to about $${patch.budget}.${lockedNote}`,
    };
  }
  if (/\b(indoors?|inside|rain\w*|weather|cold|snow\w*|storm)\b/.test(text)) {
    patch.indoorOnly = true;
    const outdoor = targets.length
      ? targets
      : all.filter((i) => isOutdoor(stops[i]) || looksOutdoor(stops[i]));
    // "Indoors, maybe a movie": the rest of the request still counts.
    const more = /\b(movie|cinema|museum|gallery|caf[eé]|coffee|lunch|dinner|dessert|game|arcade|bowling|show|until|longer|add)\b/.test(text);
    if (!outdoor.length && more) {
      return {
        kind: "replace",
        unlock: [...named],
        targets: all.slice(-1),
        action: `Indoors only. User request: "${instruction.trim().slice(0, 200)}". Replace only the unlocked stops; keep the others exactly.`,
        patch,
        summary: `Everything is already indoors; reworking ${names(all.slice(-1))} for what you asked.${lockedNote}`,
      };
    }
    if (!outdoor.length)
      return {
        kind: "noop",
        targets: [],
        action: "",
        patch: { indoorOnly: true },
        summary: "Already all indoors — you're covered if it rains.",
      };
    return {
      kind: "replace",
      unlock: [...named],
      targets: outdoor,
      action:
        "The weather changed: replace with indoor venues that keep the same mood.",
      patch,
      summary: `Moving ${names(outdoor)} indoors; the rest stays.${lockedNote}`,
    };
  }
  if (
    /\b(less walking|reduce walking|walk less|too much walking|closer together|tired|shorter distances|less travel)\b/.test(
      text,
    )
  ) {
    const far = targets.length
      ? targets
      : all
          .filter((i) => i > 0)
          .sort((a, b) => stops[b].travel - stops[a].travel)
          .slice(0, 1);
    return {
      kind: "replace",
      unlock: [...named],
      targets: far.length ? far : all.slice(-1),
      action:
        "Less walking: choose a place very close to the neighbouring stops.",
      patch,
      summary: `Replacing ${names(far.length ? far : all.slice(-1))} with something closer to the other stops.${lockedNote}`,
    };
  }
  if (
    /\b(shorter|less time|wrap up earlier|end earlier|in a rush|quicker)\b/.test(
      text,
    ) &&
    all.length &&
    n > 1
  ) {
    // Drop the last thing that isn't a meal: shorter shouldn't mean hungry.
    const last =
      [...all].reverse().find((i) => !fits(stops[i], categoryRefs[0][1])) ??
      all.at(-1)!;
    return {
      kind: "remove",
      targets: [last],
      action: "",
      patch: {},
      summary: `Ending earlier by dropping ${names([last])}.${lockedNote}`,
    };
  }

  // 5. Vibe changes ("more romantic", "more adventurous") replace the stops that fit least.
  if (!targets.length && newVibes.length) {
    const re = new RegExp(newVibes.map((v) => vibeTypes[v].source).join("|"));
    const misfits = all.filter((i) => !fits(stops[i], re));
    targets = (misfits.length ? misfits : all).slice(
      0,
      Math.max(1, Math.ceil(all.length / 2)),
    );
  }
  if (!targets.length)
    targets =
      /\b(surprise|everything|all|whole|start over|totally different)\b/.test(
        text,
      )
        ? all
        : all.slice(-1);
  if (!targets.length)
    return {
      kind: "noop",
      targets: [],
      action: "",
      patch: {},
      summary: "Every stop is locked. Unlock one to change it.",
    };
  const vibeText = newVibes.length
    ? `Make it more ${newVibes.join(" and ")}. `
    : "";
  return {
    kind: "replace",
    unlock: [...named],
    targets,
    action: `${vibeText}User request: "${instruction.trim().slice(0, 200)}". Replace only the unlocked stops; keep the others exactly.`,
    patch,
    summary: `Reworking ${names(targets)}${withWhat ? ` → ${withWhat}` : newVibes.length ? ` to feel more ${newVibes.join(" & ")}` : ""}; keeping ${n - targets.length ? `the other ${n - targets.length}` : "your constraints"}.${lockedNote}`,
  };
}

/** The preview summary, rephrased for after the change has been applied. */
export function doneSummary(summary: string) {
  return summary
    .replace(/^Reworking/, "Reworked")
    .replace(/^Swapping/, "Swapped")
    .replace(/^Removing/, "Removed")
    .replace(/^Adding/, "Added")
    .replace(/^Moving/, "Moved")
    .replace(/^Replacing/, "Replaced")
    .replace(/^Ending earlier by dropping/, "Ended earlier by dropping")
    .replace(/; keeping /, "; kept ")
    .replace(/everything else stays/, "everything else stayed")
    .replace(/the rest stays/, "the rest stayed")
    .replace(/your current stops stay/, "your current stops stayed")
    .replace(/per-person budget lowered/, "per-person budget now");
}
