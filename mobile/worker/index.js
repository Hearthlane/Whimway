// Cloudflare Worker for the app's site: serves the web build (./dist, via the ASSETS binding)
// and forwards /api/* to the Whimway API on Supabase Edge Functions, so the browser only ever
// talks to one origin. Settings live in ../wrangler.jsonc.
const DROP = new Set(["host", "connection", "content-length", "cf-connecting-ip", "cf-ray", "cf-visitor", "cf-ipcountry", "x-forwarded-host", "x-whimway-client-ip", "x-whimway-proxy-secret"]);

export async function forward(request, env) {
  const api = env.WHIMWAY_API_ORIGIN;
  if (!api) return Response.json({ error: "WHIMWAY_API_ORIGIN is not set for this site.", code: "NOT_CONFIGURED" }, { status: 503 });
  const url = new URL(request.url);
  const rest = url.pathname.replace(/^\/api\/?/, "");
  const parts = rest.split("/").filter(Boolean);
  if (parts.some((p) => p === ".." || p === "." || !/^[\w.@%-]*$/.test(p))) return Response.json({ error: "Not found." }, { status: 404 });
  // Only this site's own pages may call through; the API repeats the check with APP_ORIGIN.
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== url.host) return Response.json({ error: "This request must come from the Whimway app.", code: "INVALID_ORIGIN" }, { status: 403 });
  if (request.headers.get("sec-fetch-site") === "cross-site") return new Response(null, { status: 403 });

  const headers = new Headers();
  for (const [k, v] of request.headers) if (!DROP.has(k.toLowerCase())) headers.set(k, v);
  // The origin was checked above; present it to the API as the app's canonical address, so the
  // API's own origin check (APP_ORIGIN) holds whatever address this Worker is served from.
  if (origin && env.WHIMWAY_APP_ORIGIN) headers.set("origin", env.WHIMWAY_APP_ORIGIN);
  const secret = env.WHIMWAY_PROXY_SECRET;
  const ip = request.headers.get("cf-connecting-ip");
  if (secret && ip) {
    headers.set("x-whimway-client-ip", ip);
    headers.set("x-whimway-proxy-secret", secret);
  }
  const upstream = await fetch(`${api.replace(/\/$/, "")}/api/${parts.join("/")}${url.search}`, {
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

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api" || pathname.startsWith("/api/")) return forward(request, env);
    return env.ASSETS.fetch(request);
  },
};
