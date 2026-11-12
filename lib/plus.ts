import type { TasteProfile } from "./profile";

/**
 * Whimway Plus: pricing and limits. These are HYPOTHESES to test, not validated prices.
 * Free stays genuinely useful (the core loop is never paywalled); Plus removes limits and
 * adds depth. Enforcement here is client-side for the beta; production must verify
 * store receipts server-side (see docs/monetization.md).
 */
export const FREE = { plansPerMonth: 5, magicEditsPerPlan: 3 } as const;
export const PRICES = {
  monthly: {
    id: "plus_monthly",
    amount: 6.99,
    currency: "CAD",
    label: "Monthly",
    per: "month",
  },
  yearly: {
    id: "plus_yearly",
    amount: 39.99,
    currency: "CAD",
    label: "Yearly",
    per: "year",
  },
} as const;
export const TRIAL_DAYS = 7;
export type PlusPlan = keyof typeof PRICES;

export const plusBenefits = [
  {
    icon: "zap",
    title: "Unlimited plans and edits",
    detail: `Free includes ${FREE.plansPerMonth} plans a month and ${FREE.magicEditsPerPlan} Magic Edits per plan.`,
  },
  {
    icon: "heart",
    title: "Plan around your favourites",
    detail: "Build a whole night around any place you’ve saved.",
  },
  {
    icon: "sliders",
    title: "Fine-tune every night",
    detail: "Set your pace and go alcohol-free.",
  },
  {
    icon: "gift",
    title: "Surprise mode",
    detail: "One tap, no typing: a plan picked for your taste.",
  },
] as const;

export const yearlySaving = Math.round(
  (1 - PRICES.yearly.amount / (PRICES.monthly.amount * 12)) * 100,
);

export const monthKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

export function isPlus(profile: Pick<TasteProfile, "plus">, now = new Date()) {
  const p = profile.plus;
  return Boolean(p?.active && (!p.until || new Date(p.until) > now));
}
export function plansLeft(
  profile: Pick<TasteProfile, "plus" | "usage">,
  now = new Date(),
) {
  if (isPlus(profile, now)) return Infinity;
  const used = profile.usage.month === monthKey(now) ? profile.usage.plans : 0;
  return Math.max(0, FREE.plansPerMonth - used);
}
/** Record one generated plan against this month's allowance. */
export function countPlan<T extends Pick<TasteProfile, "usage">>(
  profile: T,
  now = new Date(),
): T {
  const month = monthKey(now);
  const plans = profile.usage.month === month ? profile.usage.plans + 1 : 1;
  return { ...profile, usage: { month, plans } };
}
export function editsLeft(
  profile: Pick<TasteProfile, "plus">,
  usedOnPlan: number,
) {
  return isPlus(profile)
    ? Infinity
    : Math.max(0, FREE.magicEditsPerPlan - usedOnPlan);
}
