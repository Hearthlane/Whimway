# Validation record

## Design, monetisation and billing phase (Nov 2026)

| Check                                         | Outcome                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Root + app typechecks, ESLint                 | Passed                                                                                                                                                                                                                                                                                                                               |
| Vitest                                        | 141 passed across 11 files (adds Plus limits, booking options, alcohol-free, metrics summary, server allowance for plans and edits, billing webhook)                                                                                                                                                                                 |
| Playwright (web)                              | 15 journeys passed                                                                                                                                                                                                                                                                                                                   |
| App journey (Expo web build, mobile Chromium) | Onboarding with profile-building and reveal → Plus offer → poll → plan → pulse → reaction → booking options → favourite → Magic Edit → save → share → feedback → history → paywall and demo trial → plan around a favourite → open a shared link in-app → near me → recipient opens link: all assertions passed, zero browser errors |
| Database                                      | All six migrations + 61 authorization assertions passed on local PostgreSQL 16                                                                                                                                                                                                                                                       |
| Live allowance check                          | Against the running API: five free plans succeed, the sixth returns 402                                                                                                                                                                                                                                                              |
| Production build                              | `next build` passed                                                                                                                                                                                                                                                                                                                  |

Not verified: physical devices, native maps and haptics, live Google/OpenAI responses, hosted Supabase, real store purchases (the billing webhook was exercised with simulated events only).

## Experience companion phase (Nov 2026)

| Check                                           | Outcome                                                                                                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Root typecheck, ESLint                          | Passed                                                                                                                                                                   |
| App typecheck (`mobile/`)                       | Passed                                                                                                                                                                   |
| Vitest                                          | 121 passed across 8 files (intent, Magic Edit, personalization, community signals, polls, GTA demo planning, native-client API, share links)                             |
| Playwright (web)                                | 15 journeys passed, including the account-free share link; accessibility check now audits with reduced motion                                                            |
| App journey (Expo web build in mobile Chromium) | Onboarding → poll → prompt → plan → Plan Pulse → stop reaction → Magic Edit → save → share → feedback → recipient opens link: all assertions passed, zero browser errors |
| Database                                        | All three migrations + 47 authorization assertions passed on local PostgreSQL 16 (Docker was unavailable; same SQL as `npm run test:db`)                                 |
| Production build                                | `next build` passed                                                                                                                                                      |
| Dependency audit                                | 0 production vulnerabilities after upgrading Next.js to 16.4.6                                                                                                           |

Not verified: physical iOS/Android devices, native map rendering, live Google/OpenAI responses, hosted Supabase auth/email delivery.

## Original build

The supplied repository was empty. Whimway was implemented and checked on this cloud machine with Node 24.19.0, npm 11.9.0 and Chromium.

| Check                                     | Outcome                                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Frozen installation with the npm lockfile | Passed                                                                                                 |
| Type checking and ESLint                  | Passed, no warnings                                                                                    |
| Vitest                                    | 80 tests passed across 5 files; none skipped                                                           |
| Playwright                                | 14 journeys passed; none skipped                                                                       |
| Database authorization                    | Actual migration and 30 assertions passed in isolated PostgreSQL 17 with simulated Supabase auth roles |
| Automated accessibility                   | Axe WCAG 2 A/AA and 2.1 A/AA checks passed on the six main pages and phone/desktop itineraries         |
| Next.js production build                  | Passed                                                                                                 |
| Production startup                        | Explore, Create, Saved, Profile, Privacy and Terms returned HTTP 200                                   |
| Production usage protection               | Planning returned explicit HTTP 503 with Redis unconfigured; fixtures disabled                         |
| Production dependency audit               | 0 known vulnerabilities reported                                                                       |
| Responsive inspection                     | 24 page views across 1440px, 768px and 375px; no horizontal overflow or browser exceptions             |

Browser journeys cover Toronto, Shibuya, sparse results, locking/replacement/removal/remix/undo, constraint and transport recomputation, reload persistence, read-only shared-plan duplication, mobile sheet controls, missing services, cancelled stale generation, manual Explore category/map/details/add interactions, visible edit failures and preference merging. The homepage journey carries location and prompt into Create, generates a plan and reopens it from Saved. Every journey checks for uncaught browser exceptions, including hydration errors.

Unit/integration tests cover geography, provider normalization, real Responses SDK parsing with synthetic HTTP responses, rejected AI IDs, dated and overnight seven-day opening windows, future typical-hours fallback, venue timezones, DST gaps/folds, currencies, prices, anchors, eight-stop remix locks, unavailable saved stops, provider outages, save/share redaction, origin checks and production limits. Request-accounting checks prove quota exhaustion and missing production Redis stop network calls. Cancellation and whole-operation deadlines are checked against blocked HTTP attempts; telemetry checks exclude private content. External navigation preserves provider IDs, stop order and personal anchors, and is unavailable for fixtures.

`npm run test:db` creates a disposable, network-isolated Docker container without host ports, runs the repository SQL migration and checks owner, other-user and anonymous access. It covers ownership forgery, forbidden writes, private reads, share-token access/revocation, independent public snapshots and account-deletion cascades. The PostgreSQL image is pinned by digest and the container is removed afterward. This is real local SQL/RLS execution with simulated auth identities, not hosted Supabase authentication.

## Scope limits

- Google, OpenAI, hosted Supabase and Redis credentials are absent. Provider and hosted-persistence tests use explicit fixtures/mocks. Live itineraries, maps/photos, SMTP delivery, real cookie sessions and a deployed share link still need configuration and verification.
- The SQL passed local PostgreSQL checks but has not been applied to a hosted Supabase project. Verify two actual authenticated users and an anonymous session there before public release.
- Legal pages remain marked for review. Future opening hours, admissions, reservations, exact prices, dietary/accessibility compliance and live driving traffic are uncertain and labelled.
- Chromium checks do not replace real iOS/Android and screen-reader review. Editorial artwork is labelled illustration; venue photo fallbacks never pretend to depict a venue.
- No public deployment or environment publication occurred. Installation/start instructions and credential requirements are saved as a cloud environment draft; saving a draft does not apply credentials or publish it.
