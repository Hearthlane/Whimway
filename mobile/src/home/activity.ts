import { DateTime } from "luxon";
import type { TasteProfile } from "@shared/profile";
import { endOf, startOf, whenLabel } from "@shared/today";
import type { PlanEntry } from "@/lib/store";

/**
 * The Activity tab: what needs the person's attention, worked out on the device from their
 * own plans, people and saved places. Nothing is sent anywhere to build it.
 */
export type ActivityItem = {
  id: string;
  kind: "soon" | "today" | "rate" | "person" | "place" | "welcome";
  title: string;
  body: string;
  at: string;
  /** Where tapping goes. */
  href: string | { pathname: string; params: Record<string, string> };
  action: string;
};

const ZONE = "America/Toronto";

export function activityFor(plans: Record<string, PlanEntry>, profile: TasteProfile, now = DateTime.now().setZone(ZONE)): ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const [id, e] of Object.entries(plans)) {
    const start = startOf(e);
    const end = endOf(e);
    const hours = start.diff(now, "hours").hours;
    if (end > now && hours <= 0)
      items.push({ id: `today-${id}`, kind: "today", title: "Happening now", body: e.meta.title, at: start.toISO()!, href: `/plan/${id}`, action: "Open" });
    else if (hours > 0 && hours <= 72)
      items.push({ id: `soon-${id}`, kind: "soon", title: whenLabel(e, now), body: `${e.meta.title} · ${e.meta.stops} stops`, at: start.toISO()!, href: `/plan/${id}`, action: "Open" });
    else if (end < now && end > now.minus({ days: 14 }) && !e.feedback && e.saved)
      items.push({ id: `rate-${id}`, kind: "rate", title: "How was it?", body: `Tell us about ${e.meta.title}. It makes your next plans better.`, at: end.toISO()!, href: `/plan/${id}`, action: "Rate" });
  }
  // People you haven't planned with lately: a nudge, at most two.
  const lastWith = (name: string) =>
    Object.values(plans)
      .filter((e) => e.spec.request.prompt.toLowerCase().includes(name.toLowerCase()))
      .map((e) => DateTime.fromISO(e.createdAt))
      .sort((a, b) => b.toMillis() - a.toMillis())[0];
  for (const p of profile.people.slice(0, 6)) {
    const last = lastWith(p.name);
    if (!last || now.diff(last, "days").days > 14)
      items.push({ id: `person-${p.id}`, kind: "person", title: `Plan something with ${p.name}?`, body: last ? `It's been ${Math.round(now.diff(last, "days").days)} days.` : `${p.name}'s favourites come first when you plan together.`, at: now.minus({ hours: 1 }).toISO()!, href: { pathname: "/guide", params: { person: p.id } }, action: "Plan" });
    if (items.filter((i) => i.kind === "person").length >= 2) break;
  }
  for (const f of profile.favourites.slice(0, 2))
    items.push({ id: `place-${f.id}`, kind: "place", title: `You saved ${f.name}`, body: "Build an outing around it in one tap.", at: now.minus({ hours: 2 }).toISO()!, href: { pathname: "/profile", params: { tab: "places" } }, action: "See" });
  if (!Object.keys(plans).length)
    items.push({ id: "welcome", kind: "welcome", title: "Welcome to Whimway", body: "Make your first plan: tell us the mood, or build it step by step.", at: now.toISO()!, href: "/create", action: "Start" });
  const rank = { today: 0, soon: 1, rate: 2, person: 3, place: 4, welcome: 5 };
  return items.sort((a, b) => rank[a.kind] - rank[b.kind] || a.at.localeCompare(b.at));
}
