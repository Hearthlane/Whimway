import { DateTime } from "luxon";
export function localStart(date: string, time: string, zone: string) {
  const dt = DateTime.fromISO(`${date}T${time}`, { zone });
  if (!dt.isValid || dt.toFormat("HH:mm") !== time)
    throw new Error("This local time does not exist. Choose another time.");
  if (dt.getPossibleOffsets().length > 1)
    throw new Error(
      "This local time happens twice when the clocks change. Choose an unambiguous start time.",
    );
  return dt;
}
export function tomorrow(zone: string) {
  return DateTime.now().setZone(zone).plus({ days: 1 }).toISODate()!;
}
export function timeLabel(iso: string, zone: string) {
  return DateTime.fromISO(iso)
    .setZone(zone)
    .toLocaleString(DateTime.TIME_SIMPLE);
}
export function money(value: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).format(value);
}
