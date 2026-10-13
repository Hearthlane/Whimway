import { DateTime } from "luxon";
import type { CandidatePlace, OpeningPeriod } from "./schema";
type Check = {
  closed: boolean;
  label: string;
  confidence: "applicable" | "typical" | "unknown";
};
const unknown = (label = "Hours unavailable · check before going"): Check => ({
  closed: false,
  label,
  confidence: "unknown",
});
export function hoursCheck(
  place: CandidatePlace,
  arrival: DateTime,
  departure: DateTime,
): Check {
  // Provider hours are venue-local, even if the outing crosses a timezone boundary.
  const begin = place.timezone ? arrival.setZone(place.timezone) : arrival;
  const end = place.timezone ? departure.setZone(place.timezone) : departure;
  const date = begin.toISODate()!;
  const inWindow =
    place.hoursSource === "applicable" &&
    place.hoursWindow &&
    date >= place.hoursWindow.from &&
    end <=
      DateTime.fromISO(place.hoursWindow.to, { zone: begin.zoneName! }).plus({
        days: 1,
      });
  const legacyDate =
    place.hoursSource === "applicable" &&
    !place.hoursWindow &&
    place.hoursDates?.includes(date);
  let periods: OpeningPeriod[], confidence: Check["confidence"];
  if (inWindow || legacyDate) {
    periods = place.periods;
    confidence = "applicable";
  } else if (place.hoursSource === "typical") {
    periods = place.periods;
    confidence = "typical";
  } else if (place.regularPeriods.length) {
    periods = place.regularPeriods;
    confidence = "typical";
  } else
    return unknown(
      place.hoursSource === "applicable"
        ? "Hours for this date are not confirmed"
        : undefined,
    );
  // A retrieved current-hours window with no periods explicitly indicates no opening window.
  if (!periods.length)
    return confidence === "applicable" && inWindow
      ? { closed: true, label: "Outside published hours", confidence }
      : unknown();
  const sunday = begin.startOf("week").minus({ days: 1 });
  const windows = periods.flatMap((period) => {
    if (
      period.open.day === 0 &&
      period.open.hour === 0 &&
      period.open.minute === 0 &&
      !period.close
    )
      return [
        {
          start: begin.startOf("day").minus({ days: 1 }),
          end: end.plus({ days: 1 }),
        },
      ];
    if (confidence === "applicable" && period.open.date) {
      const start = DateTime.fromISO(period.open.date, {
        zone: begin.zoneName!,
      }).set({ hour: period.open.hour, minute: period.open.minute });
      if (!period.close) return []; // A truncated or incomplete period cannot confirm a full visit.
      let finish = period.close.date
        ? DateTime.fromISO(period.close.date, { zone: begin.zoneName! }).set({
            hour: period.close.hour,
            minute: period.close.minute,
          })
        : start
            .startOf("day")
            .plus({ days: (period.close.day - period.open.day + 7) % 7 })
            .set({ hour: period.close.hour, minute: period.close.minute });
      if (finish <= start) finish = finish.plus({ weeks: 1 });
      return [{ start, end: finish }];
    }
    const start = sunday
      .plus({ days: period.open.day })
      .set({ hour: period.open.hour, minute: period.open.minute });
    if (!period.close) return [];
    let finish = sunday
      .plus({ days: period.close.day })
      .set({ hour: period.close.hour, minute: period.close.minute });
    if (finish <= start) finish = finish.plus({ weeks: 1 });
    return [-1, 0, 1].map((week) => ({
      start: start.plus({ weeks: week }),
      end: finish.plus({ weeks: week }),
    }));
  });
  if (!windows.length && periods.some((p) => !p.close))
    return unknown("Hours are incomplete · check before going");
  const fits = windows.some(
    (w) => w.start.isValid && w.end.isValid && begin >= w.start && end <= w.end,
  );
  return {
    closed: !fits,
    label: fits
      ? confidence === "applicable"
        ? "Within published hours · admission not confirmed"
        : "Typical hours fit · confirm for this date"
      : confidence === "applicable"
        ? "Outside published hours"
        : "Outside typical hours",
    confidence,
  };
}
