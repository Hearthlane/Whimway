import { safeUrl } from "./geo";
import type { CandidatePlace, PlanRequest } from "./schema";

/**
 * Ways to book or get to a stop. Every option is an honest external hand-off: we link to
 * a search or the venue's own site and never claim availability, prices or a reservation.
 * `partner` marks links that can carry a referral code once a partnership exists — the
 * second revenue line after Plus (see docs/monetization.md).
 */
export type BookingOption = {
  kind: "reserve" | "tickets" | "website" | "ride" | "directions";
  label: string;
  hint: string;
  icon: "calendar" | "tag" | "external-link" | "navigation" | "truck";
  url: string;
  partner?: "opentable" | "uber";
};
const REF = "utm_source=whimway&utm_medium=app";
const kindOf = (place: Pick<CandidatePlace, "category" | "types">) => {
  const t = `${place.category} ${place.types.join(" ")}`.toLowerCase();
  if (/restaurant|brunch|wine_bar|cocktail_bar|tapas/.test(t)) return "dining";
  if (
    /museum|gallery|aquarium|theat|cinema|movie|amusement|observation|castle|zoo|tourist_attraction|performing/.test(
      t,
    )
  )
    return "ticketed";
  return "open";
};

export function bookingOptions(
  place: Pick<
    CandidatePlace,
    "id" | "name" | "category" | "types" | "point" | "website" | "mapsUrl"
  >,
  ctx: {
    date: string;
    time: string;
    people: number;
    mode: PlanRequest["mode"];
    demo: boolean;
    directionsUrl: string;
  },
): BookingOption[] {
  const options: BookingOption[] = [];
  const kind = kindOf(place);
  const website = safeUrl(place.website);
  if (kind === "dining")
    options.push({
      kind: "reserve",
      label: "Find a table",
      hint: `Search OpenTable for ${ctx.people} at ${ctx.time}. Availability isn’t checked here.`,
      icon: "calendar",
      partner: "opentable",
      url: `https://www.opentable.ca/s?term=${encodeURIComponent(place.name)}&covers=${ctx.people}&dateTime=${ctx.date}T${ctx.time}&${REF}`,
    });
  if (kind === "ticketed")
    options.push({
      kind: "tickets",
      label: "Tickets and admission",
      hint: website
        ? "Opens the venue’s own site."
        : "Searches for the venue’s official tickets.",
      icon: "tag",
      url:
        website ??
        `https://www.google.com/search?q=${encodeURIComponent(`${place.name} tickets official site`)}`,
    });
  if (website && kind !== "ticketed")
    options.push({
      kind: "website",
      label: "Venue website",
      hint: "Menus, hours and booking, straight from the venue.",
      icon: "external-link",
      url: website,
    });
  options.push({
    kind: "directions",
    label: ctx.demo ? "Find on Maps" : "Directions",
    hint: "Opens in Google Maps.",
    icon: "navigation",
    url: ctx.directionsUrl,
  });
  if (ctx.mode !== "WALK")
    options.push({
      kind: "ride",
      label: "Get a ride",
      hint: "Opens Uber with this stop as the drop-off.",
      icon: "truck",
      partner: "uber",
      url: `https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff[latitude]=${place.point.lat}&dropoff[longitude]=${place.point.lng}&dropoff[nickname]=${encodeURIComponent(place.name)}`,
    });
  return options;
}
