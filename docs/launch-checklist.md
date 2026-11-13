# Launch checklist

Everything in the code is done. These are the steps that need an account in your name.
Run `npm run check-setup` at any point to see what is connected and working.

## 1. Turn on real places and AI (about an hour)

1. **OpenAI.** Sign in at platform.openai.com → API keys → Create new secret key (it
   starts with `sk-`). Add a payment method and set a monthly spend limit.
   Set `WHIMWAY_OPENAI_KEY` and `WHIMWAY_OPENAI_MODEL` (any current model that supports Structured Outputs).
2. **Google Maps.** In console.cloud.google.com create a project, attach billing, and
   enable **Places API (New)**, **Routes API**, **Geocoding API** and **Maps JavaScript API**.
   Create a server key restricted to the first three → `GOOGLE_MAPS_SERVER_KEY`.
   Create a browser key restricted to your website → `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`.
   Set a daily quota and a budget alert.

## 2. Accounts and saved data (about an hour)

1. Create a project at supabase.com.
2. SQL Editor: run the six files in `supabase/migrations/` in name order.
3. Authentication → Providers: enable Email. Email Templates → Magic Link: include `{{ .Token }}` so people get a 6-digit code.
4. Copy the project URL and publishable key into `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (server) and `EXPO_PUBLIC_SUPABASE_URL` and
   `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (app).

## 3. Put the server online (about an hour)

1. Import the GitHub repo at vercel.com (Next.js preset).
2. Add every variable from `.env.example`, including `ADMIN_KEY` (any long random text) and `APP_ORIGIN` (your site address).
3. Create a free Upstash Redis database and add its two values. Planning is refused in production without it.
4. Open `https://<your-site>/api/status`. `places`, `ai` and `cloud` should all be `true`.

## 4. Check real plans

Make ten plans for nights you would actually go on. Check that venues are open, the
route makes sense and prices look right. This is the first time the live AI runs, so
expect to adjust prompts.

## 5. Phones (a few days, mostly waiting on Apple)

1. Accounts: Apple Developer (US$99 a year), Google Play (US$25 once), Expo (free).
2. In `mobile/eas.json` set `EXPO_PUBLIC_API_URL` to your site. In `mobile/app.config.ts` change `app.whimway` to an identifier you own.
3. Add a Google Maps **Android** key as the EAS secret `GOOGLE_MAPS_ANDROID_KEY`.
4. `cd mobile && npx eas-cli@latest build --profile preview --platform all`, then install through TestFlight and Play internal testing.
5. On a real phone check: maps, location prompt, share sheet, haptics, sign-in by email code, the keyboard on the composer.

## 6. Payments (about a day)

Follow "What is built for billing, and what still needs you" in `docs/monetization.md`.

## 7. Legal

`/privacy` and `/terms` are drafts. Add your company name, contact address and
governing law, and have them reviewed. Both stores require final versions.

## 8. Beta, then stores

Invite 30–50 couples and friend groups in Toronto. Watch `/admin`: do they go on the
plans, and do they come back within a week? Then submit using `docs/store-listing.md`
and the screenshots in `mobile/store/`.
