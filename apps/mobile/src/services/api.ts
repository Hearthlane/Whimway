import { z } from "zod";
import {
  CandidatePlace,
  Itinerary,
  Location,
  PlanSpec,
  TravelLeg,
  PlanningIntent,
} from "../../../../lib/schema";
import { getAccessToken } from "./auth";
import { recordDiagnostic } from "./diagnostics";
import { Platform } from "react-native";
import { PreferencesSchema } from "./storage-core";
import {
  MobileApiError,
  requestJson,
  validateApiBaseUrl,
  type RequestOptions,
} from "./http";

export { MobileApiError } from "./http";
export const StatusSchema = z.object({
  places: z.boolean(),
  maps: z.boolean(),
  ai: z.boolean(),
  cloud: z.boolean(),
  demo: z.boolean(),
  user: z.object({ id: z.string(), email: z.string().optional() }).nullable(),
});
export type Status = z.infer<typeof StatusSchema>;
const SavedRows = z.array(
  z.object({ id: z.string().uuid(), spec: PlanSpec, updated_at: z.string() }),
);
const Suggestions = z.array(
  z.object({
    id: z.string().min(1).max(250),
    text: z.string().min(1).max(500),
  }),
);

export function getApiBaseUrl() {
  if (
    Platform.OS === "web" &&
    !process.env.EXPO_PUBLIC_API_URL &&
    typeof window !== "undefined"
  )
    return window.location.origin;
  return validateApiBaseUrl(
    process.env.EXPO_PUBLIC_API_URL,
    process.env.NODE_ENV !== "production",
  );
}

function responseSchema(path: string, method: string): z.ZodType {
  const route = path.split("?")[0];
  if (["generate", "hydrate", "edit", "remix"].includes(route))
    return Itinerary;
  if (route === "intent") return PlanningIntent;
  if (route === "route") return TravelLeg;
  if (["location", "point"].includes(route)) return Location;
  if (route === "autocomplete") return Suggestions;
  if (route === "explore") return z.array(CandidatePlace);
  if (route === "place") return CandidatePlace;
  if (route === "status") return StatusSchema;
  if (method === "DELETE") return z.object({ deleted: z.literal(true) });
  if (route === "plans")
    return method === "GET" ? SavedRows : z.object({ id: z.string().uuid() });
  if (route.startsWith("plans/") || route.startsWith("shared/"))
    return PlanSpec;
  if (route === "share") return z.object({ shareId: z.string().uuid() });
  if (route === "profile")
    return method === "GET"
      ? PreferencesSchema
      : z.object({ saved: z.literal(true) });
  throw new MobileApiError(
    "This response has no validation contract.",
    "INVALID_API_PATH",
  );
}

export async function api<T>(
  path: string,
  data?: unknown,
  options: RequestOptions<T> = {},
): Promise<T> {
  const method = options.method ?? (data === undefined ? "GET" : "POST");
  const schema =
    options.schema ?? (responseSchema(path, method) as z.ZodType<T>);
  try {
    return await requestJson(getApiBaseUrl(), path, schema, data, {
      ...options,
      resolveToken: getAccessToken,
      reportFailure: (failure) =>
        recordDiagnostic({
          category: "api",
          code: failure.code,
          operation: failure.path,
          status: failure.status,
        }),
    });
  } catch (error) {
    if (error instanceof MobileApiError && error.code === "API_NOT_CONFIGURED")
      recordDiagnostic({ category: "api", code: error.code, operation: path });
    throw error;
  }
}

export function apiPhotoUrl(name: string) {
  return `${getApiBaseUrl()}/api/photo?name=${encodeURIComponent(name)}`;
}
