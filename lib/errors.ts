export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public upstreamStatus?: number,
  ) {
    super(message);
  }
}
export function configured(name: string) {
  return Boolean(process.env[name]);
}
export function requireEnv(name: string) {
  const v = process.env[name];
  if (!v)
    throw new AppError(
      "NOT_CONFIGURED",
      `${name} is not configured. Add it in environment settings to enable this service.`,
      503,
    );
  return v;
}
export async function providerFetch(url: string, init: RequestInit = {}) {
  const { meteredFetch } = await import("./server/usage");
  try {
    const response = await meteredFetch(url, {
      ...init,
      signal: AbortSignal.timeout(18000),
      cache: "no-store",
    });
    if (!response.ok)
      throw new AppError(
        "PROVIDER_ERROR",
        response.status === 429
          ? "The provider is at its usage limit. Please try later."
          : `The place or routing service could not complete the request (${response.status}).`,
        502,
        response.status,
      );
    return response;
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(
      "PROVIDER_TIMEOUT",
      "The provider could not be reached. Please try again.",
      502,
    );
  }
}
