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
  kind: "generate" | "remix" | "read" | "write",
  userId?: string,
) {
  // On Vercel, the platform overwrites x-vercel-forwarded-for. Self-hosting must strip incoming forwarded headers.
  const ip =
    request.headers.get("x-vercel-forwarded-for") ??
    request.headers.get("x-forwarded-for")?.split(",")[0] ??
    "local";
  const identity = createHash("sha256")
    .update(userId ?? ip)
    .digest("hex")
    .slice(0, 24);
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
export function sameOrigin(request: Request) {
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
export function telemetry(event: string) {
  console.info(JSON.stringify({ event, at: new Date().toISOString() }));
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
