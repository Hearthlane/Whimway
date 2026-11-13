import type { CandidatePlace, Vibe } from "./schema";

const OUTDOOR_TYPES = new Set([
  "park",
  "hiking_area",
  "beach",
  "national_park",
  "state_park",
  "campground",
  "garden",
  "botanical_garden",
  "zoo",
  "amusement_park",
  "water_park",
  "marina",
  "dog_park",
  "playground",
  "plaza",
  "ski_resort",
  "picnic_ground",
]);
/** True only when provider types say the venue is primarily outdoors. */
export function isOutdoor(place: Pick<CandidatePlace, "types">) {
  return place.types.some((t) => OUTDOOR_TYPES.has(t));
}

/** Provider place types that typically suit each vibe. Used for ranking, never as a hard filter. */
export const vibeTypes: Record<Vibe, RegExp> = {
  romantic:
    /wine|bar|restaurant|park|observation|garden|dessert|art_gallery|cocktail|waterfront/,
  adventurous:
    /amusement|escape|climb|axe|hiking|kayak|bowling|arcade|tourist_attraction|go_kart/,
  cozy: /cafe|tea|book|bakery|wine|dessert/,
  cinematic: /cinema|movie|observation|art|tourist_attraction|landmark/,
  chill: /park|cafe|tea|spa|garden|book/,
  lively: /bar|night_club|market|live_music|karaoke|food_court/,
  artsy: /museum|gallery|art|theatre|book/,
  foodie: /restaurant|bakery|market|dessert|food/,
  outdoorsy: /park|hiking|beach|garden|trail|marina/,
  playful: /bowling|arcade|amusement|escape|karaoke|game|mini_golf/,
};
export function vibeFit(
  place: Pick<CandidatePlace, "types" | "category">,
  vibes: Vibe[],
) {
  const text = [place.category, ...place.types].join(" ").toLowerCase();
  return vibes.filter((v) => vibeTypes[v].test(text)).length;
}

const ALCOHOL_TYPES = new Set([
  "bar",
  "brewery",
  "wine_bar",
  "cocktail_bar",
  "pub",
  "night_club",
  "liquor_store",
  "winery",
  "distillery",
]);
/** True when a venue's primary purpose is alcohol (a restaurant that also has a bar is not). */
export function isAlcoholLed(place: Pick<CandidatePlace, "types">) {
  const primary = place.types[0] ?? "";
  if (/restaurant|cafe|bakery|amusement/.test(primary)) return false;
  return place.types.some((t) => ALCOHOL_TYPES.has(t));
}
