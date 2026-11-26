// Cloudflare Pages Function: forwards /api/* from the app's site to the Whimway API, which runs
// as a Supabase Edge Function, so the browser only ever talks to one origin.
// Pages setting: WHIMWAY_API_ORIGIN, e.g. https://<project>.supabase.co/functions/v1
const DROP = new Set(["host", "connection", "content-length", "cf-connecting-ip", "cf-ray", "cf-visitor", "cf-ipcountry", "x-forwarded-host"]);

export async function onRequest({ request, env, params }) {
  const api = env.WHIMWAY_API_ORIGIN;
  if (!api) return Response.json({ error: "WHIMWAY_API_ORIGIN is not set for this site.", code: "NOT_CONFIGURED" }, { status: 503 });
  const url = new URL(request.url);
  const parts = Array.isArray(params.path) ? params.path : params.path ? [params.path] : [];
  if (parts.some((p) => p === ".." || p === "." || !/^[\w.@-]*$/.test(p))) return Response.json({ error: "Not found." }, { status: 404 });
  // Only this site's own pages may call through; the API repeats the check with APP_ORIGIN.
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== url.host) return Response.json({ error: "This request must come from the Whimway app.", code: "INVALID_ORIGIN" }, { status: 403 });
  if (request.headers.get("sec-fetch-site") === "cross-site") return new Response(null, { status: 403 });

  const headers = new Headers();
  for (const [k, v] of request.headers) if (!DROP.has(k.toLowerCase())) headers.set(k, v);
  const secret = env.WHIMWAY_PROXY_SECRET;
  const ip = request.headers.get("cf-connecting-ip");
  if (secret && ip) {
    headers.set("x-whimway-client-ip", ip);
    headers.set("x-whimway-proxy-secret", secret);
  }
  const target = `${api.replace(/\/$/, "")}/api/${parts.map(encodeURIComponent).join("/")}${url.search}`;
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
