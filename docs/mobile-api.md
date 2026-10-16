# Whimway native API

The existing Next.js service remains the provider and persistence backend. The Expo application uses its HTTPS `/api` routes, and imports the shared Zod schemas from `lib/schema.ts`. Google server credentials, OpenAI credentials and Redis credentials never belong in the native bundle.

## Request boundary and account identity

Native guest requests use JSON with no `Origin`, cookies, or browser `Sec-Fetch-*` headers. These endpoints are intentionally public and quota limited. No app-name header, embedded app secret or claimed user ID establishes trust. Requests with browser credentials or browser metadata still require the canonical same origin; cross-site requests cannot bypass that protection by adding a native marker. CORS is not broadened.

Signed-in native requests additionally send `Authorization: Bearer <Supabase access_token>`. The server checks the token through Supabase Auth `getUser(token)` and uses the same bearer on database operations. Database row-level security remains authoritative. Invalid or expired bearer credentials fail with `401 INVALID_AUTH`, rather than silently downgrading to guest access. A native guest can generate and save references locally; cloud plans, preferences, sharing and account deletion require a verified account.

Native email authentication uses the mobile Supabase client and PKCE deep-link callback. Register its redirect URI in Supabase. `/api/auth/signin` remains the web email flow and redirects to the hosted `/auth/callback`; it is not the native deep-link auth flow.

Production requires Upstash distributed limits. A missing or unavailable limiter fails closed before provider work. Vercel uses its platform-controlled forwarding metadata. For self-hosting, the ingress must strip client forwarding headers and set a verified `X-Forwarded-For`, then enable `TRUSTED_PROXY_HEADERS=true`. Without trusted metadata, anonymous requests share one network bucket; forged headers cannot reset it. Rate limits and provider-level billing quotas both matter for this public API.

## Prompt intake

`POST /api/intent` runs before the app has enough data to construct a `PlanRequest`:

```json
{
  "prompt": "Plan a fun date around Eaton Centre tomorrow. $70 each, food, shopping and something exciting.",
  "timezone": "America/Toronto"
}
```

`timezone` is optional and represents a verified destination timezone, when already known. It must not be supplied as an assumed device timezone. The response is `PlanningIntent`: optional `locationQuery`, `dateChoice`, `date`, `startTime`, `duration`, `budget`, `participants`, `companion`, `energy`, `vibes`, `interests`, `mode`, `dietary`, and `accessibility`, plus `warnings: string[]`.

Only supplied answers are returned. Missing preferences are omitted, allowing the app to skip answered questions and show the remaining ones. `locationQuery` is search text, never a verified location. Autocomplete plus place detail selection must confirm it. `today` and `tomorrow` remain relative in `dateChoice`; the app resolves them after confirming the destination timezone. A `specific` date is validated as a real calendar date. Ambiguous requests produce warnings rather than fabricated defaults. OpenAI uses strict Structured Outputs and the incomplete-intake schema, not the required generation schema. This endpoint requires actual AI configuration and returns `503 NOT_CONFIGURED` when absent; development does not silently imitate an AI response.

`PlanRequest` accepts optional `companion` (`solo`, `date`, `friends`, `family`, `group`), `energy` (`chill`, `balanced`, `active`), and up to three `vibes` (`budget-friendly`, `romantic`, `exciting`, `cozy`, `trendy`, `hidden-gems`, `luxurious`, `anything`). Existing web and saved plans remain valid without them. The recommendation prompt uses these preferences for suitability and pacing while keeping provider evidence and deterministic validation authoritative.

## Locations and itinerary operations

| Operation | Contract |
| --- | --- |
| `GET /api/status` | Provider availability and verified user. Availability reflects configuration, not a completed live-provider test. |
| `GET /api/autocomplete?q=...&session=<uuid>` | Actual Google place suggestions `{id,text}[]`. Reuse a session UUID until a location is confirmed. |
| `GET /api/location?id=...&session=<uuid>` | Actual location, coordinates, currency and IANA timezone. |
| `POST /api/point` | `Point {lat,lng}` → reverse-geocoded location and geographically resolved timezone; requires Geocoding API. |
| `POST /api/generate` | `{request:PlanRequest,demo?:boolean}` → one validated `Itinerary`. |
| `POST /api/hydrate` | `PlanSpec` → freshly retrieved `Itinerary`; saved references are not provider-content caches. |
| `POST /api/edit` | `{spec:PlanSpec,stops:StopRef[],request?:PlanRequest}` → recalculated route, schedule and costs. |
| `POST /api/remix` | `{spec:PlanSpec,action:RemixAction}` → recalculated plan preserving locked stops. |
| `POST /api/explore` | `{request:PlanRequest,query?:string,demo?:boolean}` → verified candidates for replace/add. |
| `GET/POST /api/plans`, `GET/DELETE /api/plans/<uuid>` | Cloud reference storage; verified bearer or web cookie session required. |
| `GET/POST/DELETE /api/profile` | Account preferences; verified identity required. |
| `POST /api/share` | `{id:<saved-plan-uuid>}` → `{shareId:<uuid>}`; owner required. |
| `GET /api/shared/<uuid>` | Read-only scrubbed public plan references. |
| `DELETE /api/shares/<uuid>` | Revoke a share; owner required. |
| `DELETE /api/account` | Delete the verified user's account and cloud data using the existing database function. |

The planner retrieves a bounded real shortlist, considers prices and opening-hour confidence, rejects unknown provider IDs, enforces area and hard-budget constraints, schedules actual provider travel legs, and supports one bounded repair. Unknown prices and typical hours remain labelled as uncertainty. All edit and remix responses replace itinerary state; display-only text updates are insufficient.

## Current location routing

`POST /api/route` accepts `NavigationRequest`:

```json
{
  "from": {"lat": 43.6544, "lng": -79.3807},
  "to": {"lat": 43.6535, "lng": -79.3839},
  "toId": "real-provider-place-id",
  "mode": "WALK"
}
```

The response is `TravelLeg {from:"current",to,minutes,meters,polyline,verified:true}`. The polyline and travel estimate come from Google Routes. Walking and driving are supported. Driving is traffic-unaware; this API does not supply turn-by-turn instructions, arrival detection, navigation rerouting or live traffic. Missing geometry/route support returns `422 NO_ROUTE`; missing server keys return `503 NOT_CONFIGURED`. The mobile client must cancel stale requests and keep previous geometry clearly distinguished from a new location route. Avoid a provider request on every GPS tick.

`demo:true` works only with `WHIMWAY_DEMO_MODE=true` in a non-production service. It returns an explicitly synthetic `verified:false` leg with no route geometry. Fixtures are never silently substituted for a failed provider. Fixture plans cannot be cloud-published.

## Limits, cancellation and failures

Existing limits remain: 3 guest / 12 member generations per UTC day, 15 recomputations/remixes per identity per day, 180 reads/hour and 50 other writes/hour. Prompt intake has its own 10 guest / 25 member daily allowance, configurable through `DAILY_GUEST_INTENTS` / `DAILY_MEMBER_INTENTS`. Current-location routes default to 120/hour via `HOURLY_ROUTE_LIMIT`. Global request/planning limits and the 1,000 actual provider attempts/day limit also apply; retries count. Providers share the existing 90-second operation deadline and cancellation signal.

Failures use `{error:string,code:string}` and HTTP status. Important codes include `NOT_CONFIGURED`, `PERSISTENCE_DISABLED`, `INVALID_AUTH`, `SIGN_IN_REQUIRED`, `INVALID_ORIGIN`, `INVALID_INPUT`, `INVALID_AI_OUTPUT`, `NO_SUITABLE_PLACES`, `NO_ROUTE`, `LOCK_CONFLICT`, `PROVIDER_TIMEOUT`, `REQUEST_TIMEOUT`, `RATE_LIMIT`, `GLOBAL_LIMIT`, `PROVIDER_DAILY_LIMIT`, and `LIMITER_NOT_CONFIGURED`. The client should retain answers and local plan references during failures, show the actionable error and offer retry where appropriate. Logs contain counts and event names; prompts, locations, credentials and bearer tokens are not logged.

## Verification

`npm test` covers the existing planning/provider/security behavior plus native guest access, browser-CSRF preservation, streamed request size enforcement, forwarding-header quota spoofing, structured incomplete prompt intake, relative destination dates, impossible date output, actual route geometry handling, unverified fixtures and real Supabase SDK bearer verification/RLS headers against synthetic HTTP responses. These tests do not establish a live provider account connection. Hosted credentials, real email delivery and signed native-device testing remain separate required configuration and validation steps.
