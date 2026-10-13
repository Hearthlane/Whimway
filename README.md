# Whimway

A responsive, guest-first area discovery and outing planner. **Good plans start anywhere.**

This repository began as an empty checkout. It now contains a Next.js App Router application with a real Google Places/Routes adapter, OpenAI Responses Structured Outputs, a deterministic planner/editor, device persistence, and optional Supabase authentication and sharing.

**Live services are not configured in the supplied cloud environment.** Automated journeys use explicitly synthetic provider fixtures. Live Google/OpenAI itineraries, Google maps/photos and hosted Supabase login are unverified. The migration and 30 authorization checks passed against an isolated local PostgreSQL instance with simulated Supabase roles. Illustrations are original artwork, labelled as such; they are not venue photography. This is a tested beta implementation, not a verified public launch.

## Run locally

To preview from GitHub without a local installation, open this repository's **Code → Codespaces → Create codespace on main**. The included container installs dependencies and starts the labelled development preview. Open the forwarded **3000** port in the Codespaces Ports tab if it does not open automatically. Its visibility stays private to your GitHub session. On Create, enable Development preview and search Toronto or Shibuya. Codespaces usage is subject to your GitHub account's allowance; stop the codespace when finished. Hosted Codespaces startup has not been verified in this cloud machine.

Node 24 and npm 11 were used. Use the committed npm lockfile.

```sh
npm ci
cp .env.example .env.local
# Fill only the services you want to enable; never commit this file.
npm run dev
```

For a credential-free development inspection:

```sh
WHIMWAY_DEMO_MODE=true NEXT_PUBLIC_WHIMWAY_DEMO_MODE=true npm run dev
```

Check **Development preview** on Create, then search **Toronto**, **Shibuya**, or **Remote**. Synthetic details, hours, prices, ratings and travel estimates are labelled. Fixture maps do not claim real directions. Demo requests and cloud publication of demo plans are rejected in production, even if the flags are set.

## What is implemented

- Explore, Create, itinerary, Saved, Profile, public sharing, magic-link callback, error/empty states and legal-review drafts.
- Worldwide Places autocomplete with sessions, explicit geolocation, dropped pins, circular radius selection and optional start/end anchors.
- Places API (New) Nearby and Text Search across interests, deduplication, bounded details retrieval, published price ranges and attributed photos.
- Two-stage OpenAI intent extraction and selection from retrieved IDs. Explicit form constraints win; prose conflicts request correction. IDs, duration ranges and locks are validated again in application code.
- A diverse shortlist and bounded geographic 2-opt pass to reduce backtracking. Displayed leg time, distance and geometry come only from Routes API. No route matrix or unbounded optimization calls.
- Server-enforced Haversine Area Lock, future local times, missing/ambiguous daylight-saving validation, visit durations, dated seven-day opening windows and typical-hours fallback, optional anchors, aggregate budgets and clearly identified partial itineraries.
- Lock/unlock, alternatives, add/remove, drag and accessible reorder buttons, duration edits, constraint changes, remix and undo; accepted changes refresh routes and totals.
- Mobile list/map switching with a touch and keyboard resizable itinerary sheet. Numbered Google Advanced Markers synchronize with stop cards.
- Guest device plans keep metadata and Place IDs, refreshing restricted provider content on reopening. Optional cloud save, cookie-based magic-link auth, taste preferences, account/data deletion and scrubbed read-only public copies.
- Origin checks, bounded validated JSON, timeouts, configurable daily allowances, global ceilings, distributed Redis limits that fail closed in production, a 90-second provider-operation deadline, actual provider-attempt accounting and anonymous event/token-count telemetry.

A hard budget excludes paid activities with unknown prices. Published ranges and browsing estimates are **not quotes** and omit taxes, tips, optional purchases, fuel, parking and tolls. Confirm prices and admission with venues. The selected area is an exploration centre, not your current starting position. No starting travel is included unless you choose an anchor.

## Provider configuration

See [docs/providers.md](docs/providers.md) for exact steps, API restrictions, networking and credential handling. All privileged calls run in server route handlers.

| Variable                                             | Purpose                                                                                                                     |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`                    | Browser-restricted Maps JavaScript key                                                                                      |
| `NEXT_PUBLIC_GOOGLE_MAP_ID`                          | Optional own cloud map ID; documented Google development map ID is the fallback                                             |
| `GOOGLE_MAPS_SERVER_KEY`                             | Server key for Places API (New), Routes API and Geocoding API                                                               |
| `WHIMWAY_OPENAI_KEY`                                 | OpenAI credential with a cloud-compatible variable name                                                                     |
| `OPENAI_API_KEY`                                     | Alternative for conventional local/Vercel configuration; `OPENAI_` target names are reserved in Codex cloud secret bindings |
| `WHIMWAY_OPENAI_MODEL` / `OPENAI_MODEL`              | Structured Outputs capable model available to your account; deliberately not hardcoded                                      |
| `NEXT_PUBLIC_SUPABASE_URL`                           | Optional Supabase project URL                                                                                               |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`               | Optional public Supabase key, protected by database RLS                                                                     |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Production distributed usage protection                                                                                     |
| `APP_ORIGIN`                                         | Recommended canonical deployed origin for mutation checks                                                                   |

There is no service-role key in the application. Public keys and map ID are build-time Next.js variables: rebuild after changing them. Provider secrets and the model are runtime server variables. Inspect names/presence only; do not dump credentials.

## Supabase

Apply `supabase/migrations/202610130001_whimway.sql` in a **new** Supabase project via SQL Editor, or use the Supabase CLI migration workflow. It creates owned plans/profiles/shares, RLS policies, a token-addressed read-only share RPC, and a self-account deletion RPC. Review SQL and test it against your project before deployment.

Enable email OTP/magic-link auth, configure your site URL, add your `/auth/callback` redirect URL, and configure SMTP for real users. Private table access uses the authenticated cookie session and database RLS. Anonymous users cannot write database rows or list public shares. Anyone possessing a share token can read that snapshot until revoked.

Share links require signing in and cloud-saving a live plan. They do not expose prompts, dietary/accessibility requirements, excluded places or personal route anchors. The map centre is derived from public stops, but **stop IDs, outing title, date, visit times, budget and group size remain public**. The UI explains this before copying the link. Cloud plan deletion revokes associated shares. Public copies remain independent of later private edits.

## Tests and production

```sh
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run test:db # Optional: Docker; disposable PostgreSQL authorization checks
npm run build
npm start
```

Playwright starts a development server with fixture mode. It uses `/usr/bin/chromium` when present, otherwise an installed Playwright browser. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` for a custom browser or run `npx playwright install --with-deps chromium` on a machine where installation is supported. Stop an existing non-fixture server before running E2E tests.

Tests cover geography, timezones/DST, costs, hours, locks, replacement constraints, scheduling, route failures, structured output rejection, provider normalization, save/share privacy and ownership endpoints. Browser journeys cover Toronto, Shibuya, sparse results, editing/remix, reloads, guest shared-plan duplication, responsive overflow and missing-service states. Hosted Supabase persistence/auth and provider responses are mocked where credentials are absent. Separately, test:db executes the actual migration and 30 owner/other-user/anonymous access checks in isolated PostgreSQL with simulated auth roles; it does not establish hosted authentication readiness.

Production deployment is compatible with Vercel. Import this repository, choose the Next.js preset, set the variables above, apply SQL and rebuild. Expensive endpoints require Redis in production. Configure Google/OpenAI provider quotas and spending alerts as an independent backstop. Do not publish fixtures, legal drafts or unreviewed credentials to a public launch. No public deployment, hosted database migration, provider account, billing setup or cloud publication was performed. A local disposable database was used for authorization testing.

## Architecture

- `lib/schema.ts`: Zod contracts for requests, places, estimates, legs, plans and mutations.
- `lib/providers/`: replaceable Google, OpenAI and explicit fixture adapters.
- `lib/planner.ts`, `geo.ts`, `time.ts`: deterministic selection safeguards, optimization, scheduling and estimates.
- `lib/server/`: Supabase cookie sessions, usage limits and mutation security.
- `app/api/[...path]/route.ts`: validated application endpoints; no secret in browser code.
- `lib/storage.ts`: permissible plan references, device persistence and public-copy redaction.
- `components/`: discovery, create, synchronized maps/timeline, saved collection and preferences.
- `supabase/migrations/`: owned data and read-only sharing policies.

## Remaining verification and limits

1. Configure credentials and billing, then exercise a full real Toronto and Shibuya outing, maps, photos, routes, replacements and AI repairs. Official provider policy pages were initially blocked by cloud network settings; review current terms before launch, especially the Places API regional/EEA rules.
2. Run the SQL and verify RLS with two actual users plus an anonymous session. Test magic-link delivery, cookie refresh, share revocation and account deletion. The migration passes local PostgreSQL ownership checks; hosted sessions and email delivery still need verification.
3. Timezones use offline `tz-lookup`. Currency is inferred for common countries, defaults to USD for unsupported country codes and can be explicitly adjusted. Verify border/island selections and currency before travel.
4. Future holiday hours, admission/reservations, dietary compliance, accessibility, driving traffic and unknown prices remain uncertain and are labelled. Provider failure stops an edit/generation instead of inventing routes or venues. Reopening unavailable places can return a partial plan or a recovery error.
5. Mobile checks ran in Chromium at representative widths; real iOS/Android devices, screen-reader review and legal review remain outstanding. Automated WCAG accessibility checks pass, including contrast on the tested pages. Replace or supplement editorial artwork with properly licensed photography if required before public release.
6. Preferences sync through Profile when saved to an account. A deliberately skipped place saves on the current device; use Profile Save to sync that choice. Usage telemetry includes server event names/timestamps, provider-attempt counts and AI input/output token counts; no returning-user analytics or advertising tracking is installed.
