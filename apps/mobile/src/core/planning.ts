import { DateTime } from "luxon";
import {
  PlanRequest,
  type Location,
  type PlanningIntent,
} from "../../../../lib/schema";
import { localStart } from "../../../../lib/time";

export const steps = [
  "location",
  "interests",
  "companion",
  "energy",
  "vibes",
  "budget",
  "date",
  "duration",
] as const;
export type Step = (typeof steps)[number];
export type Draft = Partial<PlanRequest> & {
  prompt: string;
  known: string[];
  demo: boolean;
  dateChoice?: PlanningIntent["dateChoice"];
  preferenceFields?: string[];
  savedBudget?: { amount: number; currency: string };
};
export function remainingSteps(draft: Draft): Step[] {
  return steps.filter((step) =>
    step === "location" ? !draft.location : !draft.known.includes(step),
  );
}
export function choosePreferences(draft: Draft, patch: Partial<Draft>): Draft {
  const known = new Set(draft.known);
  for (const [key, value] of Object.entries(patch)) {
    const field = key === "dateChoice" ? "date" : key;
    if (steps.includes(field as Step) || field === "startTime") {
      if (value === undefined) known.delete(field);
      else known.add(field);
    }
  }
  return {
    ...draft, ...patch, known: [...known],
    preferenceFields: draft.preferenceFields?.filter(key => !Object.hasOwn(patch, key)),
    savedBudget: Object.hasOwn(patch, "budget") ? undefined : draft.savedBudget,
  };
}
export function defaultStart(
  location: Location,
  now: DateTime = DateTime.now(),
) {
  const local = now.setZone(location.timezone);
  if (!local.isValid)
    throw new Error(
      "This destination has an unavailable timezone. Choose another place.",
    );
  return { date: local.plus({ days: 1 }).toISODate()!, startTime: "11:00" };
}
// Preference amounts, not exchange-rate conversions or verified venue prices.
export function budgetPresets(currency: string): [number, number, number] {
  const local: Record<string, [number, number, number]> = {
    JPY: [3000, 6000, 12000],
    KRW: [30000, 60000, 120000],
    INR: [1000, 2500, 5000],
    IDR: [150000, 400000, 800000],
    VND: [250000, 600000, 1000000],
    THB: [700, 1500, 3000],
    TWD: [700, 1500, 3000],
    MXN: [400, 900, 1800],
    PHP: [1000, 2500, 5000],
    HUF: [8000, 18000, 35000],
  };
  return local[currency] ?? [30, 60, 120];
}
export function requestFromDraft(
  draft: Draft,
  now: DateTime = DateTime.now(),
): PlanRequest {
  if (!draft.location) throw new Error("Choose a place to explore first.");
  const defaults = defaultStart(draft.location, now);
  const supplied = Object.fromEntries(
    Object.entries(draft).filter(([, value]) => value !== undefined),
  );
  const parsed = PlanRequest.safeParse({
    interests: ["Surprise me"],
    duration: 240,
    budget: budgetPresets(draft.location.currency)[1],
    hardBudget: false,
    participants: draft.companion === "date" ? 2 : 1,
    mode: "WALK",
    ...defaults,
    ...supplied,
    area: {
      center: draft.location.center,
      radius: draft.area?.radius ?? 2000,
      locked: true,
    },
  });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    const messages: Record<string, string> = {
      budget: "Enter a budget from 0 to 1,000,000 per person.",
      duration: "Choose a whole-number duration from 60 to 720 minutes.",
      date: "Choose a valid date in YYYY-MM-DD format.",
      startTime: "Enter a start time in HH:mm format.",
      participants: "Choose a group size from 1 to 20.",
    };
    throw new Error(
      messages[String(field)] ?? "Check your outing choices before generating.",
    );
  }
  const request = parsed.data;
  const start = localStart(
    request.date,
    request.startTime,
    request.location.timezone,
  );
  if (start.toMillis() <= now.toMillis())
    throw new Error(
      "Choose a future start time in the destination’s timezone.",
    );
  if (start.toMillis() > now.plus({ days: 365 }).toMillis())
    throw new Error("Choose a date within the next year.");
  return request;
}
export function relativeDate(
  choice: "today" | "tomorrow",
  location: Location,
  now: DateTime = DateTime.now(),
) {
  const local = now.setZone(location.timezone);
  if (!local.isValid)
    throw new Error("This destination has an unavailable timezone.");
  const start =
    choice === "today"
      ? local.plus({ hours: 1 }).startOf("hour")
      : local.plus({ days: 1 }).set({ hour: 11, minute: 0 });
  if (choice === "today" && start.toISODate() !== local.toISODate())
    throw new Error(
      "There’s no upcoming start hour left today here. Choose tomorrow or set a start time.",
    );
  return { date: start.toISODate()!, startTime: start.toFormat("HH:mm") };
}
export function withLocation(
  draft: Draft,
  location: Location,
  now: DateTime = DateTime.now(),
): Draft {
  let timing = defaultStart(location, now);
  if (draft.dateChoice === "today" || draft.dateChoice === "tomorrow") {
    if (draft.known.includes("startTime") && draft.startTime)
      timing.date = now
        .setZone(location.timezone)
        .plus({ days: draft.dateChoice === "tomorrow" ? 1 : 0 })
        .toISODate()!;
    else timing = relativeDate(draft.dateChoice, location, now);
  } else if (draft.known.includes("date") && draft.date)
    timing.date = draft.date;
  if (draft.known.includes("startTime") && draft.startTime)
    timing.startTime = draft.startTime;
  const next = { ...draft, location, ...timing };
  const known = new Set(draft.known);
  const preferenceBudget = draft.preferenceFields?.includes("budget") === true;
  const explicitBudget = known.has("budget") && draft.budget !== undefined && !preferenceBudget;
  if (!explicitBudget && draft.savedBudget) {
    if (draft.savedBudget.currency === location.currency) {
      next.budget = draft.savedBudget.amount;
      if (preferenceBudget) known.add("budget");
    } else if (preferenceBudget) {
      next.budget = undefined;
      known.delete("budget");
    }
  }
  next.known = [...known];
  return next;
}
export function applyIntent(
  draft: Draft,
  result: PlanningIntent,
  now: DateTime = DateTime.now(),
): Draft {
  let next = { ...draft };
  const known = new Set(draft.known);
  const preferenceFields = new Set(draft.preferenceFields ?? []);
  const hasDateChoice = known.has("date") && (draft.date !== undefined || draft.dateChoice !== undefined);
  for (const key of [
    "interests",
    "companion",
    "energy",
    "vibes",
    "budget",
    "duration",
    "mode",
    "participants",
    "dietary",
    "accessibility",
    "startTime",
  ] as const) {
    const chosen = known.has(key) && draft[key] !== undefined && !preferenceFields.has(key);
    const chosenGroup = key === "participants" && known.has("companion") && draft.participants !== undefined && !preferenceFields.has("companion");
    if (result[key] !== undefined && !chosen && !chosenGroup) {
      Object.assign(next, { [key]: result[key] });
      preferenceFields.delete(key);
      if (
        [
          "interests",
          "companion",
          "energy",
          "vibes",
          "budget",
          "duration",
          "startTime",
        ].includes(key)
      )
        known.add(key);
    }
  }
  if (next.participants && result.participants) known.add("companion");
  if (result.dateChoice && !hasDateChoice) {
    next.dateChoice = result.dateChoice;
    known.add("date");
    if (result.dateChoice === "specific" && result.date)
      next.date = result.date;
  }
  next.known = [...known];
  next.preferenceFields = [...preferenceFields];
  const location = next.location;
  if (location) {
    try {
      next = withLocation(next, location, now);
    } catch {
      // Today may have no usable upcoming start. Preserve the other supplied
      // answers and expose the date question instead of inventing a past time.
      next.dateChoice = undefined;
      known.delete("date");
      next.known = [...known];
      next = withLocation(next, location, now);
    }
  }
  return next;
}
