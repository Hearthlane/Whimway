// Vercel function for the app's web site: forwards /api/* to the Whimway API (another Vercel
// project), so the browser talks to one origin, as mobile/scripts/serve-web.mjs does locally.
// Settings on this project: WHIMWAY_API_ORIGIN (e.g. https://whimway-api.vercel.app) and the
// same WHIMWAY_PROXY_SECRET as the API, so the API sees each visitor's own address.
export const config = { runtime: "edge" };

const HOP = new Set(["host", "connection", "content-length", "x-forwarded-host", "x-whimway-client-ip", "x-whimway-proxy-secret"]);

export default async function handler(request) {
  const api = process.env.WHIMWAY_API_ORIGIN;
  if (!api) return Response.json({ error: "WHIMWAY_API_ORIGIN is not set for the app site.", code: "NOT_CONFIGURED" }, { status: 503 });
  const url = new URL(request.url);
  // vercel.json rewrites /api/<path>?<query> to /api/proxy?p=<path>&<query>.
  const path = url.searchParams.get("p") ?? "";
  url.searchParams.delete("p");
  if (!/^[\w./-]*$/.test(path) || path.includes("..")) return Response.json({ error: "Not found." }, { status: 404 });
  // Only this site's own pages may call through; the API repeats the check with APP_ORIGIN.
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== url.host) return Response.json({ error: "This request must come from the Whimway app.", code: "INVALID_ORIGIN" }, { status: 403 });
  if (request.headers.get("sec-fetch-site") === "cross-site") return new Response(null, { status: 403 });

  const headers = new Headers();
  for (const [k, v] of request.headers) if (!HOP.has(k.toLowerCase())) headers.set(k, v);
  const secret = process.env.WHIMWAY_PROXY_SECRET;
  const ip = request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0];
  if (secret && ip) {
    headers.set("x-whimway-client-ip", ip.trim());
    headers.set("x-whimway-proxy-secret", secret);
  }
  const target = `${api.replace(/\/$/, "")}/api/${path}${url.search}`;
  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer(),
    redirect: "manual",
  });
  const out = new Headers(upstream.headers);
  out.delete("content-encoding");
  out.delete("content-length");
  return new Response(upstream.body, { status: upstream.status, headers: out });
}
