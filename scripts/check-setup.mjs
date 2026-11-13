#!/usr/bin/env node
// Checks which services are configured and working. Run: npm run check-setup
// Reads .env.local if present. Prints names and results only, never key values.
import { existsSync, readFileSync } from "node:fs";

if (existsSync(".env.local"))
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]])
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
const env = process.env;
const results = [];
const check = async (name, needs, test) => {
  const missing = needs.filter((n) => !n.split("|").some((k) => env[k]));
  if (missing.length)
    return results.push([name, "NOT SET", `add ${missing.join(", ")}`]);
  try {
    results.push([name, "OK", await test()]);
  } catch (e) {
    results.push([name, "FAILED", String(e.message ?? e).slice(0, 110)]);
  }
};
const json = async (url, init) => {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok)
    throw new Error(
      body.error?.message ?? body.message ?? body.msg ?? `HTTP ${r.status}`,
    );
  return body;
};

await check(
  "OpenAI (AI planning)",
  ["WHIMWAY_OPENAI_KEY|OPENAI_API_KEY", "WHIMWAY_OPENAI_MODEL|OPENAI_MODEL"],
  async () => {
    const model = env.WHIMWAY_OPENAI_MODEL ?? env.OPENAI_MODEL;
    await json(`https://api.openai.com/v1/models/${model}`, {
      headers: {
        Authorization: `Bearer ${env.WHIMWAY_OPENAI_KEY ?? env.OPENAI_API_KEY}`,
      },
    });
    return `model ${model} is available`;
  },
);
await check(
  "Google Places (real venues)",
  ["GOOGLE_MAPS_SERVER_KEY"],
  async () => {
    const body = await json(
      "https://places.googleapis.com/v1/places:searchText",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": env.GOOGLE_MAPS_SERVER_KEY,
          "X-Goog-FieldMask": "places.id",
        },
        body: JSON.stringify({ textQuery: "cafe in Toronto", pageSize: 1 }),
      },
    );
    return `${body.places?.length ?? 0} place returned`;
  },
);
await check(
  "Google Routes (travel times)",
  ["GOOGLE_MAPS_SERVER_KEY"],
  async () => {
    const body = await json(
      "https://routes.googleapis.com/directions/v2:computeRoutes",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": env.GOOGLE_MAPS_SERVER_KEY,
          "X-Goog-FieldMask": "routes.duration",
        },
        body: JSON.stringify({
          origin: {
            location: { latLng: { latitude: 43.651, longitude: -79.3815 } },
          },
          destination: {
            location: { latLng: { latitude: 43.6465, longitude: -79.4197 } },
          },
          travelMode: "WALK",
        }),
      },
    );
    return `route found (${body.routes?.[0]?.duration ?? "no duration"})`;
  },
);
await check(
  "Supabase (accounts, saved data)",
  ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"],
  async () => {
    const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const rpc = (fn, args) =>
      json(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(args),
      });
    await rpc("poll_tallies", {});
    await rpc("plans_this_month", { install: "setup-check-0001" });
    return "reachable, migrations applied";
  },
);
results.push([
  "Billing webhook",
  env.BILLING_WEBHOOK_SECRET ? "SET" : "NOT SET",
  env.BILLING_WEBHOOK_SECRET
    ? "secret present"
    : "add BILLING_WEBHOOK_SECRET when stores are connected",
]);
results.push([
  "Metrics dashboard key",
  env.ADMIN_KEY ? "SET" : "NOT SET",
  env.ADMIN_KEY ? "secret present" : "add ADMIN_KEY before deploying",
]);
results.push([
  "Rate limiting (Upstash)",
  env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN
    ? "SET"
    : "NOT SET",
  "required in production; planning is refused without it",
]);

const width = Math.max(...results.map((r) => r[0].length));
for (const [name, status, note] of results)
  console.log(`${name.padEnd(width)}  ${status.padEnd(8)} ${note}`);
const live = results.slice(0, 3).every((r) => r[1] === "OK");
console.log(
  live
    ? "\nLive planning is ready."
    : "\nLive planning is not ready yet: the app will run on demo data.",
);
