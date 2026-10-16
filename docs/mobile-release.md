# Native development and release

Whimway's native frontend is in `apps/mobile`. The existing Next.js app remains the provider/auth/database API and web frontend at the repository root. Mobile is React Native rendered through Expo Router, not a WebView. Both clients consume the existing Zod contracts and server planner. Independent lockfiles keep the mobile React version compatible with its SDK.

## Run on a phone

Use Node 24 and the committed lockfiles. From the repository root in PowerShell:

```powershell
npm ci
if (!(Test-Path .env.local)) { Copy-Item .env.example .env.local }
# Fill provider settings in .env.local for live planning.
npm run dev
```

For explicitly labeled synthetic development data, set these in that terminal before starting the server:

```powershell
$env:WHIMWAY_DEMO_MODE = 'true'
$env:NEXT_PUBLIC_WHIMWAY_DEMO_MODE = 'true'
npm run dev
```

In a second terminal:

```powershell
Set-Location apps/mobile
npm ci
if (!(Test-Path .env.local)) { Copy-Item .env.example .env.local }
# Set EXPO_PUBLIC_API_URL=http://YOUR_COMPUTER_LAN_IP:3000
npm start
```

Physical phones cannot reach your computer through `localhost`. Use the computer's LAN address with the phone on the same network and allow the development port through the firewall, or deploy the backend to an HTTPS staging URL. Android emulator host access usually uses `http://10.0.2.2:3000`; iOS simulator can use the Mac's localhost. A USB tunnel can forward a development port. Do not disable TLS validation.

Use a development client for the complete native app. Expo Go does not represent production mapping, notification, signing or native configuration. To compile locally, install Android Studio/SDK and JDK, then run `npm run android` from `apps/mobile`. On macOS with a supported Xcode and CocoaPods, run `npm run ios`. The current SDK requires Android 7+ (minimum API 24; targets API 36) and iOS 16.4+ / Xcode 26.4+. [Expo compatibility](https://docs.expo.dev/versions/latest/)

For browser-only layout and fixture inspection:

```powershell
Set-Location apps/mobile
$env:EXPO_PUBLIC_API_URL = 'http://localhost:8081'
npm run web
```

Keep `APP_ORIGIN` unset for local preview. Metro's development-only `/api` proxy forwards the original browser Host/Origin to the existing backend on port 3000. The browser uses its own origin, while native phones use the separate LAN backend address. The proxy is not shipped in native binaries or static exports, and production CORS is not broadened.

Web preview validates shared screen layout and API behavior. Native maps, OS dialogs, background/foreground lifecycle, haptics, Android back, iOS safe areas and native local notifications still require a device or simulator.

## Environment and provider setup

| Setting                                                             | Location                  | Requirement                                                                   |
| ------------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------- |
| `EXPO_PUBLIC_API_URL`                                               | Mobile environment        | Canonical HTTPS backend for preview/production; rebuild after changing it     |
| `GOOGLE_MAPS_ANDROID_KEY`                                           | Mobile build environment  | Maps SDK for Android enabled; restrict by package + SHA-1 signing certificate |
| `GOOGLE_MAPS_IOS_KEY`                                               | Mobile build environment  | Maps SDK for iOS enabled; restrict by the confirmed bundle identifier         |
| `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Mobile public environment | Optional native account session; database RLS must remain enabled             |
| `WHIMWAY_IOS_BUNDLE_ID` / `WHIMWAY_ANDROID_PACKAGE`                 | Mobile build environment  | Replace `com.example.whimway` before signing/store registration               |
| `EAS_PROJECT_ID`                                                    | Mobile build environment  | Real project UUID after account/project registration                          |
| Google server key, OpenAI key/model, Redis, Supabase                | Backend secrets           | See `docs/providers.md`; never put these in `EXPO_PUBLIC_*` or the app binary |
| `APP_ORIGIN`                                                        | Backend                   | Canonical web origin for browser mutation protection                          |

Mobile map keys are embedded public application credentials, so application/API restrictions and spending controls matter. Development and production signing certificates differ. Use separate server, browser, Android and iOS keys. Budget alerts are notifications; hard quotas and server attempt limits provide independent bounds. Configure staging and production as separate environments.

The database migration and RLS design remain in `supabase/migrations`. Apply it to the intended hosted project and verify ownership with two real accounts and an anonymous session. Native authentication verifies bearer sessions through Supabase Auth. Add `whimway://auth/callback` to Supabase's redirect allowlist along with the existing web callback. Magic links use PKCE: open the link on the device that requested it. Test email delivery and session recovery before claiming account sync works.

`npm run test:db` executes the real migration and 30 authorization assertions in a disposable PostgreSQL container without external ports. Current hosted CI passes ownership, anonymous access, public-share revocation and account-deletion isolation. That SQL evidence does not verify the intended hosted project's migration/configuration, email delivery or real mobile account sessions.

Do not save full provider place records as offline venue truth. Saved references are rehydrated; unavailable venues and offline reopen must present recovery. Prices, opening hours, travel time, admission, accessibility and future holiday availability remain estimates or provider-dependent information.

Destination currency uses pinned CLDR territory data covering 255 codes, with provenance/license in `lib/providers/currency-data.ts` and its accompanying license. Multi-currency territories use the recorded first active tender. Missing or unknown country metadata returns an actionable error instead of silently using USD. Confirm the displayed currency and use the optional planning details sheet's three-letter field when necessary. Changing the code does not convert amounts; check the per-person budget again. Provider price ranges with a different currency remain unknown. Live provider geography and prices still require validation.

## EAS build profiles and signing

Run from `apps/mobile` after confirming app identifiers and the Expo project:

```powershell
npx eas-cli@latest login
npx eas-cli@latest init
npx eas-cli@latest build:configure
npx eas-cli@latest build --profile development --platform android
npx eas-cli@latest build --profile development --platform ios
npx eas-cli@latest build --profile preview --platform all
npx eas-cli@latest build --profile production --platform all
```

These are account-dependent remote builds and may incur service use. `development` includes the development client; `preview` is internal distribution with an Android APK; `production` increments store versions and produces store binaries. `eas.json` contains these profiles. Set `EXPO_PUBLIC_API_URL`, platform maps keys and public Supabase configuration separately in each selected EAS environment. Ensure production targets live APIs; development fixtures are server-disabled in production.

EAS can manage credentials. For iOS device installs, the account needs Apple Developer membership, signing certificates, provisioning profiles and registered devices for internal distribution. For Android, create/retain the upload keystore and record the signing SHA-1, including the eventual Play App Signing certificate for map restrictions. Keep signing secrets in managed credentials or protected secret storage, never Git. Remote versioning uses EAS; confirm current store build numbers before uploading.

The default identifiers are intentional placeholders and must be replaced before any store record or signing association is created. Changing them later creates a different app identity. Do not run submission without explicit release authorization. Source export and generated native configuration are not installable binary proof, store approval or policy acceptance.

## Navigation capability

Day Mode provides an in-app map, real provider route preview, next-stop progress and foreground location-to-stop routing when permissions/services are configured. It does not provide spoken maneuvers or full turn-by-turn. Google Navigation RN `0.17.3` requires RN 0.87+, while Expo 57 uses RN 0.86.3. Version `0.16.3` advertises RN 0.79+, so RN alone does not rule it out. Its iOS GoogleMaps 10.13.0 dependency conflicts with the installed RNMaps/Utils 9.x constraints; Android coexistence requires excluding duplicate Maps classes and native validation. Full navigation is unavailable on the current stack. An older-SDK option would require a map-stack migration and real build/device checks, detailed in [the compatibility audit](mobile-audit.md#native-stack-and-navigation-decision). [0.16.3 requirements](https://raw.githubusercontent.com/googlemaps/react-native-navigation-sdk/v0.16.3/README.md)

Enabling a future integration requires platform API credentials, current billing/terms review, native build configuration, terms acceptance UI, arrival/reroute/restart tests and a low-distraction driving layout. Route-destination requests have their own Navigation Request billing; check current quotas and agreement. [Billing](https://developers.google.com/maps/documentation/navigation/android-sdk/pricing), [Android policy](https://developers.google.com/maps/documentation/navigation/android-sdk/policies), [iOS policy](https://developers.google.com/maps/documentation/navigation/ios-sdk/policies)

## Privacy, store copy and review

Before public release, replace the existing marked legal drafts with approved public terms/privacy URLs and review Maps/Places usage and attribution. Do not cover built-in map attribution with sheets. Attribute provider photos and keep illustrations distinguishable. The app requests foreground location for Near me/active outing; there is no justified background-location feature. Reminders are local and opt-in after seeing a plan; the OS may delay delivery. Review each store's current disclosure forms against the final binary and services, including location sent for place lookup/routing, optional account email, prompts/preferences, saved plans, public share snapshots and anonymous usage/provider-count telemetry. Do not infer no collection merely because data is not used for advertising.

Before live planning, confirm the account's agreement and billing-region terms permit the existing Places-derived context sent to OpenAI for selection. Review the caching/content restrictions and applicable service exceptions; this audit does not conclude that all inference is prohibited. Setting `store:false` on AI responses does not establish Google licensing permission or zero retention. Keep reference-only persistence, no persistent provider-response cache and no-store photos, including expiring photo names and required attribution. [Google Maps terms §3.2.3](https://cloud.google.com/maps-platform/terms), [service terms §10 and §14.3](https://cloud.google.com/maps-platform/terms/maps-service-terms), [Place Photos rules](https://developers.google.com/maps/documentation/places/web-service/place-photos)

Audit included SDK privacy manifests, required-reason declarations and actual permission lists in the generated native projects. Verify the non-exempt-encryption declaration against the final dependency set and distribution. Document data retention/deletion and test account/device deletion. No advertising tracking is implemented; do not add tracking or unrelated permissions as a release shortcut.

The local diagnostic report retains at most 30 allowlisted recent error entries plus app/build/platform metadata. It excludes prompt/plan content, venue identifiers, coordinates, email and tokens, has an explicit clear action, and is sent only when the user invokes the native Share action. It is not automatic remote error collection. Review the final text and receiving support process before any future remote reporting is introduced.

Prepare screenshots from real device/simulator builds, including Explore, adaptive planning, results, Day Mode, Saved and Profile. Capture current required App Store/Play sizes from the store consoles when preparing submission. Use real live-provider data only after credentials and content rights are verified; do not label fixture screenshots as live functionality. Keep the coral winding-W icon and warm splash from `apps/mobile/assets`.

## Validation commands and release gate

From the root:

```powershell
npm ci --prefix apps/mobile
npm run typecheck
npm run lint
npm test
npx playwright install chromium
npm run test:e2e
npm run test:e2e:mobile
npm run build
```

From `apps/mobile`:

```powershell
npm run typecheck
npx expo install --check
npx expo-doctor@latest
npm run export
npx expo config --type public
npm run release:check
```

Application source is `1d8b8877a932395fd0f8d692eaa064382d623ec3` (Expo 57.0.30 / Router 57.0.28 / RN 0.86.3), verified with harness `110801f2c99a9e529bd459f571b7ecc6858b0d74`. [Full hosted quality](https://github.com/Hearthlane/Whimway/actions/runs/38832567624) passes 612 tests/34 files, SQL 30, types/lint/Next/online alignment, 58-asset exports (web 5.7/iOS 8.0/Android 8.2 MB), retained web 16/16 (1.4 minutes) and RN Web 47/47 (3.2 minutes). [Current Android native checks](https://github.com/Hearthlane/Whimway/actions/runs/38832567637) pass all four scopes: main, reminders, OS fontScale 2.0 and standalone Release. Both platforms compile; iOS Release installs/launches cleanly. Current iOS journeys remain unverified because fresh Simulator identity reads time out before Maestro, including bounded recovery; high host load is recorded. No product assertion or native Keychain call executes in that run. Live providers, iOS journey verification on a healthy target, physical-device performance/assistive checks, signing and legal approval remain release gates.

The gesture broker consumes a fresh observation identity before dispatch while the viewport observer remains read-only. Historical f17 records 18 actual native HTTP-200 gestures inside their live panes, including the real largest-type Adjust tap; its separate driver bootstrap and Sheet-scroll failures remain failures. Official Maestro/Graal fault tests independently show one native POST for an injected HTTP 408, versus two on the preceding direct transport. This is simulated transport proof, not a new OS journey or Keychain result. [Compact transport proof](validation/maestro-2.11-gesture-transport/README.md).

<details>
<summary>Earlier source-qualified native validation history</summary>

The preceding [ad9 native replay](https://github.com/Hearthlane/Whimway/actions/runs/38801586211) preserves e1db62b binaries: Android Release passes 29 commands; iOS Release launch, UI-ready 28/4 and all three Keychain booleans pass. All three fixture scopes on each platform stop before execution at `scroll-ios-plan.yaml:7:3`; no observer snapshot or new product failure is established. Actual official Maestro 2.11 conversion identifies eager parsing of `${output.whimwayPlanViewport.swipe.start}` as the nested numeric-conversion failure, while the shallow syntax command falsely reports OK. The corrected twelve graphs now convert before compilation. The observer stays read-only; gestures use the same XCTest driver’s native swipe endpoint, and real Maestro tap points are rounded and checked again for full containment. Native replay remains required. [Compact official parser proof](validation/maestro-2.11-parser/README.md).

The short-lived [f53 quality run 38802382841](https://github.com/Hearthlane/Whimway/actions/runs/38802382841) passes 459 tests/29 files, 30 SQL assertions, types/lint/Next, 58-asset exports, retained web 16/16 in 1.7 minutes and RN Web 42/42 in 3.5 minutes. That run checked installed-SDK compatibility offline, not remote patch recency. Source 298 restored the online check after the supported patch install. The duplicate f53 native run was deliberately cancelled after Android entered compilation; it retains no artifact or native verdict.

The source-preserving [52a48b6 native replay](https://github.com/Hearthlane/Whimway/actions/runs/38742724011) closes the preceding e923 normal iOS main flow, including actual Saved activation and process-restored 1 DONE (208 completed, 11 skipped, two optional denial warnings). All three native Keychain probe booleans are true, with `complete/verified` diagnostics. Its independent reminder retry stops before the fixture-switch tap when centering cannot finish at the content edge; largest type reaches Start, then a covered Adjust tap leaves the sheet unopened. Those failures preceded later viewport and selection corrections; new-source OS checks remain separate. The prior e923 run separately passed reminder scheduling/cancellation.

Preceding app `fb4164400a5e01f35750af728a411b0c51e13dff` fixes direct-entry Back/cancel recovery. [Native 38673383523](https://github.com/Hearthlane/Whimway/actions/runs/38673383523) passes all four Android scopes and iOS Release launch for that app; Debug startup/Saved/input checks fail before complete fixtures/Keychain verification. The later harness-only retry was intentionally cancelled for changed product `e923e9c`, with partial diagnostics retained and no full verdict. Exact source, compiler lineage, scopes and failures are in [mobile-checklist.md](mobile-checklist.md).

The preceding `8eb5c6c` harness verifies actual reset-snapshot classification and strict modern Hermes-target discovery while preserving mobile source `fb41644`. Android reset/runtime verification passes; that iOS probe stops at UI readiness before a native Keychain call. The e923 replay confirms host warm-up, startup and initial local Saved readiness. Its later 52a48b6 replay verifies normal process restore and native Keychain calls; independent centering/covered-control retries remain separate from preceding e1db62b native layout verification.

The historical `4600343` helper centers the real iOS fixture switch, taps only when OFF and requires an ON assertion/capture. Its queued run was cancelled without artifacts. Later fb41644/8eb run 38673383523 verified ON states but stopped iOS fixture flows at Search focus. Those outcomes describe that earlier source, not e923, where functional search and generation pass. GitHub automatically cancelled [38671619587](https://github.com/Hearthlane/Whimway/actions/runs/38671619587) while both platform jobs were pending, with no artifacts or executed failure. The observed edge-position risk is not evidence of an already-ON inversion.

The retained c405 baseline failed reminder cancellation and the iOS system-link helper. Source 992 subsequently passed Android cancellation and entered the iOS project, where selector, Keychain and largest-type findings drove the current repair. Historical captures/recordings and exact failure scopes remain in the checklist; they do not establish the current source's behavior.

Historical app `3573014` iOS Release installs and launches after genuine Xcode Simulator XML/DER embedding and the narrow identity-guard repair. Its retained Debug compiler/signature evidence passes, while actual Keychain read/write and complete fixture/large-type flows remain unverified. Preceding `fb41644` also has a fresh Release compile/install/launch; complete iOS Debug reports fail at startup, Saved and input checks. Its harness adds a bounded UI-ready startup before the diagnostic probe, centered/focused input and allowlisted probe-stage diagnostics; these source checks do not prove OS success. Original compiler archives remain intact, and Simulator preparation is separate from developer/store signing. WebKit explicitly distinguishes Simulator embedding from device signing. [WebKit Simulator handling](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/PlatformCocoa.cmake)

</details>

The hosted native build-check mode uses a placeholder HTTPS backend and compiles the real Google iOS adapter without injecting a fake Maps key. Its runtime declares native maps unavailable. This mode is rejected by `release:check`, and its test identifiers/signing are not public-distribution configuration. Development-client journeys load Metro with localhost ports forwarded to the runner and explicitly labeled fixtures; production HTTP/fixture guards stay active. See [native flow instructions](../e2e-native/README.md) for exact parameters and the remaining manual OS/provider checks.

Before iOS UI checks, the guarded CI [bundle-preparation helper](../e2e-native/helpers/warm-ios-bundle.mjs) drains the exact observed loopback development bundle under a six-minute deadline. It requires HTTP 200, an accepted bundle type, a bounded nonempty body and format validation without executing downloaded code; retained evidence contains timing, status, byte count and hash. This prepares Metro's cache, not the app's state. The actual UI-readiness and native Keychain checks still determine runtime success.

iOS fixture entry requires an English software keyboard, its actual delete key and Done bar, the entered Toronto query above the keyboard, and the exact fixture search result. The accessibility focus flag alone is insufficient. After entering the real Toronto query, the iOS helper explicitly dismisses the software keyboard and re-finds the actual fixture result before selecting it. Profile Save keeps centered pre-tap captures. Empty-budget validation and successful-save assertions remain required.

Android runs the large-text layout flow with real OS `font_scale=2.0`; iOS selects its largest accessibility content-size category. Both record the setting and restore the default afterward. A selected setting or authored flow is not a pass without successful reports and reviewed captures. These checks do not exercise VoiceOver or TalkBack.

The Android runner retains separate Debug and standalone Release diagnostics. After all Debug fixture flows, it replaces the app only on the disposable CI emulator and probes guest Explore/Profile/Saved through `release-launch.yaml`, including absence of fixture controls. It records Activity cold-launch timing (`am start -W`), frame samples and process memory. Activity launch time is not JavaScript time-to-interactive. These software-emulator observations do not establish physical-device frame rate, battery use or haptics; Debug and Release workloads differ. [Android dumpsys reference](https://developer.android.com/tools/dumpsys)

The native-screen browser suite builds an official `expo export --dev --platform web` artifact in the ignored `apps/mobile/dist-qa` directory, then serves it at `http://127.0.0.1:8082` with a local same-origin API proxy. This retains the source's development-only fixture toggle and avoids repeated Metro development-bundle downloads. Run `node scripts/serve-mobile-preview.mjs --build` to inspect the same artifact manually. The server binds only to localhost and is QA tooling, not a deployment server. Production exports keep `__DEV__` false and do not expose the fixture switch.

Root and mobile Playwright suites use separate `test-results` and `test-results-mobile` directories. Run the commands sequentially in CI. Browser checks cover UI/API contracts and local persistence; they do not measure native startup, map rendering or animation performance.

When inspecting an already running static QA server locally, restart it with `--build` after source edits; it serves an export rather than hot reloading. Repeated local regression runs can exhaust the fixture backend's real read/write quotas. Restart the local fixture backend for a fresh run; production limits and request identities must remain intact. CI starts fresh managed servers.

`release:check` fails intentionally until the HTTPS API URL, app identifiers, Maps SDK keys and Expo project ID are supplied. It checks configuration presence/shape and production version increments, not live service access, actual identifier ownership, legal review or store approval. Legal/privacy, signed-device and provider verification remain separate gates. Both root and mobile dependencies must be installed before the full test suite because the decoder regression verifies the real installed query-string dependency.

The local API returned HTTP 200 at 01:12 UTC on 16 October 2026 with `places/maps/ai/cloud=false`, `demo=true` and no signed-in user. Neither root nor mobile `.env.local` exists. The release gate correctly rejects the missing production API URL, native Maps keys, EAS project UUID and confirmed app identifiers, including the unconfirmed default identifier. The reachable preview is synthetic; no credentials or live integration are implied. These external configuration checks are separate from remaining native fixture verification.

See `docs/dependency-advisories.md` for the current security audit. A scoped Xcode UUID override and a provenance-pinned CommonJS adapter of the patched URI decoder address their advisories; unpatched braces/Forge build-tool dependencies remain visible. Do not treat the production backend's zero-advisory result as a clean mobile dependency result.

Run journeys A–G from that checklist on Android and iOS before release. Include OS permission grant/deny/revoke, cold/warm deep links, airplane mode, process death, large text, reduced motion and screen-reader interaction. Test on representative 360 × 800, 390 × 844 and 430 × 932 phone layouts plus a small phone. An installed emulator/simulator build can establish the recorded native test behavior; signed physical-device distribution and store readiness remain separate checks.

The iOS scope runner retains a failed scope as failed, captures bounded failure-time diagnostics and fences the exact selected-simulator Maestro/XCTest process identities before starting another scope. It does not retry failed app assertions or increase timeouts to hide startup failures. The Saved-reopen check waits up to 115 seconds for actual `YOUR GOOD DAY`, no pending-opening controls and the real timeline, then still requires a genuine Start and restored 1 DONE. This accommodates the API’s 105-second bound without treating a pending Saved frame as successful hydration.
