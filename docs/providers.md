# Provider setup and deployment checklist

## Google Maps Platform

1. Create a Google Cloud project, attach billing and enable **Maps JavaScript API**, **Places API (New)**, **Routes API**, and **Geocoding API**.
2. Create a browser key. Restrict it by HTTP referrer to your development and production hosts and to Maps JavaScript API. Put it in `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`. It is public by design; do not reuse the server key. Add your real cloud map ID to `NEXT_PUBLIC_GOOGLE_MAP_ID` for production styling/Advanced Markers.
3. Create a separate server key, restrict its allowed APIs to the other three APIs and apply IP restrictions where your deployment provides stable outbound addresses. Serverless deployments generally need API restrictions, quotas and a controlled proxy/egress path rather than an unsupported fixed-IP assumption. Put it in `GOOGLE_MAPS_SERVER_KEY`.
4. Set Google API budgets, quota alerts and conservative API quotas. Billing budgets can alert without blocking spending; API quotas are a separate control.
5. Verify autocomplete sessions and place details billing in your account. Requests use field masks, at most three candidate searches, 36 raw candidates, a ten-place detailed shortlist, six initially AI-selected stops (up to eight during remix to preserve manual locks), and at most one repair. The editor caps plans at eight stops and limits route calculations.
6. Confirm applicable Google Places, Routes, Photos and Maps terms for your billing region, particularly EEA changes. Venue cards preserve photo authors and Google Maps review attribution. Actual Maps rendering preserves provider attribution. Device/database saves store IDs, user choices and visit metadata; photos, provider descriptions, ratings, opening hours and route content are not persisted. Provider calls use `no-store`.

References:

- https://developers.google.com/maps/documentation/places/web-service
- https://developers.google.com/maps/documentation/places/web-service/policies
- https://developers.google.com/maps/documentation/places/web-service/place-photos
- https://developers.google.com/maps/documentation/routes
- https://developers.google.com/maps/documentation/javascript/advanced-markers/overview

## OpenAI

Create a project/API credential with appropriate spend controls. Select a model available to your account that supports **Responses API Structured Outputs**, and set `WHIMWAY_OPENAI_MODEL` (`OPENAI_MODEL` also works outside Codex cloud). The code intentionally does not assume an account-specific model identifier. Set `WHIMWAY_OPENAI_KEY` in Codex cloud settings. `OPENAI_API_KEY` is supported in ordinary local/Vercel environments, but the `OPENAI_` prefix is reserved for cloud proxy-secret targets.

Configure the secret’s destination as `api.openai.com`. The planner supplies schemas via `zodTextFormat`, keeps all provider calls server-side, treats prose/venue names as untrusted inputs, and rejects candidate IDs or lock mutations not present in retrieved data. It sends outing requirements to OpenAI; review retention controls for your provider account.

## Supabase

Create a project and apply the migration described in README. Set the public project URL and publishable key; never substitute a service-role key. Add local and deployed `/auth/callback` URLs to Auth redirect settings. Email magic links use PKCE and cookie sessions through `@supabase/ssr`.

Use two test users to verify: owner A can save/read/delete A’s plans; B and anonymous clients cannot read/write A’s private rows; a valid share token works anonymously and cannot be edited; revoked tokens fail; deleting a plan removes its shares; deleting A removes A’s account and associated cloud rows. The actual migration and 30 authorization assertions passed in disposable local PostgreSQL with simulated Supabase auth roles. It has not been applied to a hosted project; email delivery, real sessions and hosted behavior remain unverified. Run npm run test:db to reproduce the local checks; Docker is required and the PostgreSQL image is pinned by digest.

## Distributed usage protection

Create an Upstash Redis database and set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` securely. Use the token through your database’s exact HTTPS destination in cloud proxy settings. The server uses an atomic Redis increment/TTL script; outages and missing Redis configuration fail closed in production.

Default limits: 3 guest/12 member full generations per UTC day, 15 recomputations/remixes per identity per UTC day, 180 read requests per hour and 50 other writes per hour. Global caps default to 300 planning requests and 3,000 other requests per UTC day. GLOBAL_DAILY_PROVIDER_REQUEST_LIMIT separately defaults to 1,000 actual server Google/OpenAI HTTP attempts per UTC day, including retries, detail refreshes, photos and alternatives. Browser Maps calls are governed separately by Google key restrictions and quotas. Provider work shares a 90-second operation deadline and follows client cancellation where the runtime forwards disconnects. Logs contain provider/event/time and AI token counts, without prompts, locations, credentials or place IDs. Development request logging is disabled to keep autocomplete text and auth callback codes out of routine logs. All defaults can be tuned where declared in `.env.example`.

Guest identities use a hash of the trusted deployment IP. On Vercel the code prefers `x-vercel-forwarded-for`; for self-hosting, your ingress must strip client-supplied forwarded headers and set trusted IP metadata. Network identity limits are fair-use protection, not bot-proof billing controls. Set provider-level quotas and monitor spend independently. Authenticated user identities use their validated Supabase ID.

Set `APP_ORIGIN` to the canonical deployed origin. Cross-site mutations are rejected. Set Next.js development origins explicitly when accessing a development server through a trusted custom host; do not broaden production CORS.

## Cloud networking and secure entry

Required server destinations: `places.googleapis.com`, `routes.googleapis.com`, `maps.googleapis.com`, and `api.openai.com`. Optional configured destinations: your project’s `*.supabase.co` and Redis database’s `*.upstash.io`. Browser Google Maps also needs Google map/static/image endpoints. Documentation lives on `developers.google.com` and `platform.openai.com`.

Enter actual credentials in environment settings or an ignored local `.env.local`, never in chat or source code. Cloud draft secret declarations hold names and allowed destinations only; they do not create credential values. Public browser variables require real public values rather than proxy placeholders, and must be set before building. Server secret placeholders are sent only through supported HTTPS provider calls.

The development application is usable for fixture-based inspection without credentials. Publishing the prepared Codex environment and deploying a public application are separate user actions. A saved draft does not execute scripts or apply credentials to the current process.
