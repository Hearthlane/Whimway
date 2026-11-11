# Whimway app (iOS · Android)

React Native + Expo SDK 58 + Expo Router + TypeScript. The app is a thin, fast client:
all provider keys, AI calls, venue search, routing and validation run on the Whimway API
(the Next.js app in the repo root). The app shares pure modules with the server via
`@shared/*` → `../lib` (schema, intent interpreter, Magic Edit preview, polls, share links),
so both sides agree on every contract.

## Run it

```bash
# 1. API (repo root), demo mode needs no credentials
cd .. && npm ci && WHIMWAY_DEMO_MODE=true NEXT_PUBLIC_WHIMWAY_DEMO_MODE=true npm run dev
```

```bash
# 2. App
cd mobile && npm ci && npx expo start
```

Scan the QR code with Expo Go (iOS/Android) on the same Wi‑Fi. The app finds the API on
your computer's LAN address, port 3000. For a deployed API set `EXPO_PUBLIC_API_URL`.

Maps: iOS uses Apple Maps with no key. Android needs a Google Maps Android API key in a
development build (`react-native-maps` config plugin in `app.json`) — see
[react-native-maps setup](https://github.com/react-native-maps/react-native-maps). The web
build shows a schematic route sketch instead of map tiles.

## Screens

| Route | What it does |
| --- | --- |
| `onboarding` | Who you go with, vibes, interests, budget, transport, home area, needs, consent. Every step skippable. |
| `(tabs)/index` | “What should we do?” — free text is interpreted on device into editable chips (who, when, budget total/per person, travel, length, area, vibe, indoors). Quick poll. Ideas. Recent plans. |
| `plan/[id]` | Generation with staged progress → hero summary, route map, Plan Pulse, timeline of stop cards (hours confidence, price, why, directions, website, keep/swap, 👍/👎), Magic Edit with preview + undo, save, share, start navigation, post-outing feedback. |
| `(tabs)/saved` | Upcoming / been-there, rate past plans, plan again, delete with confirmation. |
| `(tabs)/profile` | Taste summary + what feedback taught us, optional sign-in (email code), usage-stats toggle, delete device data / account. |

## Verify

```bash
npx tsc --noEmit
```

```bash
# Web build + a full scripted journey in mobile Chromium (API must be running on :3000 in demo mode)
CI=1 EXPO_PUBLIC_SHARE_ORIGIN=http://localhost:3000 npx expo export --platform web --output-dir dist
```

```bash
node scripts/serve-web.mjs 8090 &
```

```bash
node scripts/web-journey.mjs http://localhost:8090 ./journey-shots
```

The journey script asserts: onboarding, prompt understanding (“$100 total · $50/person”),
2–4 stop plan, Magic Edit keeps untouched stops, poll + reactions + feedback reach the API,
the share link opens for a recipient without the app, and zero browser errors.
Run the API with `DAILY_GUEST_GENERATIONS=200 DAILY_REMIX_LIMIT=200` when repeating it —
otherwise the real fair-use limit (3 guest plans/day) kicks in, as designed.

## Accounts

Sign-in uses Supabase email one-time codes. In Supabase → Authentication → Email
Templates, make sure the Magic Link template includes `{{ .Token }}` so users receive a
6-digit code. The app then sends the user's access token to the API as a bearer token;
row-level security enforces ownership.

## Ship

Use EAS: `npx eas-cli@latest build --profile production` then `submit`. Bundle IDs are
`app.whimway` (iOS and Android) in `app.json` — change them to identifiers you own first.
