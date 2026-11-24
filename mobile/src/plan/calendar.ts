import { DateTime } from "luxon";
import { endOf, startOf } from "@shared/today";
import type { PlanEntry } from "@/lib/store";

const stamp = (d: DateTime) => d.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
// RFC 5545 text: escape separators, fold nothing (lines stay short enough for calendar apps).
const text = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** One calendar event per stop when the plan has stop times, else one event for the outing. */
export function planToIcs(id: string, entry: PlanEntry, link?: string) {
  const now = stamp(DateTime.utc());
  const stops = entry.meta.brief?.length
    ? entry.meta.brief.map((b, i) => ({ uid: `${id}-${i}`, title: `${b.name} · ${entry.meta.title}`, start: DateTime.fromISO(b.at), end: DateTime.fromISO(b.until), url: b.mapsUrl }))
    : [{ uid: id, title: entry.meta.title, start: startOf(entry), end: endOf(entry), url: link }];
  const events = stops.flatMap((e) => [
    "BEGIN:VEVENT",
    `UID:${e.uid}@whimway.app`,
    `DTSTAMP:${now}`,
    `DTSTART:${stamp(e.start)}`,
    `DTEND:${stamp(e.end)}`,
    `SUMMARY:${text(e.title)}`,
    ...(e.url ? [`URL:${e.url}`, `DESCRIPTION:${text(`Directions: ${e.url}`)}`] : []),
    "END:VEVENT",
  ]);
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Whimway//Plans//EN", "CALSCALE:GREGORIAN", ...events, "END:VCALENDAR", ""].join("\r\n");
}
