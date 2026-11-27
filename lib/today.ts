import { DateTime } from "luxon";

const ZONE = "America/Toronto";

/** One stop of a saved plan, as kept on the device. */
export type BriefStop = {
  placeId: string;
  name: string;
  kind: string;
  at: string;
  until: string;
  mapsUrl: string;
};
/** The parts of a saved plan the home screen needs. */
export type PlanSummary = {
  meta: {
    title: string;
    date: string;
    startTime: string;
    stops: number;
    brief?: BriefStop[];
  };
};

const at = (iso: string) => DateTime.fromISO(iso).setZone(ZONE);

export function startOf(e: PlanSummary) {
  return e.meta.brief?.[0]
    ? at(e.meta.brief[0].at)
    : DateTime.fromISO(`${e.meta.date}T${e.meta.startTime}`, { zone: ZONE });
}
/** When the last stop ends; plans without stop times are assumed to last four hours. */
export function endOf(e: PlanSummary) {
  const last = e.meta.brief?.[e.meta.brief.length - 1];
  return last ? at(last.until) : startOf(e).plus({ hours: 4 });
}

/** "Today, 6:30 PM", "Tomorrow, …", a weekday within the week, else a date. */
export function whenLabel(e: PlanSummary, now = DateTime.now().setZone(ZONE)) {
  const t = startOf(e);
  const days = Math.round(
    t.startOf("day").diff(now.startOf("day"), "days").days,
  );
  const day =
    days === 0
      ? "Today"
      : days === 1
        ? "Tomorrow"
        : days === -1
          ? "Yesterday"
          : days > 1 && days < 7
            ? t.toFormat("cccc")
            : t.toFormat("ccc d LLL");
  return `${day}, ${t.toFormat("h:mm a")}`;
}

function duration(from: DateTime, to: DateTime) {
  const m = Math.max(0, Math.round(to.diff(from, "minutes").minutes));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
}

export type Today = {
  id: string;
  /** From two hours before the first stop until the last one ends. */
  live: boolean;
  label: "Happening now" | "Today" | "Coming up";
  headline: string;
  sub: string;
  /** Stops finished, and the total, for the progress bar. */
  done: number;
  total: number;
  /** Where the directions button should go: the next stop, or the current one if it's the last. */
  directions?: string;
};

/**
 * What the home screen's "today" card says: the plan happening now, or the next one within
 * a week. Undefined when there is nothing ahead.
 */
export function today<T extends PlanSummary>(
  plans: Record<string, T>,
  now = DateTime.now().setZone(ZONE),
): Today | undefined {
  const ahead = Object.entries(plans)
    .filter(
      ([, e]) => endOf(e) > now && startOf(e).diff(now, "days").days < 7,
    )
    .sort((a, b) => startOf(a[1]).toMillis() - startOf(b[1]).toMillis());
  if (!ahead.length) return undefined;
  const [id, e] = ahead[0];
  const start = startOf(e);
  const brief = e.meta.brief ?? [];
  const live = start.diff(now, "hours").hours <= 2;
  const current = brief.find((b) => at(b.at) <= now && now < at(b.until));
  const next = brief.find((b) => at(b.at) > now);
  const done = brief.filter((b) => at(b.until) <= now).length;
  const time = (b: BriefStop) => at(b.at).toFormat("h:mm a");
  if (!live)
    return {
      id,
      live,
      label: "Coming up",
      headline: `Next up: ${whenLabel(e, now)}`,
      sub: brief.length
        ? brief.map((b) => b.name).join(" → ")
        : `${e.meta.stops} stops`,
      done,
      total: brief.length,
    };
  const headline = current
    ? `Now: ${current.name}`
    : start > now
      ? `Starts in ${duration(now, start)}`
      : next
        ? `Next: ${next.name}`
        : "Your plan today";
  const sub =
    current && next
      ? `Then ${next.name} at ${time(next)}`
      : current
        ? `Last stop, until ${at(current.until).toFormat("h:mm a")}`
        : next
          ? `${next.name} at ${time(next)}`
          : e.meta.title;
  return {
    id,
    live,
    label: current ? "Happening now" : "Today",
    headline,
    sub,
    done,
    total: brief.length,
    directions: (next ?? current)?.mapsUrl,
  };
}
