import { z } from "zod";
import { Affinity, companions, interests, travelModes, vibes } from "./schema";

/**
 * The user's taste profile. Built from onboarding, refined by explicit feedback.
 * Stored on device first; synced to the account only when signed in.
 */
export const TasteProfile = z.object({
  version: z.literal(1).default(1),
  onboarded: z.boolean().default(false),
  name: z.string().max(40).default(""),
  companions: z.enum(companions).default("partner"),
  vibes: z.array(z.enum(vibes)).max(6).default([]),
  interests: z.array(z.enum(interests)).max(10).default([]),
  /** Typical comfortable spend per person, in the area's currency. */
  budget: z.number().min(0).max(5000).default(50),
  mode: z.enum(travelModes).default("TRANSIT"),
  homeArea: z.string().max(40).default("downtown"),
  availability: z
    .array(z.enum(["weeknights", "weekends", "daytime", "late"]))
    .max(4)
    .default([]),
  dietary: z.string().max(300).default(""),
  accessibility: z.string().max(300).default(""),
  affinity: Affinity.default({}),
  /** Place IDs the user asked never to see again. */
  disliked: z.array(z.string().max(250)).max(100).default([]),
  /** Saved favourite places: IDs and a display name only (provider content is not stored). */
  favourites: z
    .array(z.object({ id: z.string().max(250), name: z.string().max(120) }))
    .max(100)
    .default([]),
  /** Poll answers by poll id (one-tap "this or that" questions). */
  polls: z
    .record(z.string().max(40), z.enum(["a", "b"]))
    .refine((v) => Object.keys(v).length <= 60)
    .default({}),
  /** Product analytics consent. Off until the user agrees. */
  analytics: z.boolean().default(false),
});
export type TasteProfile = z.infer<typeof TasteProfile>;
export const emptyProfile = (): TasteProfile => TasteProfile.parse({});

export const Feedback = z.object({
  planId: z.string().uuid(),
  went: z.enum(["yes", "partly", "no"]),
  rating: z.number().int().min(1).max(5).optional(),
  /** Per-stop reactions: +1 loved, -1 not for us. */
  stops: z
    .array(
      z.object({
        placeId: z.string().max(250),
        category: z.string().max(60),
        reaction: z.union([z.literal(1), z.literal(-1)]),
      }),
    )
    .max(8)
    .default([]),
  note: z.string().max(500).default(""),
});
export type Feedback = z.infer<typeof Feedback>;

const clamp = (n: number) =>
  Math.max(-3, Math.min(3, Math.round(n * 100) / 100));

/**
 * Feedback-driven ranking, deliberately simple: each reaction nudges the category
 * affinity by ±0.5 (bounded to ±3) and a disliked place is excluded from future plans.
 * A good overall rating gives a smaller nudge to every stop in the plan.
 */
export function applyFeedback(
  profile: TasteProfile,
  feedback: Feedback,
  planCategories: string[] = [],
): TasteProfile {
  const affinity = { ...profile.affinity };
  const bump = (key: string, by: number) => {
    const k = key.toLowerCase().slice(0, 60);
    if (!k) return;
    affinity[k] = clamp((affinity[k] ?? 0) + by);
  };
  for (const s of feedback.stops) bump(s.category, s.reaction * 0.5);
  if (feedback.rating && feedback.went !== "no") {
    const overall = (feedback.rating - 3) * 0.1;
    for (const c of planCategories) bump(c, overall);
  }
  // Keep the strongest signals if the map grows.
  const trimmed = Object.fromEntries(
    Object.entries(affinity)
      .filter(([, v]) => v !== 0)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, 40),
  );
  const disliked = [
    ...new Set([
      ...profile.disliked,
      ...feedback.stops.filter((s) => s.reaction < 0).map((s) => s.placeId),
    ]),
  ].slice(-100);
  return { ...profile, affinity: trimmed, disliked };
}
