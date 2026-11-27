// Sponsored placements: how local businesses pay for Whimway while it stays free.
// Campaigns are kept apart from organic recommendations in data, in ranking, and on
// screen, where every placement is labelled "Sponsored". Nothing is shown unless a real
// campaign has been created; there are no built-in advertisers.
import { z } from "zod";
import { distance } from "./geo";
import { Point } from "./schema";

export const surfaces = ["home", "discover", "options"] as const;
export type Surface = (typeof surfaces)[number];

export const Campaign = z.object({
  id: z.string().uuid(),
  business: z.object({
    name: z.string().min(1).max(120),
    /** Google place ID when the business is a real listing, so it can be planned around. */
    placeId: z.string().max(250).optional(),
    category: z.string().max(60).default(""),
  }),
  headline: z.string().min(1).max(80),
  body: z.string().max(200).default(""),
  cta: z.string().min(1).max(30).default("Learn more"),
  url: z
    .string()
    .url()
    .max(500)
    .refine((u) => u.startsWith("https://"), "Links must use https"),
  /** Where it may be shown: a centre and radius in metres. */
  area: z.object({ center: Point, radius: z.number().min(500).max(50000) }),
  /** Guided-planning category keys it is relevant to (e.g. "mexican", "games"); empty = any. */
  categories: z.array(z.string().max(40)).max(12).default([]),
  surfaces: z.array(z.enum(surfaces)).min(1).default(["home", "discover"]),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  active: z.boolean().default(true),
  /** Stop serving once this many impressions have been recorded (0 = no cap). */
  impressionCap: z.number().int().min(0).max(10_000_000).default(0),
});
export type Campaign = z.infer<typeof Campaign>;
export const NewCampaign = Campaign.omit({ id: true });

/** What the app receives: enough to render and track, nothing internal. */
export const Placement = z.object({
  id: z.string(),
  campaignId: z.string().uuid(),
  surface: z.enum(surfaces),
  label: z.literal("Sponsored"),
  business: Campaign.shape.business,
  headline: z.string(),
  body: z.string(),
  cta: z.string(),
  url: z.string(),
});
export type Placement = z.infer<typeof Placement>;

export const AdEvent = z.object({
  placementId: z.string().max(120),
  campaignId: z.string().uuid(),
  kind: z.enum(["impression", "click"]),
  installId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
});
export type AdEvent = z.infer<typeof AdEvent>;

/**
 * Pick at most one campaign for a surface: running now, in range, relevant to the
 * category being browsed when one is given, under its cap. Fewest impressions first, so
 * campaigns rotate fairly.
 */
export function choose(
  campaigns: Campaign[],
  ctx: { surface: Surface; point: Point; category?: string; now?: Date },
  impressions: Record<string, number> = {},
): Campaign | undefined {
  const now = (ctx.now ?? new Date()).getTime();
  const eligible = campaigns.filter(
    (c) =>
      c.active &&
      c.surfaces.includes(ctx.surface) &&
      Date.parse(c.startsAt) <= now &&
      now < Date.parse(c.endsAt) &&
      distance(ctx.point, c.area.center) <= c.area.radius &&
      (!c.impressionCap || (impressions[c.id] ?? 0) < c.impressionCap) &&
      (!ctx.category ||
        !c.categories.length ||
        c.categories.includes(ctx.category)),
  );
  eligible.sort((a, b) => (impressions[a.id] ?? 0) - (impressions[b.id] ?? 0));
  return eligible[0];
}

export function toPlacement(c: Campaign, surface: Surface): Placement {
  return {
    id: `${c.id}:${surface}`,
    campaignId: c.id,
    surface,
    label: "Sponsored",
    business: c.business,
    headline: c.headline,
    body: c.body,
    cta: c.cta,
    url: c.url,
  };
}
