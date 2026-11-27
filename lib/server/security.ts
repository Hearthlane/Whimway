import { createHash } from "node:crypto";
import { AppError } from "../errors";
import { counter } from "./limiter";
export { counter } from "./limiter";
const limit = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};
export async function rateLimit(
  request: Request,
  kind:
    | "generate"
    | "remix"
    | "read"
    | "write"
    | "signal"
    | "browse"
    | "ad"
    | "tile",
  userId?: string,
) {
  const ip = clientIp(request);
  // A person is their account, or their app install on this network. Network address
  // alone would make everyone on shared wifi (a campus, a café) share one allowance.
  const install = request.headers.get("x-whimway-install");
  const person =
    userId ??
    (install && /^[A-Za-z0-9-]{8,64}$/.test(install) ? `${ip}:${install}` : ip);
  const hash = (v: string) =>
    createHash("sha256").update(v).digest("hex").slice(0, 24);
  const identity = hash(person);
  const today = new Date().toISOString().slice(0, 10);
  const costly = kind === "generate" || kind === "remix";
  const max =
    kind === "generate"
      ? limit(
          userId ? "DAILY_MEMBER_GENERATIONS" : "DAILY_GUEST_GENERATIONS",
          userId ? 12 : 3,
        )
      : kind === "remix"
        ? limit("DAILY_REMIX_LIMIT", 15)
        : kind === "read"
          ? 180
          : kind === "signal"
            ? 400 // cheap telemetry and reactions; kept apart so they never block saves or edits
            : kind === "browse"
              ? limit("HOURLY_BROWSE_LIMIT", 120) // place lists: paid lookups, but cached
              : kind === "ad"
                ? 120 // sponsored views and taps
                : kind === "tile"
                  ? 2400 // map tiles: a dozen per map, cached
                  : 50;
  if (
    (await counter(
      `${kind}:${identity}:${costly ? today : Math.floor(Date.now() / 3600000)}`,
      costly ? 86400 : 3600,
    )) > max
  )
    throw new AppError(
      "RATE_LIMIT",
      "You’ve reached the fair-use limit. Try again later.",
      429,
    );
  // Per-network ceiling so rotating install ids cannot multiply a guest's allowance without bound.
  if (
    !userId &&
    person !== ip &&
    (await counter(
      `${kind}:net:${hash(ip)}:${costly ? today : Math.floor(Date.now() / 3600000)}`,
      costly ? 86400 : 3600,
    )) >
      max * limit("NETWORK_SHARE_FACTOR", 25)
  )
    throw new AppError(
      "RATE_LIMIT",
      "Too many requests from this network. Try again later.",
      429,
    );
  // Browsing calls paid place lookups: give it its own site-wide daily budget.
  if (
    kind === "browse" &&
    (await counter(`global:browse:${today}`, 86400)) >
      limit("GLOBAL_DAILY_BROWSE_LIMIT", 2000)
  )
    throw new AppError(
      "GLOBAL_LIMIT",
      "Whimway has reached its daily service limit. Please try tomorrow.",
      429,
    );
  if (
    (await counter(
      `global:${costly ? "planning" : "requests"}:${today}`,
      86400,
    )) >
    (costly
      ? limit("GLOBAL_DAILY_PROVIDER_LIMIT", 300)
      : limit("GLOBAL_DAILY_REQUEST_LIMIT", 3000))
  )
    throw new AppError(
      "GLOBAL_LIMIT",
      "Whimway has reached its daily service limit. Please try tomorrow.",
      429,
    );
}
/**
 * Native apps send no Origin. Browsers always send Origin on cross-origin POSTs
 * and cannot attach the custom X-Whimway-Client header cross-site without a CORS
 * preflight, which this API never approves — so the pair is safe to accept.
 */
export function nativeClient(request: Request) {
  return (
    !request.headers.get("origin") &&
    request.headers.get("x-whimway-client") === "app" &&
    request.headers.get("sec-fetch-site") !== "cross-site"
  );
}
export function sameOrigin(request: Request) {
  if (nativeClient(request)) return;
  const origin = request.headers.get("origin");
  let valid = false;
  try {
    const url = new URL(origin ?? "");
    const configured = process.env.APP_ORIGIN;
    const host = request.headers.get("host") ?? new URL(request.url).host;
    valid =
      ["http:", "https:"].includes(url.protocol) &&
      (configured
        ? url.origin === new URL(configured).origin
        : url.host === host) &&
      request.headers.get("sec-fetch-site") !== "cross-site";
  } catch {}
  if (!valid)
    throw new AppError(
      "INVALID_ORIGIN",
      "This request must come from Whimway.",
      403,
    );
}
export async function body(request: Request) {
  sameOrigin(request);
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new AppError("INVALID_CONTENT", "Send JSON.");
  if (Number(request.headers.get("content-length") ?? 0) > 32768)
    throw new AppError("TOO_LARGE", "The request is too large.", 413);
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  if (reader)
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 32768) {
        await reader.cancel();
        throw new AppError("TOO_LARGE", "The request is too large.", 413);
      }
      chunks.push(value);
    }
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("INVALID_JSON", "Invalid request.");
  }
}
export function telemetry(event: string, props: Record<string, unknown> = {}) {
  console.info(
    JSON.stringify({ event, ...props, at: new Date().toISOString() }),
  );
}

export function requestOrigin(request: Request) {
  if (process.env.APP_ORIGIN) return new URL(process.env.APP_ORIGIN).origin;
  const url = new URL(request.url);
  const host = request.headers.get("host") ?? url.host;
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const candidate = new URL(origin);
      if (
        candidate.host === host &&
        ["http:", "https:"].includes(candidate.protocol)
      )
        return candidate.origin;
    } catch {}
  }
  return `${request.headers.get("x-forwarded-proto") === "https" ? "https:" : url.protocol}//${host}`;
}

/**
 * A stable, anonymous id for the network a request came from. Sponsored views and taps
 * are counted once per network per day, because an install id is chosen by the client
 * and could be rotated to inflate counts. (People sharing a network count once.)
 */
export function networkId(request: Request) {
  const ip = clientIp(request);
  return `n-${createHash("sha256").update(`ad|${ip}`).digest("hex").slice(0, 32)}`;
}

/**
 * The caller's network address. On Vercel the platform overwrites x-vercel-forwarded-for;
 * self-hosting must strip incoming forwarded headers. When the app's web site forwards
 * /api/* here (mobile/api/proxy.js), it passes the visitor's address in
 * x-whimway-client-ip together with the shared WHIMWAY_PROXY_SECRET, so limits stay per
 * person instead of per proxy. Without the matching secret that header is ignored.
 */
export function clientIp(request: Request) {
  const secret = process.env.WHIMWAY_PROXY_SECRET;
  const forwarded = request.headers.get("x-whimway-client-ip");
  if (secret && secret.length >= 16 && forwarded && request.headers.get("x-whimway-proxy-secret") === secret)
    return forwarded.split(",")[0].trim().slice(0, 64);
  return (
    request.headers.get("x-vercel-forwarded-for") ??
    request.headers.get("x-forwarded-for")?.split(",")[0] ??
    "local"
  );
}
