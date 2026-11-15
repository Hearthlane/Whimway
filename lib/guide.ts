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
    key: "japanese",
    label: "Japanese",
    hint: "Ramen, sushi, izakaya",
    query: "japanese restaurant",
    match: /japanese|sushi|ramen|izakaya/,
  },
  {
    key: "chinese",
    label: "Chinese",
    hint: "Dumplings, dim sum, noodles",
    query: "chinese restaurant",
    match: /chinese|dim_sum|dumpling|cantonese|szechuan/,
  },
  {
    key: "thai",
    label: "Thai & Korean",
    hint: "Curries, noodles, stone-pot stews",
    query: "thai restaurant",
    match: /thai|korean|vietnamese/,
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
    hint: "Burgers, diners, big plates",
    query: "burger restaurant",
    match: /american|burger|steak|barbecue|diner|gastropub|comfort/,
  },
  {
    key: "indian",
    label: "Indian & Middle Eastern",
    hint: "Curries, grills, shawarma",
    query: "indian restaurant",
    match:
      /indian|middle_eastern|middle eastern|lebanese|mediterranean|persian|turkish/,
  },
  {
    key: "brunch",
    label: "Brunch",
    hint: "Eggs, pancakes, all-day breakfast",
    query: "brunch",
    match: /brunch|breakfast|diner/,
  },
  {
    key: "sweet",
    label: "Coffee & dessert",
    hint: "Something light and sweet",
    query: "dessert cafe",
    match: /cafe|café|coffee|bakery|dessert|ice_cream|patisserie/,
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
    hint: "Galleries and exhibits",
    query: "museum",
    match: /museum|gallery|cultural|art\b/,
  },
  {
    key: "sights",
    label: "Sights & views",
    hint: "Landmarks, lookouts, old streets",
    query: "tourist attraction",
    match:
      /observation|observatory|historical|castle|landmark|street art|plaza/,
  },
  {
    key: "attractions",
    label: "Attractions",
    hint: "Aquarium, zoo, theme parks",
    query: "aquarium",
    match: /aquarium|zoo|reptile|amusement_park|theme park|indoor attraction/,
  },
  {
    key: "outdoors",
    label: "Outdoors",
    hint: "Parks, waterfront, a walk",
    query: "park",
    match: /park\b|beach|hiking|garden|island|conservatory/,
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

// Everyday words people type, mapped to the place types that serve them.
const synonyms: [RegExp, string][] = [
  [/taco|burrito|nacho|quesadilla/, "mexican"],
  [/sushi|ramen|udon|izakaya|tempura/, "japanese|ramen|sushi"],
  [/dumpling|dim sum|noodle|congee|wonton/, "chinese|dim_sum|ramen"],
  [/pho|pad thai|bibimbap|kimchi|curry/, "thai|korean|vietnamese|indian"],
  [/pizza|pasta|spaghetti|lasagna/, "italian|pizza"],
  [
    /burger|fries|steak|wings|bbq|ribs/,
    "hamburger|american|steak|barbecue|diner",
  ],
  [
    /shawarma|kebab|falafel|hummus|naan|biryani/,
    "middle_eastern|lebanese|indian",
  ],
  [/pancake|waffle|eggs|breakfast|brunch/, "breakfast|brunch|diner"],
  [
    /ice cream|gelato|cake|pastry|croissant|donut|bubble tea|boba/,
    "ice_cream|dessert|bakery|patisserie",
  ],
  [/coffee|latte|espresso|tea/, "cafe|coffee"],
  [/beer|pint|ipa/, "brewery|\\bbar\\b"],
  [/wine|cocktail|martini|drinks/, "wine|cocktail|\\bbar\\b"],
  [/movie|film|cinema/, "movie|cinema"],
  [
    /comedy|improv|stand-?up|play|theatre|theater|show/,
    "comedy|theater|performing",
  ],
  [
    /bowling|arcade|board game|pool|darts|karaoke|laser/,
    "game|bowling|amusement_center|karaoke",
  ],
  [/art|gallery|museum|exhibit/, "museum|gallery"],
  [/hike|walk|trail|picnic|beach|nature/, "park|hiking|beach|garden"],
  [/fish|shark|animals|zoo|aquarium/, "aquarium|zoo|reptile"],
  [/view|skyline|sunset|lookout/, "observation|observatory|beach|island"],
  [/shop|thrift|vintage|mall|market/, "shopping|market|mall"],
];
const escape = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A one-off group for something the person typed ("sushi", "somewhere with a view"). */
export function customGroup(input: string): GuideGroup {
  const said = input.toLowerCase().slice(0, 80).trim();
  const words = said
    .split(/[^a-z0-9']+/)
    .filter(
      (w) =>
        w.length > 2 &&
        !/^(the|and|for|with|some|place|places|food|near|good|best|somewhere|something)$/.test(
          w,
        ),
    );
  const parts = [
    ...words.map(escape),
    ...synonyms.filter(([re]) => re.test(said)).map(([, types]) => types),
  ];
  return {
    key: "custom",
    label: input.trim().slice(0, 40),
    hint: "",
    query: said,
    match: new RegExp(parts.length ? parts.join("|") : "$^"),
  };
}

const text = (p: Pick<CandidatePlace, "category" | "types">) =>
  `${p.category} ${p.types.join(" ")}`.toLowerCase();

export function groupByKey(key: string) {
  return [...cuisines, ...activities].find((g) => g.key === key);
}
/** Cuisine groups match on what the place mainly is, so a bar that serves tacos is not "Mexican". */
export function inGroup(
  place: Pick<CandidatePlace, "category" | "types"> & { name?: string },
  group: GuideGroup,
) {
  if (group.key === "custom")
    return group.match.test(`${place.name ?? ""} ${text(place)}`.toLowerCase());
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

// What someone's own words already settle, so the guided questions can skip it.
const said: Record<string, RegExp> = {
  japanese: /japanese|sushi|ramen|izakaya|udon/,
  chinese: /chinese|dumpling|dim sum|congee|wonton/,
  thai: /\bthai\b|korean|\bpho\b|vietnamese|bibimbap/,
  mexican: /mexican|tacos?\b|burrito/,
  italian: /italian|pizza|pasta/,
  western: /burgers?\b|steak|wings|diner|bbq|barbecue/,
  indian: /indian|curry|shawarma|middle eastern|kebab|falafel/,
  brunch: /brunch|breakfast|pancakes?/,
  sweet:
    /dessert|coffee|ice cream|caf[eé]\b|bubble tea|boba|pastry|something sweet/,
  games: /arcade|bowling|board games?|karaoke|laser tag|escape room|mini golf/,
  shows: /movie|cinema|film\b|comedy|theatre|theater|improv|a show\b/,
  culture: /museum|gallery|exhibit/,
  sights: /\bviews?\b|sightseeing|landmark|skyline|lookout/,
  attractions: /aquarium|\bzoo\b|theme park|wonderland/,
  outdoors: /\bparks?\b|\bwalk\b|hike|picnic|beach|outdoors?\b|waterfront/,
  shopping: /shopping|\bmall\b|thrift|vintage|market/,
  drinks:
    /\bdrinks?\b|cocktails?|\bbars?\b|\bbeers?\b|\bwine\b|brewery|\bpub\b/,
};
export type Stated = {
  food?: "meal" | "light" | "none";
  cuisine?: string;
  fun?: "yes";
  kind?: string;
};
/**
 * Read food and activity choices out of free text. Only what is clearly stated counts:
 * anything else stays unanswered so the app asks instead of guessing.
 */
export function readStated(input: string): Stated {
  const t = input.toLowerCase();
  const out: Stated = {};
  if (
    /already ate|already eaten|we(?:'|’)ve eaten|i(?:'|’)ve eaten|no food|not hungry|after dinner|skip (?:the )?food|without food/.test(
      t,
    )
  )
    out.food = "none";
  else {
    const cuisine = cuisines.find((g) => said[g.key]?.test(t));
    if (cuisine) {
      out.cuisine = cuisine.key;
      out.food = cuisine.key === "sweet" ? "light" : "meal";
    } else if (
      /dinner|lunch|\beat\b|eating|hungry|restaurant|\bmeal\b|good food|\bfood\b|bite to eat/.test(
        t,
      )
    )
      out.food = "meal";
  }
  const kind = activities.find((g) => said[g.key]?.test(t));
  if (kind) {
    out.fun = "yes";
    out.kind = kind.key;
  }
  return out;
}
