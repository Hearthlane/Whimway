import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { Platform, Share } from "react-native";
import {
  appendDiagnostic,
  formatDiagnosticReport,
  readDiagnosticEvents,
  sanitizedDiagnostic,
  type DiagnosticInput,
  type DiagnosticEvent,
} from "./diagnostics-core";

const KEY = "whimway:native:diagnostics:v1";
let events: DiagnosticEvent[] = [],
  loaded = false,
  operations: Promise<unknown> = Promise.resolve();
async function loadEvents() {
  if (loaded) return;
  try {
    events = readDiagnosticEvents(await AsyncStorage.getItem(KEY));
  } catch {
    /* Diagnostics remain available in memory if device storage is unavailable. */
  }
  loaded = true;
}
function queued<T>(work: () => Promise<T>): Promise<T> {
  const next = operations.then(work, work);
  operations = next.catch(() => undefined);
  return next;
}
export function recordDiagnostic(input: DiagnosticInput): void {
  const event = sanitizedDiagnostic(input);
  // Reporting never blocks the original failure or reports a storage failure
  // recursively. These events stay on the device until the user shares them.
  void queued(async () => {
    await loadEvents();
    events = appendDiagnostic(events, event);
    try {
      await AsyncStorage.setItem(KEY, JSON.stringify(events));
    } catch {}
  }).catch(() => {});
}
export async function getDiagnosticReport(): Promise<string> {
  await operations;
  await loadEvents();
  return formatDiagnosticReport(events, {
    version: Constants.expoConfig?.version ?? "development",
    platform: Platform.OS,
    osVersion: String(Platform.Version ?? "unavailable"),
    build: Constants.executionEnvironment ?? "unavailable",
  });
}
export async function shareDiagnosticReport(): Promise<void> {
  const message = await getDiagnosticReport();
  await Share.share({ title: "Whimway diagnostic report", message });
}
export function clearDiagnostics(): Promise<void> {
  return queued(async () => {
    try {
      await AsyncStorage.removeItem(KEY);
    } catch {
      throw new Error(
        "The local diagnostic history could not be cleared. Please try again.",
      );
    }
    events = [];
    loaded = true;
  });
}
