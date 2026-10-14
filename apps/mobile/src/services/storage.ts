import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Itinerary, PlanSpec } from "../../../../lib/schema";
import {
  DayProgressSchema,
  dayProgressKey,
  FavoritePlaceRefSchema,
  favoritePlaceReference,
  PreferencesSchema,
  defaultPreferences,
  preferenceSyncDecision,
  rememberPlacePreference,
  parseSavedPlans,
  referenceOnlyPlan,
  type DayProgress,
  type Preferences,
  type FavoritePlaceRef,
} from "./storage-core";
import { cancelPlanReminders } from "./notifications";
import { recordDiagnostic } from "./diagnostics";
import { commitRecoveredSavedPlan } from "../core/saved-recovery";
import type { PlanPersistenceOptions } from "../core/plan-commit";

export {
  DayProgressSchema,
  PreferencesSchema,
  defaultPreferences,
  reconcileDayProgress,
} from "./storage-core";
export type { DayProgress, Preferences } from "./storage-core";
export type { FavoritePlaceRef } from "./storage-core";
const PLANS = "whimway:native:plans:v1";
const PREFS = "whimway:native:preferences:v1";
const FAVORITES = "whimway:native:favorite-places:v1";
const progressKey = dayProgressKey;
// Serialize writes so rapid Save/Delete taps cannot overwrite each other.
let writes: Promise<unknown> = Promise.resolve();
function write<T>(work: () => Promise<T>): Promise<T> {
  const result = writes.then(work, work);
  writes = result.catch(() => undefined);
  return result;
}
async function setItem(key: string, value: string) {
  try {
    await AsyncStorage.setItem(key, value);
  } catch {
    recordDiagnostic({
      category: "storage",
      code: "LOCAL_STORAGE_ERROR",
      operation: "device-storage",
    });
    throw new Error(
      "Device storage is full or unavailable. Your open plan is still available.",
    );
  }
}
async function readSavedPlans(): Promise<PlanSpec[]> {
  return parseSavedPlans(await AsyncStorage.getItem(PLANS));
}
export function getSavedPlans(): Promise<PlanSpec[]> {
  // Readers share the transaction queue: a Saved screen must never observe a
  // tentative write while cancellation is restoring the previous snapshot.
  return write(readSavedPlans);
}
export async function savePlan(
  plan: Itinerary | PlanSpec,
  options: Partial<PlanPersistenceOptions> = {},
): Promise<void> {
  const spec = referenceOnlyPlan(plan);
  const check = () => {
    if (options.signal?.aborted) throw new Error("The request was cancelled.");
  };
  check();
  return write(async () => {
    check();
    const previous = await AsyncStorage.getItem(PLANS);
    check();
    const plans = parseSavedPlans(previous);
    if (
      plans.some(
        (saved) => saved.id === spec.id && saved.revision > spec.revision,
      )
    )
      throw new Error(
        "Your saved plan changed during this request. Open the latest copy and try again.",
      );
    try {
      await setItem(
        PLANS,
        JSON.stringify(
          [spec, ...plans.filter((p) => p.id !== spec.id)].slice(0, 100),
        ),
      );
      check();
      // No await separates the final cancellation check from React acceptance.
      // If acceptance rejects a stale revision, rollback still owns the queue.
      options.onCommit?.();
    } catch (error) {
      try {
        if (previous === null) await AsyncStorage.removeItem(PLANS);
        else await setItem(PLANS, previous);
      } catch {
        throw new Error(
          "Device storage could not restore the previous plan. Check your saved plans and available storage before trying again.",
        );
      }
      throw error;
    }
  });
}
export function saveRecoveredPlan(
  original: PlanSpec,
  recovered: Itinerary,
  signal?: AbortSignal,
): Promise<void> {
  return write(() =>
    commitRecoveredSavedPlan(
      original,
      recovered,
      {
        read: readSavedPlans,
        write: (plans) => setItem(PLANS, JSON.stringify(plans)),
      },
      signal,
    ),
  );
}
export async function removePlan(id: string): Promise<void> {
  return write(async () => {
    await cancelPlanReminders(id);
    const plans = await readSavedPlans();
    await setItem(PLANS, JSON.stringify(plans.filter((p) => p.id !== id)));
    await AsyncStorage.removeItem(progressKey(id));
  });
}
export async function getPreferences(): Promise<Preferences> {
  const raw = await AsyncStorage.getItem(PREFS);
  try {
    const parsed = PreferencesSchema.safeParse(raw ? JSON.parse(raw) : {});
    return parsed.success ? parsed.data : defaultPreferences;
  } catch {
    return defaultPreferences;
  }
}
export async function savePreferences(preferences: Preferences): Promise<void> {
  const selected = PreferencesSchema.parse(preferences);
  await write(() => setItem(PREFS, JSON.stringify(selected)));
}
export function rememberDislikedPlace(placeId: string): Promise<Preferences> {
  return write(async () => {
    const previous = await getPreferences(),
      next = rememberPlacePreference(previous, placeId);
    await setItem(PREFS, JSON.stringify(next));
    return next;
  });
}
export async function adoptAccountPreferences(
  cloud: Preferences,
): Promise<boolean> {
  const selected = PreferencesSchema.parse(cloud);
  return write(async () => {
    const local = await getPreferences();
    if (preferenceSyncDecision(local, selected) !== "adopt-account")
      return false;
    await setItem(PREFS, JSON.stringify(selected));
    return true;
  });
}
export async function getDayProgress(
  planId: string,
): Promise<DayProgress | null> {
  const raw = await AsyncStorage.getItem(progressKey(planId));
  try {
    const parsed = DayProgressSchema.safeParse(raw ? JSON.parse(raw) : null);
    return parsed.success && parsed.data.planId === planId ? parsed.data : null;
  } catch {
    return null;
  }
}
export async function saveDayProgress(progress: DayProgress): Promise<void> {
  const value = DayProgressSchema.parse(progress);
  await write(() => setItem(progressKey(value.planId), JSON.stringify(value)));
}
export async function clearDayProgress(id: string): Promise<void> {
  await write(() => AsyncStorage.removeItem(progressKey(id)));
}
export async function getFavoritePlaces(): Promise<FavoritePlaceRef[]> {
  const raw = await AsyncStorage.getItem(FAVORITES);
  try {
    const value: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(value)
      ? value
          .flatMap((item) => {
            const result = FavoritePlaceRefSchema.safeParse(item);
            return result.success ? [result.data] : [];
          })
          .slice(0, 100)
      : [];
  } catch {
    return [];
  }
}
export async function saveFavoritePlace(
  plan: Itinerary,
  placeId: string,
): Promise<void> {
  const ref = favoritePlaceReference(plan, placeId);
  return write(async () => {
    const refs = await getFavoritePlaces();
    const exists = refs.some(
      (item) => item.placeId === ref.placeId && item.demo === ref.demo,
    );
    if (refs.length >= 100 && !exists)
      throw new Error(
        "Your favorite collection is full. Remove a place before adding another.",
      );
    await setItem(
      FAVORITES,
      JSON.stringify([
        ref,
        ...refs.filter(
          (item) => item.placeId !== ref.placeId || item.demo !== ref.demo,
        ),
      ]),
    );
  });
}
export async function removeFavoritePlace(
  ref: FavoritePlaceRef,
): Promise<void> {
  return write(async () => {
    const refs = await getFavoritePlaces();
    await setItem(
      FAVORITES,
      JSON.stringify(
        refs.filter(
          (item) => item.placeId !== ref.placeId || item.demo !== ref.demo,
        ),
      ),
    );
  });
}
