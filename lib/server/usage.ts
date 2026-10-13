import { AppError } from "../errors";
import { counter } from "./limiter";
import { providerSignal } from "./provider-context";
const providers: Record<string, string> = {
  "places.googleapis.com": "google_places",
  "routes.googleapis.com": "google_routes",
  "maps.googleapis.com": "google_maps",
  "api.openai.com": "openai",
};
export const meteredFetch: typeof fetch = async (input, init) => {
  const requestSignal = providerSignal();
  if (requestSignal?.aborted) throw requestCancellation(requestSignal);
  const target = input instanceof Request ? input.url : input.toString();
  const provider = providers[new URL(target).hostname];
  if (provider) {
    const configured = Number(process.env.GLOBAL_DAILY_PROVIDER_REQUEST_LIMIT);
    const max =
      Number.isFinite(configured) && configured > 0
        ? Math.floor(configured)
        : 1000;
    const total = await counter(
      `global:provider-attempts:${new Date().toISOString().slice(0, 10)}`,
      86400,
    );
    if (total > max)
      throw new AppError(
        "PROVIDER_DAILY_LIMIT",
        "Whimway has reached its daily provider-request allowance. Try again tomorrow.",
        429,
      );
    // No URL, place ID, query, credentials, network address or prompt is logged.
    console.info(
      JSON.stringify({
        event: "provider_request",
        provider,
        at: new Date().toISOString(),
      }),
    );
  }
  const signals = [
    requestSignal,
    init?.signal,
    input instanceof Request ? input.signal : undefined,
  ].filter((signal): signal is AbortSignal => Boolean(signal));
  try {
    return await fetch(input, {
      ...init,
      signal: signals.length ? AbortSignal.any(signals) : undefined,
    });
  } catch (error) {
    if (requestSignal?.aborted) throw requestCancellation(requestSignal);
    throw error;
  }
};
function requestCancellation(signal: AbortSignal) {
  return signal.reason?.name === "TimeoutError"
    ? new AppError(
        "REQUEST_TIMEOUT",
        "Planning took too long. Try fewer stops or adjust your outing and try again.",
        504,
      )
    : new AppError("REQUEST_CANCELLED", "This request was cancelled.", 499);
}
export function tokenUsage(
  usage: { input_tokens: number; output_tokens: number } | null | undefined,
) {
  if (usage)
    console.info(
      JSON.stringify({
        event: "ai_token_usage",
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        at: new Date().toISOString(),
      }),
    );
}
