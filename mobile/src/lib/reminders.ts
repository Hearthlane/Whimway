import * as Notifications from "expo-notifications";
import { DateTime } from "luxon";
import { Platform } from "react-native";
import { endOf, startOf } from "@shared/today";
import type { TasteProfile } from "@shared/profile";
import type { PlanEntry } from "@/lib/store";

const supported = Platform.OS === "ios" || Platform.OS === "android";
if (supported) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

/** Ask once, when the person first saves a plan with reminders on. */
export async function allowReminders() {
  if (!supported) return false;
  const now = await Notifications.getPermissionsAsync();
  if (now.granted) return true;
  if (!now.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}

/**
 * Rebuild every local reminder from the saved plans: two hours before the first stop, and a
 * "how was it?" at 10am the next day. Local only; nothing leaves the phone.
 */
export async function syncReminders(plans: Record<string, PlanEntry>, profile: TasteProfile) {
  if (!supported) return;
  const perm = await Notifications.getPermissionsAsync();
  if (!perm.granted) return;
  await Notifications.cancelAllScheduledNotificationsAsync();
  const now = DateTime.now();
  for (const [id, e] of Object.entries(plans)) {
    if (!e.saved) continue;
    const start = startOf(e);
    const remind = start.minus({ hours: 2 });
    if (profile.remindDayOf && remind > now) {
      await Notifications.scheduleNotificationAsync({
        content: { title: `${e.meta.title} starts at ${start.toFormat("h:mm a")}`, body: e.meta.brief?.[0] ? `First stop: ${e.meta.brief[0].name}.` : "Open the plan for times and directions.", data: { url: `/plan/${id}` } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: remind.toJSDate() },
      });
    }
    const rate = endOf(e).plus({ days: 1 }).set({ hour: 10, minute: 0 });
    if (profile.remindRate && !e.feedback && rate > now) {
      await Notifications.scheduleNotificationAsync({
        content: { title: `How was ${e.meta.title}?`, body: "Two taps, and your next plans get better.", data: { url: `/plan/${id}` } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: rate.toJSDate() },
      });
    }
  }
}

/** Opening a reminder opens its plan. */
export function onReminderOpened(open: (url: string) => void) {
  if (!supported) return () => {};
  const sub = Notifications.addNotificationResponseReceivedListener((r) => {
    const url = r.notification.request.content.data?.url;
    if (typeof url === "string") open(url);
  });
  return () => sub.remove();
}
