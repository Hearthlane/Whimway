# Whimway

**From “what should we do?” to “we’re going” in under a minute.**

Whimway is an AI experience companion for spontaneous local dates and hangouts, launching
in the Greater Toronto Area (Toronto, Vaughan, Richmond Hill, Markham). You describe the
night you want; Whimway turns it into a real, followable plan of 2–4 verified places with
times, travel, costs and opening-hours checks, then lets you reshape it in plain words.

```
mobile/   iOS + Android app (Expo SDK 58, React Native, Expo Router, TypeScript)
app/      Next.js 16: secure API (/api/*) + web app + no-install share pages (/p, /s)
lib/      Shared, pure domain logic used by BOTH server and app
supabase/ Postgres migrations with row-level security
```

## Browse everything (one command)

```sh
npm run preview
```

Then open **http://localhost:8090** — the full app in your browser (onboarding, planning, Magic Edit, polls, saved, sharing). The web app and share links run on http://localhost:3000. In **GitHub Codespaces** (Code → Codespaces → Create codespace) this starts automatically and opens the app port. Everything runs in labelled demo mode with raised fair-use limits; reset the app via You → Delete data on this device.

## Quick start (no credentials needed)

```sh
npm ci
```

```sh
WHIMWAY_DEMO_MODE=true NEXT_PUBLIC_WHIMWAY_DEMO_MODE=true npm run dev
```

```sh
cd mobile && npm ci && npx expo start
```

Open the app with Expo Go on a phone on the same Wi‑Fi (details in [mobile/README.md](mobile/README.md)).
Demo mode uses a labelled catalogue of ~50 real, well-known GTA venues with **estimated**
hours, prices and travel times. It is disabled in production builds.

Node 24 / npm 11 were used for the web app; Expo resolves its own SDK-pinned versions.

## Status: what works, what’s simulated, what needs keys

| Area | Status |
| --- | --- |
| Natural-language understanding (who, when, budget total vs per person, transport, area, vibe, indoors) | **Working**, deterministic, on device and server; 20+ unit tests |
| Onboarding → prompt → plan → Magic Edit → save → share → feedback (app) | **Working in demo mode**; verified end to end in mobile Chromium via the Expo web build with zero errors. **Not yet run on physical iOS/Android devices** |
| Real venues, hours, photos, routes (Google Places API (New) + Routes API) | **Implemented, awaiting credentials** (`GOOGLE_MAPS_SERVER_KEY`). Adapter predates this work and is unit-tested with mocked HTTP |
| AI selection + Magic Edit wording (OpenAI Structured Outputs) | **Implemented, awaiting credentials** (`WHIMWAY_OPENAI_KEY` + model). Demo uses a transparent heuristic stand-in |
| Deterministic validation (hours, DST, budgets, locks, travel buffers, area) | **Working**; the AI can only choose provider place IDs |
| Magic Edit (structured: keep/replace/remove/add specific stops) | **Working**; preview shown before applying; undo |
| Polls, Plan Pulse, stop 👍/👎, post-outing feedback → personal taste + community ranking | **Working**; in-memory in dev, durable with Supabase |
| Accounts (email code), cloud save, short revocable share links, taste sync | **Implemented, awaiting Supabase project**; SQL + RLS verified on real PostgreSQL (47 assertions) |
| Account-free share links (`/p#…`), recipient can copy the plan | **Working**; E2E-tested; private details never in the link |
| Analytics events + metrics queries (`docs/metrics.sql`) | **Working** (stored once Supabase is configured; console logs otherwise) |
| Native maps | iOS Apple Maps (no key). Android needs a Maps SDK key in a dev build. Web shows a route sketch |
| Favourites + “Plan around this place” (anchored plans) | **Working**; tested end to end |
| Open a shared plan inside the app (paste link or `whimway://import?link=…`) | **Working**; the web share page offers “Open in the Whimway app” |
| Near me (device location, rounded to ~100 m, GTA-only) | **Working** in the browser preview; native permission prompts untested on devices |
| Crash screen + scrubbed crash reports (`/api/errors` → server logs) | **Working** |
| Brand icon, adaptive icon, splash, favicon; `app.config.ts`; `eas.json` | **Done**; store builds need your Expo/Apple/Google accounts |
| Whimway Plus: free limits, paywall, Plus-only features | **Working**; the monthly plan limit and the entitlement are enforced on the server. Purchases are a demo (no payment) until the stores are connected |
| Billing webhook (`/api/webhooks/billing`, RevenueCat format) | **Implemented and tested with simulated events**; needs your store and RevenueCat accounts (see `docs/monetization.md`) |
| Booking options per stop (table search, tickets, website, directions, ride) | **Working** as tracked hand-off links; no partner agreements, nothing is reserved |
| Community ratings on stops | **Working**; shown only once 5+ people have reacted to a venue |
| Your history ("Your nights"), pace and alcohol-free preferences | **Working** |
| Metrics dashboard at `/admin` with recorded daily history | **Working** on a single server (file-backed event log); set `ADMIN_KEY` in production. On serverless hosts use Supabase + `docs/metrics.sql` |
| Real payments, in-app reservations, social feed | **Not built** (see `docs/monetization.md` and roadmap) |

## What is implemented

**The experience companion (new in this phase)**

- **Native app** (`mobile/`): personality-style onboarding (every step skippable), the “What should we do?” composer with live “here’s what I heard” chips you can tap to adjust, staged generation, premium plan view (hero summary, route map, timeline of stop cards with hours confidence, price, reasoning, directions and website links), Magic Edit sheet with live preview and undo, save, native share, “start” navigation, Saved (upcoming / been there / plan again), You (taste, account, privacy, deletion).
- **Intent interpreter** (`lib/intent.ts`): turns “Saturday night with my girlfriend, $100 total, romantic but adventurous, don’t want to drive too far” into constraints (partner · 2 people · Sat 6:30 PM · $100 total = $50/person · driving within 8 km · romantic + adventurous). Instant, free, testable; the LLM still reads the full prompt for venue choice.
- **Magic Edit** (`lib/magic-edit.ts` + `Planner.magicEdit`): “make it cheaper”, “replace dinner with something adventurous”, “keep the first two stops, change the last”, “reduce walking”, “it’s raining — indoors”, “add dessert”, “make it shorter”. Kept stops are temporarily locked so they survive verbatim; user locks are never touched; replaced venues are excluded; a no-op is explained instead of faked.
- **Community feedback loop**: one-tap “this or that” polls on the home screen, **Plan Pulse** (“Does this feel like you?” 👍/👎 with reasons that each offer a one-tap fix), per-stop “Into it / Not for us”, and post-outing “Did you go? How was it?”. Every answer updates the user’s own taste immediately and adds an anonymous vote to **community signals** that re-rank everyone’s recommendations: sentiment counts only once 5+ distinct people weigh in, is smoothed toward neutral, nudges ranking by at most ±0.3, and a venue with strong, well-attested dislike (≤ −0.5) is excluded from new plans.
- **Personalization**: taste profile (companions, vibes, interests, budget, transport, home area, needs) plus a bounded category-affinity map learned from polls and feedback; disliked places are skipped.
- **Planner upgrades**: transit mode; indoor-only filter; shortlist ranked by quality + vibe fit + taste + community sentiment − over-budget penalty; venues closed for the whole outing are filtered before AI selection; the repair retry never re-offers the venue that just failed validation; per-operation detail caching.
- **Sharing**: account-free links carry a redacted plan in the URL fragment (never sent to servers); signed-in users get short revocable links. Recipients open them on the web without installing and can copy the plan.
- **Analytics**: allow-listed anonymous events (onboarding, plan requested/generated/failed, time-to-plan, saves, shares, share opens, navigation/booking taps, edits, polls, pulse, reactions, feedback) and server cost telemetry per plan (Google/OpenAI attempts and tokens). See `docs/metrics.sql`.
- **Security**: native clients authenticate with a Supabase bearer token (RLS still enforces ownership) and are recognised by an `X-Whimway-Client` header that browsers cannot send cross-site without a preflight this API never approves. Upgraded Next.js to 16.4.6 (critical advisory in 16.4.0).

**Preserved from the original web app** — worldwide area search, Explore, the web create flow and itinerary editor, device persistence, magic-link web auth, fair-use limits, provider cost ceilings, and all original tests.

A hard budget excludes paid activities with unknown prices. Published ranges and browsing estimates are **not quotes** and omit taxes, tips, optional purchases, fuel, parking and tolls. Confirm prices and admission with venues.

## Turning on live data in a Claude cloud session

This repository has a **whimway** cloud environment that allows Google Places, Routes and Maps and the OpenAI API. To use real places and AI there:

1. **OpenAI:** in the environment’s settings → network secrets, set the `api.openai.com` secret to a valid API key (starts with `sk-`). Add the variable `WHIMWAY_OPENAI_MODEL` (a Structured Outputs–capable model on your account) and `WHIMWAY_OPENAI_KEY=proxy-injected` (the proxy replaces the placeholder with the real key).
2. **Google:** add network secrets for `places.googleapis.com`, `routes.googleapis.com` and `maps.googleapis.com`, each sending your server key in the **`X-Goog-Api-Key`** header (no prefix). Add the variable `GOOGLE_MAPS_SERVER_KEY=proxy-injected`.
3. Restart the session and run `npm run preview`. The app switches from demo to live automatically (`/api/status` reports `places: true, ai: true`).

Outside Claude (your laptop, Vercel) put the real values in `.env.local` / project settings instead, as below.

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

Apply **all six** migrations in order in a **new** Supabase project (SQL Editor, or `supabase db push` with the CLI):

1. `202610130001_whimway.sql` — plans, profiles, shares, RLS, share RPC, self-deletion
2. `202611110001_experience.sql` — analytics events (`track_event`), feedback, larger profile size
3. `202611120001_community_signals.sql` — community signals and polls (write-only RPCs, k-anonymous aggregates)
4. `202611130001_plus_events.sql` — paywall funnel events
5. `202611140001_entitlements.sql` — Plus entitlements, monthly plan usage, billing webhook secret
6. `202611150001_edit_usage.sql` — Magic Edit counters per plan

For the app’s email sign-in, edit Authentication → Email Templates → Magic Link to include `{{ .Token }}` (users type a 6-digit code). It creates owned plans/profiles/shares, RLS policies, a token-addressed read-only share RPC, and a self-account deletion RPC. Review SQL and test it against your project before deployment.

Enable email OTP/magic-link auth, configure your site URL, add your `/auth/callback` redirect URL, and configure SMTP for real users. Private table access uses the authenticated cookie session and database RLS. Anonymous users cannot write database rows or list public shares. Anyone possessing a share token can read that snapshot until revoked.

Share links require signing in and cloud-saving a live plan. They do not expose prompts, dietary/accessibility requirements, excluded places or personal route anchors. The map centre is derived from public stops, but **stop IDs, outing title, date, visit times, budget and group size remain public**. The UI explains this before copying the link. Cloud plan deletion revokes associated shares. Public copies remain independent of later private edits.

## Tests and production

```sh
npm run typecheck
npm run lint
npm test            # 141 unit/integration tests
(cd mobile && npx tsc --noEmit)
npm run test:e2e
npm run test:db # Optional: Docker; disposable PostgreSQL authorization checks
npm run build
npm start
```

Playwright starts a development server with fixture mode. It uses `/usr/bin/chromium` when present, otherwise an installed Playwright browser. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` for a custom browser or run `npx playwright install --with-deps chromium` on a machine where installation is supported. Stop an existing non-fixture server before running E2E tests.

Tests cover geography, timezones/DST, costs, hours, locks, replacement constraints, scheduling, route failures, structured output rejection, provider normalization, save/share privacy and ownership endpoints. Browser journeys cover Toronto, Shibuya, sparse results, editing/remix, reloads, guest shared-plan duplication, responsive overflow and missing-service states. Hosted Supabase persistence/auth and provider responses are mocked where credentials are absent. Separately, test:db executes the actual migration and 30 owner/other-user/anonymous access checks in isolated PostgreSQL with simulated auth roles; it does not establish hosted authentication readiness.

Production deployment is compatible with Vercel. Import this repository, choose the Next.js preset, set the variables above, apply SQL and rebuild. Expensive endpoints require Redis in production. Configure Google/OpenAI provider quotas and spending alerts as an independent backstop. Do not publish fixtures, legal drafts or unreviewed credentials to a public launch. No public deployment, hosted database migration, provider account, billing setup or cloud publication was performed. A local disposable database was used for authorization testing.

## Architecture

- `lib/intent.ts`, `lib/areas.ts`: natural-language interpretation and GTA planning areas.
- `lib/magic-edit.ts`: structured edit interpretation (shared with the app for previews).
- `lib/profile.ts`, `lib/polls.ts`, `lib/crowd.ts`: taste profile, polls, community sentiment maths.
- `lib/server/signals.ts`: community signal store (Supabase or in-memory for development).
- `lib/share-link.ts`: account-free redacted share links.
- `lib/providers/gta-demo.ts`: labelled GTA demo catalogue and heuristic selector (dev only).
- `mobile/`: the native app (see its README).
- `lib/schema.ts`: Zod contracts for requests, places, estimates, legs, plans and mutations.
- `lib/providers/`: replaceable Google, OpenAI and explicit fixture adapters.
- `lib/planner.ts`, `geo.ts`, `time.ts`: deterministic selection safeguards, optimization, scheduling and estimates.
- `lib/server/`: Supabase cookie sessions, usage limits and mutation security.
- `app/api/[...path]/route.ts`: validated application endpoints; no secret in browser code.
- `lib/storage.ts`: permissible plan references, device persistence and public-copy redaction.
- `components/`: discovery, create, synchronized maps/timeline, saved collection and preferences.
- `supabase/migrations/`: owned data and read-only sharing policies.

## Remaining verification and limits

0. **This phase:** run the app on physical iPhone and Android devices (only the Expo web build was exercised here); add an Android Maps key; apply the three migrations to a hosted Supabase project and verify email-code sign-in; connect Google + OpenAI keys and judge real Toronto plans (demo plans are only as good as the heuristic stand-in). Community signals in development are in-memory and per-process.

1. Configure credentials and billing, then exercise a full real Toronto and Shibuya outing, maps, photos, routes, replacements and AI repairs. Official provider policy pages were initially blocked by cloud network settings; review current terms before launch, especially the Places API regional/EEA rules.
2. Run the SQL and verify RLS with two actual users plus an anonymous session. Test magic-link delivery, cookie refresh, share revocation and account deletion. The migration passes local PostgreSQL ownership checks; hosted sessions and email delivery still need verification.
3. Timezones use offline `tz-lookup`. Currency is inferred for common countries, defaults to USD for unsupported country codes and can be explicitly adjusted. Verify border/island selections and currency before travel.
4. Future holiday hours, admission/reservations, dietary compliance, accessibility, driving traffic and unknown prices remain uncertain and are labelled. Provider failure stops an edit/generation instead of inventing routes or venues. Reopening unavailable places can return a partial plan or a recovery error.
5. Mobile checks ran in Chromium at representative widths; real iOS/Android devices, screen-reader review and legal review remain outstanding. Automated WCAG accessibility checks pass, including contrast on the tested pages. Replace or supplement editorial artwork with properly licensed photography if required before public release.
6. Preferences sync through Profile when saved to an account. A deliberately skipped place saves on the current device; use Profile Save to sync that choice. Usage telemetry includes server event names/timestamps, provider-attempt counts and AI input/output token counts; no returning-user analytics or advertising tracking is installed.

## Roadmap (shortest path to learning)

1. **Credentials + real devices (week 1).** Google + OpenAI keys, hosted Supabase, TestFlight / internal Android track. Run 20 real Toronto plans and fix what’s wrong before inviting anyone.
2. **Closed beta (weeks 2–4), 30–50 couples and friend groups in the GTA.** Watch `docs/metrics.sql` §2–4: time to first plan, saved/shared rate, *“Did you go?”*, repeat planning within 7 days. Read Plan Pulse reasons (§7) weekly; they say exactly what to fix.
3. **Only then:** push reminders before saved plans, weather-aware Magic Edit suggestions, “plan again with fresh places”, and booking/referral links where partners allow. Payments and premium tiers wait until repeat use is proven.

Not building yet, by design: social feed, ticketing, flights/hotels, payments, background agents, a separate ML model. Community signals + taste affinity are deliberately simple and explainable until there is real data to justify more.
