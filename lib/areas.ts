import type { Location, PlanRequest, Point } from "./schema";

/**
 * Launch-beta planning areas (Greater Toronto). Centres are public neighbourhood
 * reference points, not user locations. Adding a city = adding entries here with
 * its timezone and currency; nothing else in the planner is city-specific.
 */
export type Area = {
  key: string;
  name: string;
  city: string;
  center: Point;
  /** Words people use for this area in free text. */
  aliases: string[];
  timezone: string;
  currency: string;
};

const toronto = {
  city: "Toronto",
  timezone: "America/Toronto",
  currency: "CAD",
};
export const areas: Area[] = [
  {
    key: "downtown",
    name: "Downtown Toronto",
    center: { lat: 43.651, lng: -79.3815 },
    aliases: ["downtown", "toronto", "the core", "eaton", "dundas square"],
    ...toronto,
  },
  {
    key: "queen-west",
    name: "Queen West & Ossington",
    center: { lat: 43.6465, lng: -79.4197 },
    aliases: [
      "queen west",
      "ossington",
      "trinity bellwoods",
      "west queen west",
    ],
    ...toronto,
  },
  {
    key: "kensington",
    name: "Kensington & Chinatown",
    center: { lat: 43.6545, lng: -79.4005 },
    aliases: ["kensington", "chinatown", "spadina"],
    ...toronto,
  },
  {
    key: "distillery",
    name: "Distillery & St. Lawrence",
    center: { lat: 43.649, lng: -79.3645 },
    aliases: [
      "distillery",
      "st lawrence",
      "st. lawrence",
      "old town",
      "harbourfront",
      "waterfront",
    ],
    ...toronto,
  },
  {
    key: "yorkville",
    name: "Yorkville & the Annex",
    center: { lat: 43.6705, lng: -79.3935 },
    aliases: ["yorkville", "annex", "bloor"],
    ...toronto,
  },
  {
    key: "leslieville",
    name: "Leslieville & Riverside",
    center: { lat: 43.662, lng: -79.34 },
    aliases: ["leslieville", "riverside", "east end", "danforth"],
    ...toronto,
  },
  {
    key: "north-york",
    name: "North York Centre",
    center: { lat: 43.768, lng: -79.413 },
    aliases: ["north york", "yonge and sheppard", "finch"],
    ...toronto,
  },
  {
    key: "scarborough",
    name: "Scarborough",
    center: { lat: 43.7731, lng: -79.2578 },
    aliases: ["scarborough", "scarb", "bluffs"],
    ...toronto,
  },
  {
    key: "vaughan",
    name: "Vaughan",
    city: "Vaughan",
    center: { lat: 43.794, lng: -79.527 },
    aliases: ["vaughan", "woodbridge", "maple", "concord", "vmc"],
    timezone: "America/Toronto",
    currency: "CAD",
  },
  {
    key: "richmond-hill",
    name: "Richmond Hill",
    city: "Richmond Hill",
    center: { lat: 43.8828, lng: -79.4403 },
    aliases: ["richmond hill", "rich hill", "oak ridges"],
    timezone: "America/Toronto",
    currency: "CAD",
  },
  {
    key: "markham",
    name: "Markham & Unionville",
    city: "Markham",
    center: { lat: 43.868, lng: -79.313 },
    aliases: ["markham", "unionville", "pacific mall"],
    timezone: "America/Toronto",
    currency: "CAD",
  },
];
export const defaultArea = areas[0];

export function areaByKey(key?: string) {
  return areas.find((a) => a.key === key);
}

/** Longest alias match wins, so "north york" beats "york". */
export function findArea(text: string) {
  const lower = ` ${text.toLowerCase()} `;
  let best: { area: Area; length: number } | undefined;
  for (const area of areas)
    for (const alias of area.aliases)
      if (
        new RegExp(`[^a-z]${alias.replace(/[.]/g, "\\.")}[^a-z]`).test(lower) &&
        alias.length > (best?.length ?? 0)
      )
        best = { area, length: alias.length };
  return best?.area;
}

export function toLocation(area: Area): Location {
  return {
    name: area.name,
    center: area.center,
    timezone: area.timezone,
    currency: area.currency,
  };
}

/** Sensible exploration radius by travel mode, in metres. */
export function defaultRadius(mode: PlanRequest["mode"]) {
  return mode === "WALK" ? 2000 : mode === "TRANSIT" ? 6000 : 12000;
}
