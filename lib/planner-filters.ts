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
/**
 * Primarily outdoors: by provider type, or by what the place is called when the type is a
 * generic "tourist attraction" (a district, a lane, a square, the waterfront).
 */
export function isOutdoor(place: Pick<CandidatePlace, "types"> & { name?: string; category?: string }) {
  if (place.types.some((t) => OUTDOOR_TYPES.has(t))) return true;
  if (/museum|gallery|cinema|theater|aquarium|mall|restaurant|cafe|bowling|arcade|store/.test(place.types[0] ?? "")) return false;
  return /\b(park|garden|trail|alley|district|square|harbourfront|waterfront|beach|bluffs?|islands?|ravine|boardwalk|lakeshore)\b/i.test(
    `${place.name ?? ""} ${place.category ?? ""}`,
  );
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
/**
 * A place built around a bar even if it's also games or food ("arcade bar", "bocce golf bar",
 * "sports bar"): left out for families with kids and anyone not drinking.
 */
export function isBarLike(place: Pick<CandidatePlace, "types"> & { name?: string; category?: string }) {
  if (isAlcoholLed(place)) return true;
  return /\b(bar|pub|tavern|brewery|brewpub|taproom|lounge|beer hall|axe throwing)\b/i.test(
    `${place.category ?? ""} ${place.name ?? ""}`.replace(/\b(raw|salad|juice|snack|sushi|oyster|espresso|coffee|milk|tea|dessert|bar-b-q|barbecue)\s+bar\b/gi, ""),
  );
}

const NOT_AN_OUTING = new Set([
  "lodging",
  "hotel",
  "motel",
  "extended_stay_hotel",
  "hostel",
  "bed_and_breakfast",
  "guest_house",
  "inn",
  "resort_hotel",
  "parking",
  "parking_lot",
  "parking_garage",
  "travel_agency",
  "tour_agency",
  "neighborhood",
  "locality",
  "sublocality",
  "political",
  "real_estate_agency",
  "apartment_building",
  "apartment_complex",
  "condominium_complex",
  "housing_complex",
  "association_or_organization",
  "corporate_office",
  "car_rental",
  "gas_station",
  "transit_station",
  "subway_station",
  "train_station",
  "bus_station",
]);
/** Places that are never a stop on an outing (hotels, car parks, ticket agents, districts). */
export function notAnOuting(place: Pick<CandidatePlace, "types">) {
  const primary = place.types[0] ?? "";
  if (NOT_AN_OUTING.has(primary)) return true;
  if (/restaurant|cafe|bar|museum|gallery|attraction|amusement|bowling|cinema|theater|spa|^park$/.test(primary))
    return false;
  return (place.types.length > 0 && place.types.every((t) => NOT_AN_OUTING.has(t) || t === "point_of_interest" || t === "establishment"));
}
