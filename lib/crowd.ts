/**
 * Community signals: what people across Whimway find fun (or not).
 *
 * Every poll answer, stop reaction, plan pulse and post-outing rating becomes an
 * anonymous +1/−1 on a key ("cat:cocktail bar", "type:bowling", "place:<id>").
 * Keys only count once MIN_PEOPLE distinct people have weighed in, and scores are
 * smoothed toward neutral, so a handful of votes can't swing recommendations.
 */
/** Canonical form for signal keys: lowercase, accents stripped, safe characters only. */
export function slug(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_ &.'-]/g, "")
    .trim()
    .slice(0, 60);
}
export type Tally = { up: number; down: number };
export type CrowdSignals = Record<string, number>;
export const MIN_PEOPLE = 5;
const PRIOR = 8;

/** Smoothed sentiment in [-1, 1]. */
export function sentiment(t: Tally) {
  const n = t.up + t.down;
  if (n < MIN_PEOPLE) return 0;
  return (t.up - t.down) / (n + PRIOR);
}

export function toSignals(tallies: Record<string, Tally>): CrowdSignals {
  const out: CrowdSignals = {};
  for (const [k, t] of Object.entries(tallies)) {
    const s = sentiment(t);
    if (s !== 0) out[k] = Math.round(s * 1000) / 1000;
  }
  return out;
}

/** Crowd score for one venue in [-1, 1]: the venue itself counts most, then type and category. */
export function crowdFor(
  place: { id: string; category: string; types: string[] },
  crowd: CrowdSignals,
) {
  const cat = crowd[`cat:${slug(place.category)}`] ?? 0;
  const types = place.types
    .slice(0, 2)
    .map((t) => crowd[`type:${slug(t)}`] ?? 0);
  const type = types.length
    ? Math.max(...types.map(Math.abs)) *
      Math.sign(types.reduce((a, b) => a + b, 0))
    : 0;
  const own = crowd[`place:${place.id}`] ?? 0;
  return Math.max(-1, Math.min(1, own * 0.6 + type * 0.25 + cat * 0.25));
}
