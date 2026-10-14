import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { z } from "zod";
import type { Itinerary } from "../../../../lib/schema";
import { recordDiagnostic } from "./diagnostics";
import {
  DayProgressSchema,
  dayProgressKey,
  type DayProgress,
} from "./storage-core";
import {
  buildReminderPlan,
  ReminderOptionsSchema,
  type ReminderOptions,
} from "./reminder-plan";

export { defaultReminderOptions, ReminderOptionsSchema } from "./reminder-plan";
export type { ReminderOptions } from "./reminder-plan";
const STORE = "whimway:native:reminders:v1",
  CHANNEL = "whimway-day";
const SettingsSchema = z.object({
  planId: z.string().uuid(),
  enabled: z.boolean(),
  options: ReminderOptionsSchema,
  notificationIds: z.array(z.string()).max(9),
});
export type ReminderSettings = z.infer<typeof SettingsSchema>;
export type ReminderResult = {
  status: "scheduled" | "denied" | "unsupported" | "past";
  count: number;
};
let operations: Promise<unknown> = Promise.resolve();
function serialized<T>(action: () => Promise<T>): Promise<T> {
  const result = operations.then(action, action);
  operations = result.catch(() => undefined);
  return result.catch((error) => {
    recordDiagnostic({
      category: "reminders",
      code: "REMINDER_FAILED",
      operation: "reminders",
    });
    throw error;
  });
}
async function allSettings(): Promise<Record<string, ReminderSettings>> {
  const raw = await AsyncStorage.getItem(STORE);
  try {
    const value: unknown = raw ? JSON.parse(raw) : {};
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const result: Record<string, ReminderSettings> = {};
    for (const [id, settings] of Object.entries(value)) {
      const parsed = SettingsSchema.safeParse(settings);
      if (parsed.success && id === parsed.data.planId) result[id] = parsed.data;
    }
    return result;
  } catch {
    return {};
  }
}
export async function getReminderSettings(
  planId: string,
): Promise<ReminderSettings | null> {
  return (await allSettings())[planId] ?? null;
}
export async function getAllReminderSettings(): Promise<ReminderSettings[]> {
  const settings = Object.values(await allSettings());
  if (Platform.OS === "web") return settings;
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const ids = new Set(scheduled.map((item) => item.identifier));
  return settings.map((row) => ({
    ...row,
    notificationIds: row.notificationIds.filter((id) => ids.has(id)),
  }));
}
function permitted(value: Notifications.NotificationPermissionsStatus) {
  return (
    value.granted ||
    (value.ios?.status !== undefined &&
      [
        Notifications.IosAuthorizationStatus.AUTHORIZED,
        Notifications.IosAuthorizationStatus.PROVISIONAL,
        Notifications.IosAuthorizationStatus.EPHEMERAL,
      ].includes(value.ios.status))
  );
}
export function initializeNotifications(): void {
  if (Platform.OS === "web") return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}
async function cancelScheduled(planId: string) {
  if (Platform.OS === "web") return;
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const owned = scheduled.filter(
    (n) => n.content.data?.whimwayPlanId === planId,
  );
  await Promise.all(
    owned.map((n) =>
      Notifications.cancelScheduledNotificationAsync(n.identifier),
    ),
  );
}
async function schedule(
  plan: Itinerary,
  options: Partial<ReminderOptions>,
  requestPermission: boolean,
): Promise<ReminderResult> {
  if (Platform.OS === "web") return { status: "unsupported", count: 0 };
  let progress: DayProgress | undefined;
  try {
    const raw = await AsyncStorage.getItem(dayProgressKey(plan.id));
    const parsed = DayProgressSchema.safeParse(raw ? JSON.parse(raw) : null);
    if (parsed.success && parsed.data.planId === plan.id)
      progress = parsed.data;
  } catch {
    /* Corrupt local progress does not authorize suppressing a reminder. */
  }
  const selected = ReminderOptionsSchema.parse(options),
    reminders = buildReminderPlan(plan, selected, Date.now(), progress);
  if (!reminders.length) {
    await cancelScheduled(plan.id);
    const settings = await allSettings();
    settings[plan.id] = {
      planId: plan.id,
      enabled: true,
      options: selected,
      notificationIds: [],
    };
    await AsyncStorage.setItem(STORE, JSON.stringify(settings));
    return { status: "past", count: 0 };
  }
  if (Platform.OS === "android")
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: "Day reminders",
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: "default",
    });
  let permission = await Notifications.getPermissionsAsync();
  if (!permitted(permission) && requestPermission && permission.canAskAgain)
    permission = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: false, allowSound: true },
    });
  if (!permitted(permission)) {
    await cancelScheduled(plan.id);
    const settings = await allSettings();
    delete settings[plan.id];
    await AsyncStorage.setItem(STORE, JSON.stringify(settings));
    return { status: "denied", count: 0 };
  }
  await cancelScheduled(plan.id);
  initializeNotifications();
  const ids: string[] = [];
  try {
    for (const reminder of reminders) {
      ids.push(
        await Notifications.scheduleNotificationAsync({
          content: {
            title: reminder.title,
            body: reminder.body,
            sound: "default",
            data: {
              whimwayPlanId: plan.id,
              planId: plan.id,
              ...(reminder.placeId ? { placeId: reminder.placeId } : {}),
              url: `/plan/${plan.id}`,
            },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: new Date(reminder.at),
            channelId: CHANNEL,
          },
        }),
      );
    }
    const settings = await allSettings();
    settings[plan.id] = {
      planId: plan.id,
      enabled: true,
      options: selected,
      notificationIds: ids,
    };
    await AsyncStorage.setItem(STORE, JSON.stringify(settings));
  } catch {
    await Promise.all(
      ids.map((id) =>
        Notifications.cancelScheduledNotificationAsync(id).catch(
          () => undefined,
        ),
      ),
    );
    const settings = await allSettings();
    delete settings[plan.id];
    await AsyncStorage.setItem(STORE, JSON.stringify(settings));
    throw new Error(
      "Reminders could not be scheduled. Your plan is ready; try enabling reminders again.",
    );
  }
  return { status: ids.length ? "scheduled" : "past", count: ids.length };
}
// Only call this after the user taps Yes, remind me. No permission request is
// performed by updatePlanReminders, app startup, or profile hydration.
export function schedulePlanReminders(
  plan: Itinerary,
  options: Partial<ReminderOptions> = {},
): Promise<ReminderResult> {
  return serialized(() => schedule(plan, options, true));
}
export function updatePlanReminders(
  plan: Itinerary,
): Promise<ReminderResult | null> {
  return serialized(async () => {
    const settings = await getReminderSettings(plan.id);
    return settings?.enabled ? schedule(plan, settings.options, false) : null;
  });
}
export function cancelPlanReminders(planId: string): Promise<void> {
  return serialized(async () => {
    await cancelScheduled(planId);
    const settings = await allSettings();
    delete settings[planId];
    await AsyncStorage.setItem(STORE, JSON.stringify(settings));
  });
}
export function cancelAllPlanReminders(): Promise<void> {
  return serialized(async () => {
    if (Platform.OS !== "web") {
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      await Promise.all(
        scheduled
          .filter((n) => typeof n.content.data?.whimwayPlanId === "string")
          .map((n) =>
            Notifications.cancelScheduledNotificationAsync(n.identifier),
          ),
      );
    }
    await AsyncStorage.removeItem(STORE);
  });
}
