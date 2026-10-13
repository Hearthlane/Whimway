export type Status = {
  places: boolean;
  maps: boolean;
  ai: boolean;
  cloud: boolean;
  demo: boolean;
  user: { id: string; email?: string } | null;
};
export async function api<T>(
  path: string,
  data?: unknown,
  options: { signal?: AbortSignal; method?: string } = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 105000);
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  try {
    const r = await fetch(`/api/${path}`, {
      method: options.method ?? (data === undefined ? "GET" : "POST"),
      headers:
        data === undefined ? undefined : { "Content-Type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data),
      cache: "no-store",
      signal,
    });
    const result = await r.json();
    if (!r.ok)
      throw new Error(result.error ?? "The request could not be completed.");
    return result;
  } catch (e) {
    if (
      signal.aborted ||
      (e instanceof DOMException && e.name === "AbortError")
    )
      throw new Error(
        "The request was cancelled or timed out. Please try again.",
      );
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
