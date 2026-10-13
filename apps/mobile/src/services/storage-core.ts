import { z } from "zod";
import { PlanSpec, interests, type Itinerary } from "../../../../lib/schema";
import { persistSpec } from "../../../../lib/storage";

export const PreferencesSchema = z.object({
  enabled: z.boolean().default(false),
  interests: z.array(z.enum(interests)).max(10).default(["Surprise me"]),
  dietary: z.string().max(300).default(""),
  accessibility: z.string().max(300).default(""),
  mode: z.enum(["WALK", "DRIVE"]).default("WALK"),
  budget: z.number().min(0).max(1000000).default(60),
  budgetCurrency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  cuisines: z.string().max(200).default(""),
  atmosphere: z.string().max(200).default(""),
  disliked: z.array(z.string().max(250)).max(100).default([]),
});
export type Preferences = z.infer<typeof PreferencesSchema>;
export const defaultPreferences: Preferences = PreferencesSchema.parse({});
export function preferenceSyncDecision(
  local: Preferences,
  cloud: Preferences,
  dirty = false,
): "unchanged" | "adopt-account" | "choose-source" {
  if (JSON.stringify(local) === JSON.stringify(cloud)) return "unchanged";
  return !dirty && JSON.stringify(local) === JSON.stringify(defaultPreferences)
    ? "adopt-account"
    : "choose-source";
}
export const DayProgressSchema = z.object({
  planId: z.string().uuid(),
  startedAt: z.string().datetime({ offset: true }),
  completed: z.array(z.string().min(1).max(250)).max(8),
  skipped: z.array(z.string().min(1).max(250)).max(8),
});
export type DayProgress = z.infer<typeof DayProgressSchema>;
export const dayProgressKey = (id: string) => `whimway:native:progress:${id}`;
export const FavoritePlaceRefSchema = z.object({
  placeId: z.string().min(1).max(250),
  currency: z.string().regex(/^[A-Z]{3}$/),
  timezone: z.string().min(1).max(80),
  demo: z.boolean(),
  sourceLocationId: z.string().min(1).max(250).optional(),
});
export type FavoritePlaceRef = z.infer<typeof FavoritePlaceRefSchema>;
export function favoritePlaceReference(
  plan: Itinerary,
  placeId: string,
): FavoritePlaceRef {
  if (!plan.stops.some((stop) => stop.placeId === placeId))
    throw new Error("Choose a stop from this outing to save as a favorite.");
  return FavoritePlaceRefSchema.parse({
    placeId,
    currency: plan.request.location.currency,
    timezone: plan.request.location.timezone,
    demo: plan.demo,
    sourceLocationId: plan.demo ? plan.request.location.placeId : undefined,
  });
}

export function referenceOnlyPlan(plan: Itinerary | PlanSpec): PlanSpec {
  return persistSpec(PlanSpec.parse(plan));
}

export function parseSavedPlans(raw: string | null): PlanSpec[] {
  if (!raw) return [];
  try {
    const items: unknown = JSON.parse(raw);
    if (!Array.isArray(items)) return [];
    return items
      .flatMap((item) => {
        const parsed = PlanSpec.safeParse(item);
        return parsed.success ? [referenceOnlyPlan(parsed.data)] : [];
      })
      .slice(0, 100);
  } catch {
    return [];
  }
}

export function reconcileDayProgress(
  progress: DayProgress,
  plan: Itinerary,
): DayProgress {
  const valid = new Set(plan.stops.map((stop) => stop.placeId));
  const completed = [...new Set(progress.completed)].filter((id) =>
    valid.has(id),
  );
  const skipped = [...new Set(progress.skipped)].filter(
    (id) => valid.has(id) && !completed.includes(id),
  );
  return DayProgressSchema.parse({
    ...progress,
    planId: plan.id,
    completed,
    skipped,
  });
}
