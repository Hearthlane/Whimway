import { z } from "zod";

export class MobileApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status?: number,
  ) {
    super(message);
    this.name = "MobileApiError";
  }
}

export function validateApiBaseUrl(
  value: string | undefined,
  development = false,
) {
  if (!value)
    throw new MobileApiError(
      "Set EXPO_PUBLIC_API_URL to your Whimway backend before planning.",
      "API_NOT_CONFIGURED",
    );
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new MobileApiError(
      "The backend URL is invalid.",
      "API_NOT_CONFIGURED",
    );
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" && !(development && url.protocol === "http:"))
  ) {
    throw new MobileApiError(
      "Use an HTTPS backend URL. HTTP is available only in development.",
      "API_NOT_CONFIGURED",
    );
  }
  return url.toString().replace(/\/$/, "");
}

export type RequestOptions<T> = {
  signal?: AbortSignal;
  method?: string;
  schema?: z.ZodType<T>;
};

export async function requestJson<T>(
  baseUrl: string,
  path: string,
  schema: z.ZodType<T>,
  data?: unknown,
  options: RequestOptions<T> & {
    token?: string;
    fetcher?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<T> {
  if (
    !/^[a-z][a-z0-9/-]*(\?.*)?$/i.test(path) ||
    path.includes("..") ||
    path.includes("\\") ||
    path.startsWith("/")
  ) {
    throw new MobileApiError("This API path is invalid.", "INVALID_API_PATH");
  }
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? 105000);
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (data !== undefined) headers["Content-Type"] = "application/json";
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    const response = await (options.fetcher ?? fetch)(
      `${baseUrl}/api/${path}`,
      {
        method: options.method ?? (data === undefined ? "GET" : "POST"),
        headers,
        body: data === undefined ? undefined : JSON.stringify(data),
        signal: controller.signal,
        credentials: "omit",
        cache: "no-store",
      },
    );
    let result: unknown;
    try {
      result = await response.json();
    } catch {
      throw new MobileApiError(
        "The backend returned an unreadable response. Try again.",
        "INVALID_RESPONSE",
        response.status,
      );
    }
    if (!response.ok) {
      const error = z
        .object({
          error: z.string().max(1000),
          code: z.string().max(100).optional(),
        })
        .safeParse(result);
      throw new MobileApiError(
        error.success
          ? error.data.error
          : "The request could not be completed.",
        error.success
          ? (error.data.code ?? "REQUEST_FAILED")
          : "REQUEST_FAILED",
        response.status,
      );
    }
    const parsed = schema.safeParse(result);
    if (!parsed.success)
      throw new MobileApiError(
        "The backend returned an invalid plan or response. Try again.",
        "INVALID_RESPONSE",
        response.status,
      );
    return parsed.data;
  } catch (error) {
    if (controller.signal.aborted)
      throw new MobileApiError(
        timedOut
          ? "Planning took too long. Please try again."
          : "The request was cancelled.",
        timedOut ? "TIMEOUT" : "CANCELLED",
      );
    if (error instanceof MobileApiError) throw error;
    throw new MobileApiError(
      "Could not reach Whimway. Check your connection and backend address.",
      "NETWORK_ERROR",
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}
