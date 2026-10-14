import { z } from "zod";

export const diagnosticCodes = [
  "API_NOT_CONFIGURED",
  "INVALID_RESPONSE",
  "REQUEST_FAILED",
  "NETWORK_ERROR",
  "TIMEOUT",
  "SCREEN_ERROR",
  "SCREEN_TYPE_ERROR",
  "SCREEN_RANGE_ERROR",
  "LOCAL_STORAGE_ERROR",
  "AUTH_SESSION_ERROR",
  "AUTH_FAILED",
  "LOCATION_UNAVAILABLE",
  "REMINDER_FAILED",
] as const;
export const DiagnosticEventSchema = z.object({
  at: z.string().datetime(),
  category: z.enum([
    "api",
    "render",
    "storage",
    "auth",
    "location",
    "reminders",
  ]),
  code: z.enum(diagnosticCodes),
  operation: z
    .enum([
      "status",
      "autocomplete",
      "location",
      "point",
      "generate",
      "hydrate",
      "edit",
      "remix",
      "explore",
      "place",
      "intent",
      "route",
      "plans",
      "profile",
      "share",
      "account",
      "screen",
      "device-storage",
      "sign-in",
      "session",
      "foreground-location",
      "reminders",
    ])
    .optional(),
  status: z.number().int().min(400).max(599).optional(),
  occurrences: z.number().int().min(1).max(999).default(1),
});
export type DiagnosticEvent = z.infer<typeof DiagnosticEventSchema>;
export type DiagnosticInput = {
  category: DiagnosticEvent["category"];
  code: string;
  operation?: string;
  status?: number;
};
export function sanitizedDiagnostic(
  input: DiagnosticInput,
  now = new Date(),
): DiagnosticEvent {
  const operation = input.operation?.split("?")[0].split("/")[0];
  const code = diagnosticCodes.includes(input.code as DiagnosticEvent["code"])
    ? input.code
    : "REQUEST_FAILED";
  const parsedOperation =
    DiagnosticEventSchema.shape.operation.safeParse(operation);
  return DiagnosticEventSchema.parse({
    at: now.toISOString(),
    category: input.category,
    code,
    ...(parsedOperation.success && parsedOperation.data
      ? { operation: parsedOperation.data }
      : {}),
    ...(input.status &&
    Number.isInteger(input.status) &&
    input.status >= 400 &&
    input.status <= 599
      ? { status: input.status }
      : {}),
    occurrences: 1,
  });
}
export function readDiagnosticEvents(raw: string | null): DiagnosticEvent[] {
  if (raw && raw.length > 50000) return [];
  try {
    const value: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(value)
      ? value
          .flatMap((item) => {
            const parsed = DiagnosticEventSchema.safeParse(item);
            return parsed.success ? [parsed.data] : [];
          })
          .slice(-30)
      : [];
  } catch {
    return [];
  }
}
export function appendDiagnostic(
  events: DiagnosticEvent[],
  event: DiagnosticEvent,
): DiagnosticEvent[] {
  const last = events.at(-1);
  if (
    last &&
    last.category === event.category &&
    last.code === event.code &&
    last.operation === event.operation &&
    last.status === event.status &&
    Date.parse(event.at) - Date.parse(last.at) >= 0 &&
    Date.parse(event.at) - Date.parse(last.at) < 1000
  ) {
    return [
      ...events.slice(0, -1),
      { ...event, occurrences: Math.min(999, last.occurrences + 1) },
    ].slice(-30);
  }
  return [...events, event].slice(-30);
}
export function formatDiagnosticReport(
  events: DiagnosticEvent[],
  environment: {
    version: string;
    platform: string;
    osVersion: string;
    build: string;
  },
) {
  // Only these fixed metadata fields are accepted, not a arbitrary device,
  // request, error, or session object supplied by a caller.
  const safe = (value: string) =>
    /^[a-zA-Z0-9._ -]{1,50}$/.test(value) ? value : "unavailable";
  const entries = readDiagnosticEvents(JSON.stringify(events));
  return [
    "Whimway diagnostic report",
    `App: ${safe(environment.version)}`,
    `Platform: ${safe(environment.platform)} ${safe(environment.osVersion)}`,
    `Build: ${safe(environment.build)}`,
    "Recent local errors (no plan text, place IDs, account details, tokens or coordinates):",
    ...(entries.length
      ? entries.map(
          (event) =>
            `${event.at} | ${event.category} | ${event.code} | ${event.operation ?? "app"}${event.status ? ` | HTTP ${event.status}` : ""}${event.occurrences > 1 ? ` | ${event.occurrences} occurrences` : ""}`,
        )
      : ["No recent errors recorded."]),
  ].join("\n");
}
