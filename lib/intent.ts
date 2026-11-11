import { DateTime } from "luxon";
import {
  areaByKey,
  defaultArea,
  defaultRadius,
  findArea,
  toLocation,
  type Area,
} from "./areas";
import type { TasteProfile } from "./profile";
import { PlanRequest, type Vibe, type interests } from "./schema";

/**
 * Deterministic natural-language → constraint interpreter.
 *
 * Runs instantly on device and server with zero AI cost. The LLM still reads the
 * full prompt when selecting venues; this layer only extracts hard, checkable
 * constraints (who, when, budget, transport, area) so they can be shown back as
 * editable chips — the user always sees and controls what was understood.
 */
type Interest = (typeof interests)[number];
export type Draft = {
  companions?: PlanRequest["companions"];
  participants?: number;
  vibes: Vibe[];
  interests: Interest[];
  date?: string;
  startTime?: string;
  duration?: number;
  budget?: { amount: number; basis: "person" | "total" };
  budgetLevel?: "low" | "high";
  mode?: PlanRequest["mode"];
  radius?: number;
  indoorOnly?: boolean;
  area?: Area;
  occasion?: "birthday" | "anniversary";
};

const numberWords: Record<string, number> = {
  a: 1,
  one: 1,
  two: 2,
  couple: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  few: 3,
};
const num = (s: string) => numberWords[s] ?? Number(s);
const NUM =
  "(\\d{1,2}|a|one|two|three|four|five|six|seven|eight|nine|ten|few|couple)";

const vibeWords: [Vibe, RegExp][] = [
  [
    "romantic",
    /\b(romantic|romance|date night|anniversary|intimate|cute date|valentine)(?![a-z])/,
  ],
  [
    "adventurous",
    /\b(adventur\w*|thrill\w*|exciting|daring|active|spontaneous)(?![a-z])/,
  ],
  ["cozy", /\b(cozy|cosy|rainy|snug|warm up|hygge)(?![a-z])/],
  ["cinematic", /\b(cinematic|movie|film|aesthetic|main character)(?![a-z])/],
  ["chill", /\b(chill|relax\w*|low[- ]key|lazy|calm|laid[- ]back)(?![a-z])/],
  [
    "lively",
    /\b(lively|party|buzzing|energetic|night out|dancing|turn up)(?![a-z])/,
  ],
  [
    "artsy",
    /\b(arts?|artsy|arty|museum|gallery|galleries|creative|culture)(?![a-z])/,
  ],
  ["foodie", /\b(foodie|food tour|tasting|eat our way)(?![a-z])/],
  [
    "outdoorsy",
    /\b(outdoor\w*|nature|hike|hiking|trail|waterfront|beach|picnic|sunset)(?![a-z])/,
  ],
  [
    "playful",
    /\b(games?|arcade|bowling|mini[- ]?golf|karaoke|escape room|playful|silly|axe throwing)(?![a-z])/,
  ],
];
const interestWords: [Interest, RegExp][] = [
  [
    "Food & drinks",
    /\b(dinner|lunch|brunch|breakfast|food|eat|caf[eé]s?|coffee|dessert|ice cream|drinks?|cocktails?|restaurant|bakery|bite)(?![a-z])/,
  ],
  ["Shopping", /\b(shop\w*|thrift\w*|market|boutique|vintage|mall)(?![a-z])/],
  [
    "Interactive fun",
    /\b(games?|arcade|bowling|mini[- ]?golf|karaoke|escape room|axe throwing|activity|activities|adventur\w*|playful)(?![a-z])/,
  ],
  [
    "Outdoors",
    /\b(outdoor\w*|park|nature|hike|hiking|trail|waterfront|beach|picnic|garden|sunset)(?![a-z])/,
  ],
  [
    "Arts & culture",
    /\b(arts?|artsy|museum|gallery|galleries|culture|theatre|theater|history|cinema|movie|film|cinematic)(?![a-z])/,
  ],
  ["Relaxation", /\b(relax\w*|spa|chill|cozy|cosy|calm|tea)(?![a-z])/],
  [
    "Nightlife",
    /\b(bar|bars|drinks|cocktails?|club|nightlife|late night|night out|live music|jazz|party)(?![a-z])/,
  ],
  ["Family", /\b(family|kids|children|parents)(?![a-z])/],
  [
    "Hidden gems",
    /\b(hidden gems?|off the beaten|underrated|local secrets?|unusual|unique|quirky)(?![a-z])/,
  ],
  ["Surprise me", /\b(surprise)(?![a-z])/],
];

function roundUp(dt: DateTime, minutes = 30): DateTime {
  const m = Math.ceil((dt.minute + dt.second / 60) / minutes) * minutes;
  return dt.startOf("hour").plus({ minutes: m });
}

function parseClock(text: string) {
  const m = text.match(
    /\b(?:at|around|by|from)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/,
  );
  if (m) {
    let h = Number(m[1]) % 12;
    if (m[3].startsWith("p")) h += 12;
    const min = Number(m[2] ?? 0);
    if (h < 24 && min < 60) return { h, min };
  }
  const h24 = text.match(/\b(?:at|around|from)\s+([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (h24) return { h: Number(h24[1]), min: Number(h24[2]) };
  return undefined;
}

export function interpret(input: string, now: DateTime): Draft {
  const text = ` ${input.toLowerCase().replace(/[’']/g, "'")} `;
  const draft: Draft = { vibes: [], interests: [] };

  // Who
  if (
    /\b(girlfriend|boyfriend|gf|bf|partner|wife|husband|fianc[eé]e?|spouse|date night|my date|anniversary|bae)\b/.test(
      text,
    )
  ) {
    draft.companions = "partner";
    draft.participants = 2;
  }
  const friends = text.match(
    new RegExp(
      `\\b${NUM}\\s+(?:of my\\s+)?(?:friends|buddies|pals|mates|roommates)`,
    ),
  );
  if (friends) {
    draft.companions = "friends";
    draft.participants = Math.min(20, num(friends[1]) + 1);
  } else if (
    /\b(friends|the boys|the girls|the gang|crew|squad|buddies|roommates)\b/.test(
      text,
    )
  ) {
    draft.companions = "friends";
    draft.participants ??= 4;
  }
  const group =
    text.match(
      new RegExp(
        `\\b(?:for|group of|party of)\\s+${NUM}(?:\\s+(?:people|of us|adults|persons))?\\b`,
      ),
    ) ?? text.match(new RegExp(`\\b${NUM}\\s+(?:of us|people|adults)\\b`));
  if (group && num(group[1]) >= 1)
    draft.participants = Math.min(20, num(group[1]));
  if (/\b(solo|by myself|alone|just me|me time|on my own)\b/.test(text)) {
    draft.companions = "solo";
    draft.participants = 1;
  }
  if (/\b(family|kids|my parents|my mom|my dad)\b/.test(text))
    draft.companions ??= "family";

  // Occasion
  if (/\bbirthday|bday\b/.test(text)) draft.occasion = "birthday";
  if (/\banniversary\b/.test(text)) draft.occasion = "anniversary";

  // Budget
  const money = text.match(
    /(?:\$\s?(\d{1,5})|\b(\d{1,5})\s?(?:dollars|bucks|cad)\b)([^.,;!?]{0,24})/,
  );
  if (money) {
    const amount = Number(money[1] ?? money[2]);
    const after = money[3] ?? "";
    const perPerson =
      /\b(each|per person|pp|a head|per head|apiece|\/person|\/pp|per)\b|\/\s?(person|pp|head)/.test(
        after,
      );
    const total =
      /\b(total|together|combined|for (?:both|us|all|the two)|all in|altogether)\b/.test(
        after,
      );
    const people = draft.participants ?? 2;
    draft.budget = {
      amount,
      // Couples usually think in totals; groups usually think per person.
      basis: perPerson
        ? "person"
        : total
          ? "total"
          : people <= 2
            ? "total"
            : "person",
    };
  } else if (
    /\b(cheap|broke|free|budget[- ]friendly|low[- ]cost|inexpensive|frugal)\b/.test(
      text,
    )
  ) {
    draft.budgetLevel = "low";
  } else if (
    /\b(splurge|fancy|treat (?:her|him|them|ourselves)|luxur\w*|bougie|upscale)\b/.test(
      text,
    )
  ) {
    draft.budgetLevel = "high";
  }

  // When
  const zone = now.zoneName ?? "America/Toronto";
  const local = now.setZone(zone);
  let day: DateTime | undefined;
  let partOfDay:
    "morning" | "brunch" | "afternoon" | "evening" | "late" | undefined;
  if (/\b(tonight|this evening)\b/.test(text)) {
    day = local;
    partOfDay = "evening";
  } else if (/\btoday\b|\bright now\b|\bnow\b/.test(text)) day = local;
  else if (/\btomorrow\b/.test(text)) day = local.plus({ days: 1 });
  const weekdays = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ];
  const wd = text.match(
    /\b(mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?\b/,
  );
  if (!day && wd) {
    const target =
      weekdays.findIndex((w) => w.startsWith(wd[1].slice(0, 3))) + 1;
    const next = /\bnext\s+\w*day\b/.test(text);
    let delta = (target - local.weekday + 7) % 7;
    if (next && delta === 0) delta = 7;
    day = local.plus({ days: delta });
  }
  if (!day && /\b(this weekend|the weekend|weekend)\b/.test(text)) {
    const delta = local.weekday >= 6 ? 0 : 6 - local.weekday;
    day = local.plus({ days: delta });
  }
  if (/\b(late night|after dark|midnight|late)\b/.test(text))
    partOfDay = "late";
  else if (/\b(night|evening|dinner|sunset)\b/.test(text))
    partOfDay ??= "evening";
  else if (/\bbrunch\b/.test(text)) partOfDay = "brunch";
  else if (/\b(afternoon|lunch)\b/.test(text)) partOfDay = "afternoon";
  else if (/\b(morning|breakfast|sunrise)\b/.test(text)) partOfDay = "morning";

  const clock = parseClock(text);
  const startHour = {
    morning: 10,
    brunch: 11,
    afternoon: 13,
    evening: 18,
    late: 21,
  };
  if (day || clock || partOfDay) {
    let start: DateTime = (day ?? local).startOf("day");
    if (clock) start = start.set({ hour: clock.h, minute: clock.min });
    else if (partOfDay)
      start = start.set({
        hour: startHour[partOfDay],
        minute: partOfDay === "evening" ? 30 : 0,
      });
    else start = roundUp(local.plus({ minutes: 45 }));
    // If that time has passed today, start soon instead (or roll to tomorrow when no day was said).
    if (start <= local.plus({ minutes: 20 })) {
      const soon = roundUp(local.plus({ minutes: 45 }));
      start = !day && !partOfDay && clock ? start.plus({ days: 1 }) : soon;
    }
    draft.date = start.toISODate()!;
    draft.startTime = start.toFormat("HH:mm");
    draft.duration =
      partOfDay === "late"
        ? 180
        : partOfDay === "evening"
          ? 240
          : partOfDay
            ? 240
            : undefined;
  }

  // How long
  const hours = text.match(
    new RegExp(`\\b${NUM}\\s*(?:-|to)?\\s*(?:\\d\\s*)?(?:hours?|hrs?)\\b`),
  );
  if (hours) draft.duration = Math.max(60, Math.min(720, num(hours[1]) * 60));
  else if (/\b(all day|full day|whole day|day trip)\b/.test(text))
    draft.duration = 480;
  else if (/\b(quick|short|an hour|little while)\b/.test(text))
    draft.duration = 120;

  // Getting around
  if (
    /\b(ttc|transit|subway|streetcar|go train|bus|uber|lyft|no car|without a car|don't have a car|dont have a car)\b/.test(
      text,
    )
  )
    draft.mode = "TRANSIT";
  else if (
    /\b(don't|dont|do not|not)\s+(?:want to\s+)?drive too far\b|\bshort drive\b/.test(
      text,
    )
  ) {
    draft.mode = "DRIVE";
    draft.radius = 8000;
  } else if (
    /\b(don't|dont|do not|not|no)\s+(?:want to\s+)?(?:drive|driving)\b/.test(
      text,
    )
  )
    draft.mode = "TRANSIT";
  else if (/\b(drive|driving|by car|road trip|we have a car)\b/.test(text))
    draft.mode = "DRIVE";
  else if (/\b(walk|walking|walkable|on foot|stroll)\b/.test(text))
    draft.mode = "WALK";
  if (
    /\b(nearby|close by|near me|around here|not too far|walking distance)\b/.test(
      text,
    )
  )
    draft.radius = Math.min(
      draft.radius ?? Infinity,
      draft.mode === "DRIVE" ? 8000 : 2000,
    );

  // Weather / setting
  if (/\b(rain\w*|indoors?|inside|cold|snow\w*|freezing|stormy)\b/.test(text))
    draft.indoorOnly = true;

  // Vibes and interests
  for (const [v, re] of vibeWords) if (re.test(text)) draft.vibes.push(v);
  draft.vibes = draft.vibes.slice(0, 4);
  for (const [i, re] of interestWords)
    if (re.test(text)) draft.interests.push(i);
  if (draft.indoorOnly)
    draft.interests = draft.interests.filter((i) => i !== "Outdoors");

  draft.area = findArea(text);
  return draft;
}

const budgetLevels = { low: 0.5, high: 2 };

/**
 * Merge the interpreted draft with the taste profile into a complete, validated
 * PlanRequest. Explicit words beat profile defaults; profile beats app defaults.
 */
export function buildRequest(
  prompt: string,
  draft: Draft,
  profile: Pick<
    TasteProfile,
    | "companions"
    | "vibes"
    | "interests"
    | "budget"
    | "mode"
    | "homeArea"
    | "dietary"
    | "accessibility"
    | "affinity"
    | "disliked"
  >,
  now: DateTime,
  overrides: { area?: Area; excludedPlaceIds?: string[] } = {},
): PlanRequest {
  const area =
    overrides.area ?? draft.area ?? areaByKey(profile.homeArea) ?? defaultArea;
  const local = now.setZone(area.timezone);
  const companions = draft.companions ?? profile.companions;
  const participants =
    draft.participants ??
    (companions === "solo"
      ? 1
      : companions === "friends"
        ? 4
        : companions === "family"
          ? 4
          : 2);
  const mode = draft.mode ?? profile.mode;
  let date = draft.date;
  let startTime = draft.startTime;
  if (!date || !startTime) {
    // No time given: this evening if there's room, otherwise tomorrow evening.
    let start: DateTime = local.startOf("day").set({ hour: 18, minute: 30 });
    if (start <= local.plus({ minutes: 30 }))
      start = roundUp(local.plus({ minutes: 45 }));
    if (start.hour >= 22 || start.hour < 8)
      start = local
        .plus({ days: 1 })
        .startOf("day")
        .set({ hour: 18, minute: 30 });
    date = start.toISODate()!;
    startTime = start.toFormat("HH:mm");
  }
  const perPersonDefault =
    profile.budget * (draft.budgetLevel ? budgetLevels[draft.budgetLevel] : 1);
  const budget = draft.budget
    ? draft.budget.basis === "total"
      ? Math.round((draft.budget.amount / participants) * 100) / 100
      : draft.budget.amount
    : Math.round(perPersonDefault);
  const interests = draft.interests.length
    ? draft.interests
    : profile.interests.length
      ? profile.interests
      : (["Surprise me"] as Interest[]);
  return PlanRequest.parse({
    location: toLocation(area),
    area: {
      center: area.center,
      radius: Math.min(20000, draft.radius ?? defaultRadius(mode)),
      locked: true,
    },
    prompt: [
      prompt.trim(),
      draft.occasion ? `Occasion: ${draft.occasion}.` : "",
    ]
      .filter(Boolean)
      .join(" ")
      .slice(0, 1500),
    interests: [...new Set(interests)].slice(0, 10),
    vibes: (draft.vibes.length ? draft.vibes : profile.vibes).slice(0, 4),
    companions,
    date,
    startTime,
    duration: draft.duration ?? 240,
    budget,
    budgetBasis: draft.budget?.basis ?? "person",
    hardBudget: false,
    participants,
    mode,
    indoorOnly: draft.indoorOnly ?? false,
    affinity: profile.affinity,
    excludedPlaceIds: [
      ...new Set([...(overrides.excludedPlaceIds ?? []), ...profile.disliked]),
    ].slice(0, 100),
    dietary: profile.dietary,
    accessibility: profile.accessibility,
  });
}

/** Human-readable chips describing what was understood, for the confirm row. */
export function describe(request: PlanRequest, now?: DateTime) {
  const start = DateTime.fromISO(`${request.date}T${request.startTime}`, {
    zone: request.location.timezone,
  });
  const today = (now ?? DateTime.now())
    .setZone(request.location.timezone)
    .startOf("day");
  const days = Math.round(start.startOf("day").diff(today, "days").days);
  const dayLabel =
    days === 0
      ? "Today"
      : days === 1
        ? "Tomorrow"
        : start.toFormat("ccc d LLL");
  const who = {
    partner: "With your partner",
    friends: `${request.participants} friends`,
    solo: "Just you",
    family: `Family of ${request.participants}`,
  }[request.companions ?? "partner"];
  const money = (n: number) => `$${Math.round(n)}`;
  const budget =
    request.budgetBasis === "total"
      ? `${money(request.budget * request.participants)} total · ${money(request.budget)}/person`
      : `${money(request.budget)}/person`;
  const travel = { WALK: "On foot", TRANSIT: "Transit", DRIVE: "Driving" }[
    request.mode
  ];
  return {
    who,
    when: `${dayLabel}, ${start.toFormat("h:mm a")}`,
    length: `${Math.round((request.duration / 60) * 10) / 10}h`,
    budget,
    travel: `${travel} · ${request.area.radius >= 1000 ? `${request.area.radius / 1000} km` : `${request.area.radius} m`}`,
    area: request.location.name,
    vibe: request.vibes.map((v) => v[0].toUpperCase() + v.slice(1)).join(" · "),
    indoor: request.indoorOnly ? "Indoors" : "",
  };
}
