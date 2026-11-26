// Supabase Edge Function entry for the Whimway API. scripts/build-edge.mjs bundles this, the
// route handlers in app/api/[...path]/route.ts and everything they import into index.js.
// Supabase routes https://<project>.supabase.co/functions/v1/api/<path> here with the path
// "/api/<path>", the same paths the Next.js API serves.
import process from "node:process";
import { runWithRequest } from "./shims/request-context";
import { DELETE, GET, POST } from "../../../app/api/[...path]/route";

// Serverless: no durable disk, and the database is the record (see lib/server/event-log.ts).
process.env.WHIMWAY_EVENT_LOG ??= "/tmp/whimway-events.jsonl";
// The Supabase project this runs in is the app's Supabase project.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= process.env.SUPABASE_URL;
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= process.env.WHIMWAY_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
process.env.WHIMWAY_EDGE = "1";
// The app's site on Cloudflare Pages (override with the APP_ORIGIN secret if its address differs).
process.env.APP_ORIGIN ??= "https://whimway.pages.dev";
// Plans per person per day while testing; change with the DAILY_GUEST_GENERATIONS secret.
process.env.DAILY_GUEST_GENERATIONS ??= "40";
process.env.DAILY_REMIX_LIMIT ??= "80";

const handlers: Record<string, typeof GET> = { GET, POST, DELETE };

Deno.serve((request: Request) => {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/(?:functions\/v1\/)?api\/?(.*)$/);
  const handler = handlers[request.method];
  if (!match || !handler)
    return Response.json({ error: "Not found.", code: "NOT_FOUND" }, { status: request.method === "OPTIONS" ? 405 : 404 });
  const path = match[1].split("/").filter(Boolean).map(decodeURIComponent);
  return runWithRequest(request, () => handler(request, { params: Promise.resolve({ path }) }));
});

declare const Deno: { serve: (handler: (request: Request) => Response | Promise<Response>) => unknown };
