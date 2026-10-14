# Native development and release

Whimway's native frontend is in `apps/mobile`. The existing Next.js app remains the provider/auth/database API and web frontend at the repository root. Mobile is React Native rendered through Expo Router, not a WebView. Both clients consume the existing Zod contracts and server planner. Independent lockfiles keep the mobile React version compatible with its SDK.

## Run on a phone

Use Node 24 and the committed lockfiles. From the repository root in PowerShell:

```powershell
npm ci
Copy-Item .env.example .env.local
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
Copy-Item .env.example .env.local
# Set EXPO_PUBLIC_API_URL=http://YOUR_COMPUTER_LAN_IP:3000
npm start
```

Physical phones cannot reach your computer through `localhost`. Use the computer's LAN address with the phone on the same network and allow the development port through the firewall, or deploy the backend to an HTTPS staging URL. Android emulator host access usually uses `http://10.0.2.2:3000`; iOS simulator can use the Mac's localhost. A USB tunnel can forward a development port. Do not disable TLS validation.

Use a development client for the complete native app. Expo Go does not represent production mapping, notification, signing or native configuration. To compile locally, install Android Studio/SDK and JDK, then run `npm run android` from `apps/mobile`. On macOS with a supported Xcode and CocoaPods, run `npm run ios`. The current SDK requires Android 7+ / API 36 and iOS 16.4+ / Xcode 26.4+. [Expo compatibility](https://docs.expo.dev/versions/latest/)

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

Do not save full provider place records as offline venue truth. Saved references are rehydrated; unavailable venues and offline reopen must present recovery. Prices, opening hours, travel time, admission, accessibility and future holiday availability remain estimates or provider-dependent information.

Destination currency is inferred from the existing common-country table and defaults to USD for country codes outside it. Confirm the displayed currency and use the optional planning details sheet's three-letter currency field when necessary. Changing the code does not convert amounts; check the per-person budget again. Provider price ranges with a different currency are rejected and shown as unknown, avoiding false totals. Expand/verify country coverage before claiming worldwide currency accuracy.

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

Day Mode provides an in-app map, real provider route preview, next-stop progress and foreground location-to-stop routing when permissions/services are configured. It does not provide spoken maneuvers or full turn-by-turn. Google Navigation RN `0.17.3` requires RN 0.87+, while this compatible Expo 57 app uses RN 0.86.3. The earlier `0.16.3` suggestion is not treated as proven without builds and device tests. [Official beta integration](https://github.com/googlemaps/react-native-navigation-sdk)

Enabling a future integration requires platform API credentials, current billing/terms review, native build configuration, terms acceptance UI, arrival/reroute/restart tests and a low-distraction driving layout. Route-destination requests have their own Navigation Request billing; check current quotas and agreement. [Billing](https://developers.google.com/maps/documentation/navigation/android-sdk/pricing), [Android policy](https://developers.google.com/maps/documentation/navigation/android-sdk/policies), [iOS policy](https://developers.google.com/maps/documentation/navigation/ios-sdk/policies)

## Privacy, store copy and review

Before public release, replace the existing marked legal drafts with approved public terms/privacy URLs and review Maps/Places usage and attribution. Do not cover built-in map attribution with sheets. Attribute provider photos and keep illustrations distinguishable. The app requests foreground location for Near me/active outing; there is no justified background-location feature. Reminders are local and opt-in after seeing a plan; the OS may delay delivery. Review each store's current disclosure forms against the final binary and services, including location sent for place lookup/routing, optional account email, prompts/preferences, saved plans, public share snapshots and anonymous usage/provider-count telemetry. Do not infer no collection merely because data is not used for advertising.

Audit included SDK privacy manifests, required-reason declarations and actual permission lists in the generated native projects. Verify the non-exempt-encryption declaration against the final dependency set and distribution. Document data retention/deletion and test account/device deletion. No advertising tracking is implemented; do not add tracking or unrelated permissions as a release shortcut.

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

The GitHub workflow checks contracts, security/planner tests, web regressions, SDK alignment and all-platform JavaScript export. CI upload is an inspectable JavaScript artifact, not an APK/IPA. Final evidence and unresolved checks are maintained in `docs/mobile-checklist.md`.

The native-screen browser suite builds an official `expo export --dev --platform web` artifact in the ignored `apps/mobile/dist-qa` directory, then serves it at `http://127.0.0.1:8082` with a local same-origin API proxy. This retains the source's development-only fixture toggle and avoids repeated Metro development-bundle downloads. Run `node scripts/serve-mobile-preview.mjs --build` to inspect the same artifact manually. The server binds only to localhost and is QA tooling, not a deployment server. Production exports keep `__DEV__` false and do not expose the fixture switch.

Root and mobile Playwright suites use separate `test-results` and `test-results-mobile` directories. Run the commands sequentially in CI. Browser checks cover UI/API contracts and local persistence; they do not measure native startup, map rendering or animation performance.

When inspecting an already running static QA server locally, restart it with `--build` after source edits; it serves an export rather than hot reloading. Repeated local regression runs can exhaust the fixture backend's real read/write quotas. Restart the local fixture backend for a fresh run; production limits and request identities must remain intact. CI starts fresh managed servers.

`release:check` fails intentionally until the HTTPS API URL, app identifiers, Maps SDK keys and Expo project ID are supplied. It checks configuration presence/shape and production version increments, not live service access, actual identifier ownership, legal review or store approval. Legal/privacy, signed-device and provider verification remain separate gates. Both root and mobile dependencies must be installed before the full test suite because the decoder regression verifies the real installed query-string dependency.

See `docs/dependency-advisories.md` for the current security audit. A scoped Xcode UUID override and a provenance-pinned CommonJS adapter of the patched URI decoder address their advisories; unpatched braces/Forge build-tool dependencies remain visible. Do not treat the production backend's zero-advisory result as a clean mobile dependency result.

Run journeys A–G from that checklist on Android and iOS before release. Include OS permission grant/deny/revoke, cold/warm deep links, airplane mode, process death, large text, reduced motion and screen-reader interaction. Test on representative 360 × 800, 390 × 844 and 430 × 932 phone layouts plus a small phone. Only a successfully installed, exercised signed build can close a native build/device check.
