// Guided planning: broad, familiar categories people choose from instead of typing.
// Each group matches provider place types, so it works on demo venues and on live data.
import type { CandidatePlace } from "./schema";

export type GuideGroup = {
  key: string;
  label: string;
  /** One short line under the label. */
  hint: string;
  /** Search phrase for live place search. */
  query: string;
  match: RegExp;
};

export const cuisines: GuideGroup[] = [
  {
    key: "asian",
    label: "Asian",
    hint: "Ramen, dumplings, Thai, Korean",
    query: "asian restaurant",
    match:
      /thai|chinese|japanese|sushi|ramen|korean|vietnamese|asian_restaurant|dim_sum|dumpling|noodle|izakaya/,
  },
  {
    key: "mexican",
    label: "Mexican",
    hint: "Tacos and sharing plates",
    query: "mexican restaurant",
    match: /mexican|taco|latin/,
  },
  {
    key: "italian",
    label: "Italian",
    hint: "Pizza and pasta",
    query: "italian restaurant",
    match: /italian|pizza|pasta/,
  },
  {
    key: "western",
    label: "Burgers & comfort",
    hint: "Burgers, diners, brunch",
    query: "burger restaurant",
    match:
      /american|burger|steak|barbecue|diner|breakfast|brunch|gastropub|comfort/,
  },
  {
    key: "indian",
    label: "Indian & Middle Eastern",
    hint: "Curries, grills, shawarma",
    query: "indian restaurant",
    match: /indian|middle_eastern|lebanese|mediterranean|persian|turkish/,
  },
  {
    key: "sweet",
    label: "Coffee & dessert",
    hint: "Something light and sweet",
    query: "dessert cafe",
    match: /cafe|coffee|bakery|dessert|ice_cream|patisserie/,
  },
];

export const activities: GuideGroup[] = [
  {
    key: "games",
    label: "Games",
    hint: "Arcades, bowling, board games",
    query: "arcade",
    match: /game|arcade|bowling|amusement_center|escape|karaoke/,
  },
  {
    key: "shows",
    label: "Movies & shows",
    hint: "Cinema, comedy, theatre",
    query: "movie theater",
    match: /movie|cinema|theater|theatre|comedy|performing/,
  },
  {
    key: "culture",
    label: "Art & museums",
    hint: "Galleries, aquarium, exhibits",
    query: "museum",
    match:
      /museum|gallery|aquarium|observatory|historical|cultural|castle|observation/,
  },
  {
    key: "outdoors",
    label: "Outdoors",
    hint: "Parks, waterfront, a walk",
    query: "park",
    match: /park|beach|hiking|garden|island|plaza/,
  },
  {
    key: "shopping",
    label: "Shopping",
    hint: "Markets and malls",
    query: "shopping",
    match: /shopping|market|mall/,
  },
  {
    key: "drinks",
    label: "Drinks",
    hint: "Cocktails, wine, breweries",
    query: "cocktail bar",
    match: /\bbar\b|brewery|wine_bar|cocktail|pub/,
  },
];

const text = (p: Pick<CandidatePlace, "category" | "types">) =>
  `${p.category} ${p.types.join(" ")}`.toLowerCase();

export function groupByKey(key: string) {
  return [...cuisines, ...activities].find((g) => g.key === key);
}
/** Cuisine groups match on what the place mainly is, so a bar that serves tacos is not "Mexican". */
export function inGroup(
  place: Pick<CandidatePlace, "category" | "types">,
  group: GuideGroup,
) {
  const isCuisine = cuisines.includes(group);
  const primary = `${place.category} ${place.types[0] ?? ""}`.toLowerCase();
  return group.match.test(isCuisine ? primary : text(place));
}

const EATERY =
  /restaurant|food_court|cafe|coffee|bakery|dessert|ice_cream|patisserie|brunch|food market/;
/** A place people go to mainly to eat or drink coffee. */
export function isEatery(place: Pick<CandidatePlace, "category" | "types">) {
  return EATERY.test(`${place.category} ${place.types[0] ?? ""}`.toLowerCase());
}

/**
 * Put the groups a person keeps choosing first. `liked` is any text describing places they
 * saved or rated well (categories, types). First-timers get the broad default order.
 */
export function orderByTaste(groups: GuideGroup[], liked: string[]) {
  const hits = (g: GuideGroup) =>
    liked.filter((l) => g.match.test(l.toLowerCase())).length;
  const scored = groups.map((g, i) => ({ g, i, n: hits(g) }));
  scored.sort((a, b) => b.n - a.n || a.i - b.i);
  return scored.map((s) => ({ ...s.g, usual: s.n > 0 }));
}
