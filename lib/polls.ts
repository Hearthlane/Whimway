import { z } from "zod";
import type { TasteProfile } from "./profile";
import { slug } from "./crowd";

/**
 * One-tap "this or that" polls. Each option maps to provider place types or
 * categories ("signals"). Answers tune the user's own taste profile immediately and
 * feed anonymous community signals that re-rank recommendations for everyone.
 */
export type PollOption = { label: string; signals: string[] };
export type Poll = {
  id: string;
  question: string;
  a: PollOption;
  b: PollOption;
};

export const polls: Poll[] = [
  {
    id: "first-stop",
    question: "Perfect first stop?",
    a: { label: "A cozy café", signals: ["cafe", "coffee_shop", "bakery"] },
    b: {
      label: "Something active",
      signals: ["bowling", "game", "amusement_center"],
    },
  },
  {
    id: "rainy-night",
    question: "Rainy night in. Or out?",
    a: { label: "Board-game café", signals: ["board game café", "game"] },
    b: {
      label: "Movie, then dessert",
      signals: ["movie_theater", "dessert_shop", "ice_cream_shop"],
    },
  },
  {
    id: "dinner-view",
    question: "Dinner should be…",
    a: {
      label: "A hidden-gem hole in the wall",
      signals: ["thai_restaurant", "mexican_restaurant", "food_court"],
    },
    b: {
      label: "Somewhere with a view",
      signals: ["observation_deck", "italian_restaurant"],
    },
  },
  {
    id: "late-night",
    question: "It’s 10pm. Next move?",
    a: { label: "Cocktail bar", signals: ["cocktail_bar", "wine_bar", "bar"] },
    b: {
      label: "Ice cream walk",
      signals: ["ice_cream_shop", "dessert_shop", "park"],
    },
  },
  {
    id: "date-idea",
    question: "Better date idea?",
    a: { label: "Gallery hop", signals: ["art_gallery", "museum"] },
    b: { label: "Arcade bar", signals: ["amusement_center", "game", "bar"] },
  },
  {
    id: "weekend-day",
    question: "Saturday daytime?",
    a: { label: "Market wander", signals: ["market", "shopping"] },
    b: { label: "Park & trail", signals: ["park", "hiking_area"] },
  },
  {
    id: "group-hang",
    question: "With the crew, you’d rather…",
    a: {
      label: "Compete at something",
      signals: ["bowling", "game", "amusement_center"],
    },
    b: {
      label: "Eat our way around",
      signals: ["market", "food_court", "restaurant"],
    },
  },
  {
    id: "culture",
    question: "Pick one:",
    a: {
      label: "Museum after dark",
      signals: ["museum", "historical_landmark"],
    },
    b: { label: "Brewery patio", signals: ["brewery"] },
  },
  {
    id: "sweet",
    question: "Sweet finish?",
    a: { label: "Patisserie", signals: ["bakery", "patisserie"] },
    b: { label: "Soft serve", signals: ["ice_cream_shop"] },
  },
  {
    id: "views",
    question: "Skyline views from…",
    a: { label: "Up high", signals: ["observation_deck"] },
    b: { label: "The waterfront", signals: ["beach", "park", "island park"] },
  },
];

export const PollAnswer = z.object({
  pollId: z.string().max(40),
  choice: z.enum(["a", "b"]),
  installId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
});
export type PollAnswer = z.infer<typeof PollAnswer>;
export type PollTally = { a: number; b: number };

/** Plan Pulse: why a plan didn't land, each with a one-tap Magic Edit fix. */
export const pulseReasons = {
  too_pricey: { label: "Too pricey", fix: "Make it cheaper" },
  too_far: { label: "Too much travel", fix: "Reduce walking" },
  not_my_vibe: {
    label: "Not my vibe",
    fix: "Surprise me with something totally different",
  },
  wrong_time: { label: "Wrong timing", fix: "" },
  seen_it: {
    label: "Been there",
    fix: "Swap the first stop for something different",
  },
} as const;
export type PulseReason = keyof typeof pulseReasons;

/** A single reaction: a key (category/type/place/poll) and a thumbs up or down. */
export const SignalKey = z
  .string()
  .regex(/^(cat|type|place):[\w &.'-]{1,120}$/);
export const SignalBatch = z.object({
  installId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
  source: z.enum(["stop", "plan", "feedback", "poll"]),
  reason: z
    .enum(Object.keys(pulseReasons) as [PulseReason, ...PulseReason[]])
    .optional(),
  entries: z
    .array(
      z.object({
        key: SignalKey,
        value: z.union([z.literal(1), z.literal(-1)]),
      }),
    )
    .min(1)
    .max(16),
});
export type SignalBatch = z.infer<typeof SignalBatch>;

const norm = (s: string) => s.toLowerCase().slice(0, 60);
/** Signal keys for a venue: its category, its primary types and the place itself. */
export function placeKeys(place: {
  id: string;
  category: string;
  types: string[];
}) {
  return [
    `cat:${slug(place.category)}`,
    ...place.types.slice(0, 2).map((t) => `type:${slug(t)}`),
    `place:${place.id.replace(/[^\w-]/g, "").slice(0, 120)}`,
  ].filter((k) => !k.endsWith(":"));
}

const clamp = (n: number) =>
  Math.max(-3, Math.min(3, Math.round(n * 100) / 100));
/** Answering a poll nudges the user's own affinities: +0.3 chosen, −0.1 the other. */
export function applyPoll(
  profile: TasteProfile,
  poll: Poll,
  choice: "a" | "b",
): TasteProfile {
  const affinity = { ...profile.affinity };
  const chosen = poll[choice];
  const other = poll[choice === "a" ? "b" : "a"];
  for (const k of chosen.signals)
    affinity[norm(k)] = clamp((affinity[norm(k)] ?? 0) + 0.3);
  for (const k of other.signals)
    affinity[norm(k)] = clamp((affinity[norm(k)] ?? 0) - 0.1);
  const trimmed = Object.fromEntries(
    Object.entries(affinity)
      .filter(([, v]) => v !== 0)
      .sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]))
      .slice(0, 40),
  );
  return {
    ...profile,
    affinity: trimmed,
    polls: { ...profile.polls, [poll.id]: choice },
  };
}

/** Next unanswered poll (rotates once all are answered). */
export function nextPoll(
  answered: Record<string, string>,
  skip: string[] = [],
) {
  return (
    polls.find((p) => !answered[p.id] && !skip.includes(p.id)) ??
    polls.find((p) => !skip.includes(p.id))
  );
}
