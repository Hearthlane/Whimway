import { DateTime } from "luxon";
import { z } from "zod";
import type { Itinerary } from "../../../../lib/schema";
import { localStart } from "../../../../lib/time";
import type { DayProgress } from "./storage-core";

export const ReminderOptionsSchema = z.object({
  beforeMinutes: z.number().int().min(0).max(1440).default(15),
  upcomingStops: z.boolean().default(false),
  stopBeforeMinutes: z.number().int().min(0).max(60).default(5),
});
export type ReminderOptions = z.infer<typeof ReminderOptionsSchema>;
export const defaultReminderOptions = ReminderOptionsSchema.parse({});
export type PlannedReminder = {
  key: string;
  at: number;
  title: string;
  body: string;
  planId: string;
  placeId?: string;
};

export function buildReminderPlan(
  plan: Itinerary,
  options: Partial<ReminderOptions> = {},
  now = Date.now(),
  progress?: Pick<DayProgress, "completed" | "skipped">,
): PlannedReminder[] {
  const prefs = ReminderOptionsSchema.parse(options);
  const start = localStart(
    plan.request.date,
    plan.request.startTime,
    plan.request.location.timezone,
  );
  const result: PlannedReminder[] = [
    {
      key: "start",
      at: start.minus({ minutes: prefs.beforeMinutes }).toMillis(),
      title: "Your Whimway day is coming up",
      body: "Your outing is ready. Open your plan when you're ready to go.",
      planId: plan.id,
    },
  ];
  if (prefs.upcomingStops) {
    for (const stop of plan.stops) {
      // Arrival carries an explicit offset from the server. Never interpret it
      // in the device's timezone or guess an offset for a naive timestamp.
      if (!/(Z|[+-]\d{2}:\d{2})$/.test(stop.arrival))
        throw new Error(
          "This plan has an invalid reminder schedule. Refresh it before enabling reminders.",
        );
      const arrival = DateTime.fromISO(stop.arrival, { setZone: true });
      if (!arrival.isValid)
        throw new Error(
          "This plan has an invalid reminder schedule. Refresh it before enabling reminders.",
        );
      result.push({
        key: `stop-${stop.placeId}`,
        at: arrival.minus({ minutes: prefs.stopBeforeMinutes }).toMillis(),
        title: "Your next stop is coming up",
        body: `Open your day for ${stop.place.name}.`,
        planId: plan.id,
        placeId: stop.placeId,
      });
    }
  }
  return result
    .filter(
      (reminder) =>
        Number.isFinite(reminder.at) &&
        reminder.at > now + 5000 &&
        (!progress ||
          (reminder.key !== "start" &&
            !progress.completed.includes(reminder.placeId ?? "") &&
            !progress.skipped.includes(reminder.placeId ?? ""))),
    )
    .sort((a, b) => a.at - b.at);
}
