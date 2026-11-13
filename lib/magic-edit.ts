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
  kind: "replace" | "remove" | "add" | "noop";
  /** Indices of stops to regenerate (replace) or drop (remove). */
  targets: number[];
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
  const text = ` ${instruction.toLowerCase().replace(/[’']/g, "'")} `;
  const n = stops.length;
  const free = (indices: number[]) =>
    indices.filter((i) => i >= 0 && i < n && !stops[i].locked);
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
    const targets = free(referenced(text, stops));
    if (targets.length && targets.length < n)
      return {
        kind: "remove",
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
        summary: "Every stop is already free — nothing cheaper to swap in.",
      };
    return {
      kind: "replace",
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
      : all.filter((i) => isOutdoor(stops[i]));
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
    const last = all.at(-1)!;
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
