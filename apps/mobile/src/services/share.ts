import { Share } from "react-native";
import { DateTime } from "luxon";
import { toSpec, type Itinerary } from "../../../../lib/schema";
import { api, getApiBaseUrl } from "./api";

export function planShareText(plan: Itinerary): string {
  const date = DateTime.fromISO(plan.request.date, {
    zone: plan.request.location.timezone,
  }).toLocaleString(DateTime.DATE_MED);
  const money = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: plan.cost.currency,
    maximumFractionDigits: 0,
  });
  return [
    `${plan.title}${plan.demo ? " (demo itinerary)" : ""}`,
    `${date} · ${plan.request.location.name}`,
    `Estimated spending: ${money.format(plan.cost.low)}–${money.format(plan.cost.high)} per person${plan.cost.unknown ? "; some prices unknown" : ""}.`,
    "Venue details and opening hours can change; check before going.",
    ...plan.stops.map(
      (stop, i) =>
        `${i + 1}. ${stop.place.name} · ${DateTime.fromISO(stop.arrival, { zone: plan.request.location.timezone }).toFormat("h:mm a")} · ${stop.minutes} min${stop.place.mapsUrl && !plan.demo ? `\n${stop.place.mapsUrl}` : ""}`,
    ),
    "Planned with Whimway. This is a text itinerary, not a live shared plan.",
  ].join("\n\n");
}
export async function sharePlan(plan: Itinerary): Promise<void> {
  await Share.share({ title: plan.title, message: planShareText(plan) });
}
export async function shareCloudPlan(plan: Itinerary): Promise<string> {
  if (plan.demo)
    throw new Error(
      "Demo itineraries can be shared as text, but cannot be published to the cloud.",
    );
  await api("plans", toSpec(plan));
  const { shareId } = await api<{ shareId: string }>("share", { id: plan.id });
  const url = `${getApiBaseUrl()}/s/${shareId}`;
  await Share.share({
    title: plan.title,
    message: `${plan.title}\n${url}`,
    url,
  });
  return url;
}
