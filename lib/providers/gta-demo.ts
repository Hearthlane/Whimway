// Development-only demo catalogue for the Greater Toronto beta.
//
// Venue identities are well-known public places so the demo feels realistic, but
// coordinates are approximate and ALL hours, prices and ratings below are illustrative
// estimates — never live data. Plans built from this catalogue are flagged `demo: true`,
// are labelled throughout the UI, cannot be cloud-published, and are disabled in production.
import {
  CandidatePlace,
  type OpeningPeriod,
  type PlanRequest,
  type Selection,
} from "../schema";
import { distance } from "../geo";
import { hoursCheck } from "../hours";
import { localStart } from "../time";

type Row = [
  key: string,
  name: string,
  lat: number,
  lng: number,
  category: string,
  types: string[],
  price: [number, number] | null, // CAD per person; null = unknown
  hours: [number, number, number[]?] | "always" | "unknown", // open hour, close hour (may pass midnight), days (0=Sun)
];
const ALL = [0, 1, 2, 3, 4, 5, 6];
const rows: Row[] = [
  // Downtown & waterfront
  [
    "ripleys",
    "Ripley's Aquarium of Canada",
    43.6424,
    -79.386,
    "aquarium",
    ["aquarium", "tourist_attraction"],
    [40, 50],
    [9, 23],
  ],
  [
    "cn-tower",
    "CN Tower",
    43.6426,
    -79.3871,
    "observation deck",
    ["observation_deck", "tourist_attraction"],
    [45, 60],
    [9, 22],
  ],
  [
    "steam-whistle",
    "Steam Whistle Brewing",
    43.6416,
    -79.3854,
    "brewery",
    ["brewery", "bar"],
    [20, 32],
    [12, 22],
  ],
  [
    "tiff",
    "TIFF Lightbox",
    43.6465,
    -79.3903,
    "cinema",
    ["movie_theater", "art_gallery"],
    [16, 22],
    [12, 23],
  ],
  [
    "pai",
    "Pai Northern Thai Kitchen",
    43.6479,
    -79.3887,
    "thai restaurant",
    ["thai_restaurant", "restaurant"],
    [25, 40],
    [11, 22],
  ],
  [
    "bar-buca",
    "Bar Buca",
    43.6447,
    -79.3999,
    "italian restaurant",
    ["italian_restaurant", "restaurant", "bar"],
    [30, 55],
    [9, 23],
  ],
  [
    "graffiti-alley",
    "Graffiti Alley",
    43.648,
    -79.399,
    "street art",
    ["tourist_attraction", "art"],
    [0, 0],
    "always",
  ],
  [
    "dineen",
    "Dineen Coffee Co.",
    43.6515,
    -79.379,
    "café",
    ["cafe", "coffee_shop"],
    [6, 12],
    [7, 19],
  ],
  [
    "ago",
    "Art Gallery of Ontario",
    43.6536,
    -79.3925,
    "art gallery",
    ["art_gallery", "museum"],
    [25, 30],
    [10, 17, [2, 3, 4, 5, 6, 0]],
  ],
  [
    "allan-gardens",
    "Allan Gardens Conservatory",
    43.6617,
    -79.3747,
    "conservatory",
    ["tourist_attraction", "conservatory"],
    [0, 0],
    [10, 17],
  ],
  [
    "st-lawrence",
    "St. Lawrence Market",
    43.6487,
    -79.3716,
    "food market",
    ["market", "food"],
    [10, 25],
    [8, 17, [2, 3, 4, 5, 6]],
  ],
  [
    "sugar-beach",
    "Sugar Beach",
    43.6436,
    -79.3667,
    "waterfront park",
    ["park", "beach"],
    [0, 0],
    "always",
  ],
  [
    "island",
    "Toronto Island Park (via ferry)",
    43.6205,
    -79.3787,
    "island park",
    ["park", "tourist_attraction"],
    [9, 10],
    [8, 22],
  ],
  // Kensington, Queen West, Ossington, Annex
  [
    "kensington",
    "Kensington Market",
    43.6547,
    -79.4006,
    "market",
    ["market", "shopping", "tourist_attraction"],
    [0, 0],
    [10, 19],
  ],
  [
    "grey-gardens",
    "Grey Gardens",
    43.6545,
    -79.4012,
    "wine bar",
    ["wine_bar", "restaurant", "bar"],
    [45, 75],
    [17, 24],
  ],
  [
    "bar-raval",
    "Bar Raval",
    43.6556,
    -79.41,
    "cocktail bar",
    ["cocktail_bar", "bar", "tapas_restaurant"],
    [35, 55],
    [11, 2],
  ],
  [
    "libretto",
    "Pizzeria Libretto Ossington",
    43.6491,
    -79.4199,
    "pizza restaurant",
    ["pizza_restaurant", "restaurant"],
    [25, 40],
    [12, 22],
  ],
  [
    "bang-bang",
    "Bang Bang Ice Cream",
    43.6497,
    -79.4198,
    "dessert",
    ["ice_cream_shop", "dessert_shop"],
    [8, 12],
    [12, 23],
  ],
  [
    "track-field",
    "Track & Field Bar",
    43.6463,
    -79.4177,
    "games bar",
    ["bar", "game", "bowling"],
    [25, 40],
    [17, 2],
  ],
  [
    "trinity-bellwoods",
    "Trinity Bellwoods Park",
    43.6475,
    -79.4135,
    "park",
    ["park"],
    [0, 0],
    "always",
  ],
  [
    "nadege",
    "Nadège Patisserie",
    43.6466,
    -79.4115,
    "patisserie",
    ["bakery", "dessert_shop", "cafe"],
    [8, 15],
    [9, 19],
  ],
  [
    "snakes-lattes",
    "Snakes & Lattes Annex",
    43.6648,
    -79.4135,
    "board game café",
    ["cafe", "game", "bar"],
    [15, 30],
    [11, 24],
  ],
  [
    "rom",
    "Royal Ontario Museum",
    43.6677,
    -79.3948,
    "museum",
    ["museum", "tourist_attraction"],
    [26, 26],
    [10, 17],
  ],
  [
    "casa-loma",
    "Casa Loma",
    43.678,
    -79.4094,
    "historic castle",
    ["historical_landmark", "museum", "tourist_attraction"],
    [40, 45],
    [9, 17],
  ],
  // Distillery, east end
  [
    "distillery",
    "The Distillery District",
    43.6503,
    -79.3596,
    "historic district",
    ["historical_landmark", "tourist_attraction", "shopping"],
    [0, 0],
    [10, 22],
  ],
  [
    "balzacs",
    "Balzac's Coffee Distillery",
    43.6503,
    -79.3594,
    "café",
    ["cafe", "coffee_shop"],
    [6, 12],
    [7, 19],
  ],
  [
    "el-catrin",
    "El Catrin Destileria",
    43.6504,
    -79.3592,
    "mexican restaurant",
    ["mexican_restaurant", "restaurant", "bar"],
    [40, 70],
    [11, 23],
  ],
  [
    "riverdale",
    "Riverdale Park East (skyline view)",
    43.671,
    -79.353,
    "park",
    ["park"],
    [0, 0],
    "always",
  ],
  [
    "brick-works",
    "Evergreen Brick Works",
    43.6845,
    -79.3654,
    "park & market",
    ["park", "market"],
    [0, 0],
    [9, 17],
  ],
  [
    "rorschach",
    "Rorschach Brewing Co.",
    43.662,
    -79.3335,
    "brewery",
    ["brewery", "bar"],
    [20, 35],
    [12, 23],
  ],
  [
    "lady-marmalade",
    "Lady Marmalade",
    43.6633,
    -79.3395,
    "brunch",
    ["breakfast_restaurant", "restaurant"],
    [20, 30],
    [8, 15],
  ],
  // North York & Scarborough
  [
    "aga-khan",
    "Aga Khan Museum",
    43.7253,
    -79.332,
    "museum",
    ["museum", "art_gallery"],
    [20, 20],
    [10, 18, [2, 3, 4, 5, 6, 0]],
  ],
  [
    "botanical",
    "Toronto Botanical Garden",
    43.7339,
    -79.3584,
    "garden",
    ["garden", "park"],
    [0, 0],
    [8, 20],
  ],
  [
    "mel-lastman",
    "Mel Lastman Square",
    43.7676,
    -79.4141,
    "plaza",
    ["plaza", "park"],
    [0, 0],
    "always",
  ],
  [
    "bluffers",
    "Bluffer's Park & Scarborough Bluffs",
    43.7066,
    -79.234,
    "waterfront park",
    ["park", "beach", "hiking_area"],
    [0, 0],
    "always",
  ],
  // Markham & Unionville
  [
    "pacific-mall",
    "Pacific Mall",
    43.8255,
    -79.3065,
    "asian mall & food court",
    ["shopping_mall", "food_court", "market"],
    [10, 30],
    [11, 21],
  ],
  [
    "unionville",
    "Main Street Unionville",
    43.8685,
    -79.3115,
    "historic main street",
    ["historical_landmark", "tourist_attraction", "shopping"],
    [0, 0],
    [10, 21],
  ],
  [
    "toogood",
    "Toogood Pond Park",
    43.8724,
    -79.3175,
    "park",
    ["park"],
    [0, 0],
    "always",
  ],
  [
    "milne",
    "Milne Dam Conservation Park",
    43.879,
    -79.269,
    "conservation park",
    ["park", "hiking_area"],
    [0, 0],
    [8, 20],
  ],
  // Richmond Hill
  [
    "mill-pond",
    "Mill Pond Park",
    43.8808,
    -79.4466,
    "park",
    ["park"],
    [0, 0],
    "always",
  ],
  [
    "rh-theatre",
    "Richmond Hill Centre for the Performing Arts",
    43.8786,
    -79.4383,
    "theatre",
    ["performing_arts_theater"],
    null,
    "unknown",
  ],
  [
    "lake-wilcox",
    "Lake Wilcox Park",
    43.948,
    -79.436,
    "lakeside park",
    ["park", "beach"],
    [0, 0],
    "always",
  ],
  [
    "hillcrest",
    "Hillcrest Mall",
    43.853,
    -79.431,
    "shopping mall",
    ["shopping_mall", "food_court"],
    [0, 25],
    [10, 21],
  ],
  // Vaughan
  [
    "dave-busters",
    "Dave & Buster's Vaughan Mills",
    43.8247,
    -79.5395,
    "arcade & sports bar",
    ["amusement_center", "bar", "game", "restaurant"],
    [20, 45],
    [11, 24],
  ],
  [
    "reptilia",
    "Reptilia Zoo Vaughan",
    43.8227,
    -79.525,
    "indoor reptile zoo",
    ["tourist_attraction", "reptile_centre"],
    [25, 30],
    [10, 18],
  ],
  [
    "vaughan-mills",
    "Vaughan Mills",
    43.8253,
    -79.5389,
    "shopping mall",
    ["shopping_mall", "food_court"],
    [0, 30],
    [10, 21],
  ],
  [
    "legoland",
    "LEGOLAND Discovery Centre Toronto",
    43.8258,
    -79.5384,
    "indoor attraction",
    ["amusement_center", "tourist_attraction", "game"],
    [30, 35],
    [10, 19],
  ],
  [
    "wonderland",
    "Canada's Wonderland",
    43.843,
    -79.539,
    "theme park (seasonal)",
    ["amusement_park", "tourist_attraction"],
    [50, 80],
    "unknown",
  ],
  [
    "kortright",
    "Kortright Centre for Conservation",
    43.8312,
    -79.5916,
    "nature centre",
    ["park", "hiking_area"],
    [0, 10],
    [9, 16],
  ],
];

function periods(h: Row[7]): OpeningPeriod[] {
  if (h === "always") return [{ open: { day: 0, hour: 0, minute: 0 } }];
  if (h === "unknown") return [];
  const [open, close, days = ALL] = h;
  return days.map((day) => ({
    open: { day, hour: open, minute: 0 },
    close:
      close >= 24 || close <= open
        ? { day: (day + 1) % 7, hour: close % 24, minute: 0 }
        : { day, hour: close, minute: 0 },
  }));
}

export const gtaCatalog: CandidatePlace[] = rows.map(
  ([key, name, lat, lng, category, types, price, hours]) =>
    CandidatePlace.parse({
      id: `gta-${key}`,
      name,
      point: { lat, lng },
      address: "Demo data · approximate location",
      category,
      types,
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} Ontario`)}`,
      rating: 4.4,
      reviews: 800,
      photos: [],
      price: price
        ? {
            low: price[0],
            high: price[1],
            currency: "CAD",
            source: price[0] === 0 ? "free-browse" : "provider-range",
            confidence: "category-estimate",
            optional: price[0] === 0,
          }
        : {
            low: null,
            high: null,
            currency: "CAD",
            source: "unknown",
            confidence: "unknown",
            optional: false,
          },
      hours:
        hours === "unknown"
          ? []
          : [
              hours === "always"
                ? "Open access (demo estimate)"
                : `Demo estimate: ${hours[0]}:00–${hours[1] % 24}:00`,
            ],
      periods: periods(hours),
      hoursSource: hours === "unknown" ? "unknown" : "typical",
      timezone: "America/Toronto",
      wheelchairAccessible: true,
      businessStatus: "OPERATIONAL",
    }),
);

/** The GTA demo catalogue serves any non-legacy request whose centre is in the GTA. */
export function inGta(req: Pick<PlanRequest, "location">) {
  const { lat, lng } = req.location.center;
  return (
    req.location.placeId !== "fixture-toronto" &&
    lat > 43.4 &&
    lat < 44.2 &&
    lng > -80 &&
    lng < -78.9
  );
}

// ---------- Demo selection: a transparent heuristic stand-in for the LLM ----------
const vibeTypes: Record<string, RegExp> = {
  romantic:
    /wine|cocktail|observation|dessert|patisserie|aquarium|island|skyline|castle|conservatory|italian/,
  adventurous:
    /game|amusement|island|bluffs|hiking|aquarium|observation|street art|bowling/,
  cozy: /cafe|café|bakery|patisserie|wine|board game|dessert/,
  cinematic: /cinema|observation|castle|skyline|street art|aquarium|historic/,
  chill: /park|cafe|café|garden|conservatory|brewery/,
  lively: /bar|market|brewery|food_court|game/,
  artsy: /gallery|museum|art|theatre|cinema|historic/,
  foodie: /restaurant|market|bakery|dessert|patisserie|food/,
  outdoorsy: /park|beach|hiking|garden|island/,
  playful: /game|bowling|amusement|board game|arcade/,
};
// A meal is a venue whose primary purpose is eating (not a mall that happens to have a food court).
const isMeal = (p: CandidatePlace) =>
  /restaurant|brunch|food court/.test(p.category) ||
  /restaurant|food_court/.test(p.types[0] ?? "");
const isSweetOrDrink = (p: CandidatePlace) =>
  /dessert|ice_cream|bar|brewery|wine|cocktail|cafe|bakery/.test(
    p.types.join(" "),
  );
const text = (p: CandidatePlace) =>
  `${p.category} ${p.types.join(" ")} ${p.name}`.toLowerCase();

function relevance(
  p: CandidatePlace,
  req: PlanRequest,
  action = "",
  near?: { lat: number; lng: number },
) {
  const t = text(p);
  let s = 0;
  for (const v of req.vibes) if (vibeTypes[v]?.test(t)) s += 2;
  const a = action.toLowerCase();
  for (const [v, re] of Object.entries(vibeTypes))
    if (a.includes(v) && re.test(t)) s += 3;
  if (/cheaper|lower-priced|free/.test(a))
    s += (p.price.high ?? 99) === 0 ? 3 : -(p.price.high ?? 99) / 20;
  const want =
    a.match(/matching: (.+?)\./)?.[1] ??
    a.match(/ideally (.+?)\./)?.[1] ??
    a.match(/"(.+?)"/)?.[1];
  if (want)
    for (const w of want.split(/\W+/).filter((w) => w.length > 3))
      if (t.includes(w.replace(/s$/, ""))) s += 3;
  for (const [k, v] of Object.entries(req.affinity ?? {}))
    if (t.includes(k)) s += v;
  if (
    req.interests.includes("Food & drinks") &&
    (isMeal(p) || isSweetOrDrink(p))
  )
    s += 1;
  if (req.interests.includes("Arts & culture") && vibeTypes.artsy.test(t))
    s += 1;
  if (req.interests.includes("Outdoors") && vibeTypes.outdoorsy.test(t)) s += 1;
  if (req.interests.includes("Interactive fun") && vibeTypes.playful.test(t))
    s += 1;
  if (req.interests.includes("Nightlife") && /bar|brewery|cocktail/.test(t))
    s += 1;
  // Prefer places close to the centre of the chosen area (or to kept stops on "less walking").
  s -= distance(p.point, near ?? req.area.center) / (near ? 500 : 4000);
  return s;
}

const titles: Record<string, string[]> = {
  romantic: [
    "Skyline & Slow Dinners",
    "Just the Two of Us",
    "Candlelight Detour",
  ],
  adventurous: [
    "Small Thrills, Big Night",
    "Say Yes to Everything",
    "Off the Usual Path",
  ],
  cozy: ["Warm Lights, Soft Plans", "Sweaters & Sweet Things", "The Cozy Loop"],
  cinematic: [
    "Main Character Evening",
    "Golden Hour Cut",
    "Scenes From the City",
  ],
  chill: ["Easy Does It", "Slow Lane Saturday", "No Rush Ramble"],
  lively: ["Loud, Bright & Ours", "Turn It Up", "The Good Kind of Busy"],
  artsy: ["Gallery Hours", "Colour Outside the Lines", "Muse Mode"],
  foodie: ["Eat Our Way Across Town", "Bite by Bite", "The Tasting Route"],
  outdoorsy: ["Fresh Air Detour", "Trails & Treats", "Out and About"],
  playful: ["Game Night, Upgraded", "Play Hooky", "Winner Buys Dessert"],
};

export function demoSelect(
  req: PlanRequest,
  candidates: CandidatePlace[],
  locked: { placeId: string; minutes: number; reason: string }[],
  action?: string,
  previousStops?: { placeId: string }[],
  crowd: Record<string, number> = {},
): Selection {
  const lockedIds = new Set(locked.map((l) => l.placeId));
  const previous = new Set((previousStops ?? []).map((s) => s.placeId));
  const anchors = candidates.filter((p) => lockedIds.has(p.id));
  const near =
    /very close/.test(action ?? "") && anchors.length
      ? {
          lat: anchors.reduce((n, p) => n + p.point.lat, 0) / anchors.length,
          lng: anchors.reduce((n, p) => n + p.point.lng, 0) / anchors.length,
        }
      : undefined;
  const pool = candidates
    .filter((p) => !lockedIds.has(p.id) && !(action && previous.has(p.id)))
    .sort(
      (a, b) =>
        relevance(b, req, action, near) +
        (crowd[b.id] ?? 0) * 2 -
        relevance(a, req, action, near) -
        (crowd[a.id] ?? 0) * 2,
    );
  const evening = Number(req.startTime.slice(0, 2)) >= 16;
  const target = action?.startsWith("Add")
    ? locked.length + 1
    : previousStops?.length
      ? Math.max(previousStops.length, locked.length + 1)
      : req.duration >= 360
        ? 4
        : 3;
  const chosen: CandidatePlace[] = [];
  const lockedPlaces = candidates.filter((p) => lockedIds.has(p.id));
  let meals = lockedPlaces.filter(isMeal).length;
  // Stay within the per-person budget across the whole outing (published upper range).
  // Free places always fit; unknown prices count as the whole budget.
  let spent = lockedPlaces.reduce((n, p) => n + (p.price.high ?? 0), 0);
  // Free-to-browse places (optional spend) cost their minimum; unknown prices cost the whole budget.
  const cost = (p: CandidatePlace) =>
    p.price.optional ? (p.price.low ?? 0) : (p.price.high ?? req.budget);
  // Evening outings of 3h+ reserve budget for one proper meal before anything else.
  const wantsMeal =
    req.duration >= 180 &&
    meals === 0 &&
    !action &&
    (Number(req.startTime.slice(0, 2)) >= 16 ||
      req.interests.includes("Food & drinks"));
  const meal = wantsMeal
    ? pool.find((p) => isMeal(p) && spent + cost(p) <= req.budget * 1.1)
    : undefined;
  if (meal) {
    chosen.push(meal);
    meals++;
    spent += cost(meal);
  }
  for (const p of pool) {
    if (chosen.length + locked.length >= target) break;
    if (chosen.includes(p)) continue;
    if (
      cost(p) > 0 &&
      spent + cost(p) > req.budget * 1.1 &&
      chosen.length + locked.length >= 1
    )
      continue;
    if (isMeal(p) && meals >= 1) continue; // one proper meal per outing
    if (chosen.some((c) => c.category === p.category)) continue;
    if (isMeal(p)) meals++;
    spent += cost(p);
    chosen.push(p);
  }
  // Natural arc: activity → meal → dessert/drinks.
  // Daytime: activity → meal → treat. Evening: dinner first, then activity, then drinks/dessert.
  const rank = (p: CandidatePlace) =>
    evening
      ? isMeal(p)
        ? 0
        : isSweetOrDrink(p)
          ? 2
          : 1
      : isMeal(p)
        ? 1
        : isSweetOrDrink(p)
          ? 2
          : 0;
  const fresh = chosen.sort((a, b) => rank(a) - rank(b));
  const vibe = req.vibes[0] ?? "chill";
  const options = titles[vibe] ?? titles.chill;
  const title =
    options[(req.date.charCodeAt(9) + req.participants) % options.length];
  const who = {
    partner: "the two of you",
    friends: "your crew",
    solo: "you",
    family: "the family",
  }[req.companions ?? "partner"];
  const reason = (p: CandidatePlace) => {
    const fit = req.vibes.find((v) => vibeTypes[v]?.test(text(p)));
    if (isMeal(p))
      return `A proper sit-down ${p.category} to anchor the night${fit ? ` — fits the ${fit} mood` : ""}.`;
    if (isSweetOrDrink(p))
      return `An easy ${p.category} stop to linger and talk${fit ? `; leans ${fit}` : ""}.`;
    return `${p.category[0].toUpperCase()}${p.category.slice(1)} that gives ${who} something to do together${fit ? `, and it's properly ${fit}` : ""}.`;
  };
  const minutes = (p: CandidatePlace) =>
    isMeal(p)
      ? 75
      : /museum|gallery|aquarium|castle|amusement|island/.test(text(p))
        ? 90
        : 50;
  // Keep previous order for kept stops; new stops fill the original gaps, then any remainder.
  const fresh2 = [...fresh];
  const ordered: Selection["stops"] = previousStops?.length
    ? [
        ...previousStops.flatMap((s) => {
          const l = locked.find((x) => x.placeId === s.placeId);
          if (l) return [l];
          const n = fresh2.shift();
          return n
            ? [{ placeId: n.id, minutes: minutes(n), reason: reason(n) }]
            : [];
        }),
        ...fresh2.map((p) => ({
          placeId: p.id,
          minutes: minutes(p),
          reason: reason(p),
        })),
      ]
    : fresh.map((p) => ({
        placeId: p.id,
        minutes: minutes(p),
        reason: reason(p),
      }));
  // Time-aware pass: swap any new stop that would be closed at its slot for one that is open.
  let cursor = 0;
  let start: ReturnType<typeof localStart> | undefined;
  try {
    start = localStart(req.date, req.startTime, req.location.timezone);
  } catch {}
  const used = new Set(ordered.map((s) => s.placeId));
  const byId = new Map(candidates.map((p) => [p.id, p]));
  const open = (p: CandidatePlace, at: number, mins: number) =>
    !start ||
    !hoursCheck(
      p,
      start.plus({ minutes: at }),
      start.plus({ minutes: at + mins }),
    ).closed;
  for (let i = 0; i < ordered.length; i++) {
    const s = ordered[i];
    const place = byId.get(s.placeId)!;
    if (!lockedIds.has(s.placeId) && !open(place, cursor, s.minutes)) {
      const alt = pool.find(
        (p) =>
          !used.has(p.id) &&
          cost(p) <= cost(place) &&
          open(p, cursor, minutes(p)) &&
          !(isMeal(p) && meals > 1),
      );
      if (alt) {
        used.add(alt.id);
        ordered[i] = {
          placeId: alt.id,
          minutes: minutes(alt),
          reason: reason(alt),
        };
      }
    }
    cursor += ordered[i].minutes + 15;
  }
  return {
    title,
    summary: `Demo plan for ${who}${req.vibes.length ? `, leaning ${req.vibes.join(" + ")}` : ""}. Real places; hours, prices and travel are demo estimates.`,
    stops: ordered.slice(0, 8),
  };
}
