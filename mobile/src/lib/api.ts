import { API_URL } from "./config";
import { accessToken } from "./auth";

// Who is calling: the install id (for the monthly free allowance) and whether this device
// holds a demo Plus purchase. The server only honours the demo flag where demo mode is on.
const client = { installId: "", demoPlus: false };
export function setClientContext(next: Partial<typeof client>) {
  Object.assign(client, next);
}

export class ApiError extends Error {
  constructor(message: string, public code = "ERROR", public status = 0) {
    super(message);
  }
}
export type Status = {
  places: boolean;
  maps: boolean;
  ai: boolean;
  cloud: boolean;
  demo: boolean;
  user: { id: string; email?: string } | null;
};

/** JSON call to the Whimway API, identifying as the native app and attaching auth. */
export async function api<T>(
  path: string,
  body?: unknown,
  options: { method?: string; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 100000);
  options.signal?.addEventListener("abort", () => controller.abort());
  const token = await accessToken();
  try {
    const response = await fetch(`${API_URL}/api/${path}`, {
      method: options.method ?? (body === undefined ? "GET" : "POST"),
      headers: {
        "X-Whimway-Client": "app",
        ...(client.installId ? { "X-Whimway-Install": client.installId } : {}),
        ...(client.demoPlus ? { "X-Whimway-Demo-Plus": "1" } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    let data: { error?: string; code?: string } & Record<string, unknown> = {};
    try {
      data = await response.json();
    } catch {
      // Non-JSON responses are handled below.
    }
    if (!response.ok)
      throw new ApiError(
        data.error ?? "Something went wrong on our side. Please try again.",
        data.code ?? "HTTP_" + response.status,
        response.status,
      );
    return data as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (controller.signal.aborted)
      throw new ApiError("That took too long. Check your connection and try again.", "TIMEOUT");
    throw new ApiError("Can't reach Whimway right now. Check your connection and try again.", "OFFLINE");
  } finally {
    clearTimeout(timer);
  }
}
