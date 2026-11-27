# Put Whimway online for free: Cloudflare + Supabase

| Part | Where | Address |
| --- | --- | --- |
| The app's website | Cloudflare Workers (project root `mobile`) | `https://whimway.<your-subdomain>.workers.dev` |
| The API (planning, Google, Claude, your keys) | Supabase Edge Function `api` | `https://studvwvuoqdsevlhwofw.supabase.co/functions/v1/api/…` |
| Accounts, saved plans, shares, usage limits | Supabase database | already set up |

The site forwards `/api/*` to Supabase (`mobile/worker/index.js`), so the browser only
talks to one address.

## 1. Keys for the API (Supabase)

Supabase dashboard → project **Whimway** → **Edge Functions → Secrets** → add:

| Name | Value |
| --- | --- |
| `GOOGLE_MAPS_SERVER_KEY` | your Google Maps server key (Places API (New), Routes API, Geocoding API) |
| `ANTHROPIC_API_KEY` | your Anthropic key |

Optional: `DAILY_GUEST_GENERATIONS` (plans per person per day, default 40), and `APP_ORIGIN` if
your Cloudflare address is not `https://whimway.pages.dev`.

## 2. Let GitHub deploy the API

1. Supabase → your avatar → **Account preferences → Access Tokens** → **Generate new token** (name: `github-whimway`). Copy it.
2. GitHub → `Hearthlane/Whimway` → **Settings → Secrets and variables → Actions → New repository secret**: name `SUPABASE_ACCESS_TOKEN`, paste the token.
3. GitHub → **Actions → Deploy API to Supabase → Run workflow** (branch `guided-planner`). After that it redeploys on every push.
4. Check `https://studvwvuoqdsevlhwofw.supabase.co/functions/v1/api/status`. You want `"places":true`, `"ai":true`, `"demo":false`.

## 3. The website (Cloudflare Workers)

Cloudflare dashboard → **Compute → Workers & Pages → Create** → **Import a repository** → GitHub → `Hearthlane/Whimway`:

- **Project name:** `whimway`
- **Build command:** `npm run build:cloudflare`
- **Deploy command:** `npx wrangler deploy`
- **Advanced settings → Root directory:** `mobile`, and **Production branch:** `guided-planner`

`mobile/wrangler.jsonc` does the rest. `mobile/worker/index.js` serves the app and forwards `/api/*` to Supabase, presenting the app's canonical origin, so the site works from whatever `*.workers.dev` address Cloudflare gives it.

## 4. Sign-in emails (optional)

Supabase → Authentication:

- **URL Configuration:** set the Site URL to your Pages address.
- **Email Templates → Magic Link** (and **Confirm signup**): include `Your Whimway code is {{ .Token }}`.

## Notes

- **Free tiers:** Cloudflare Pages has unlimited static traffic, and functions get 100,000 requests a day. Supabase Edge Functions get 500,000 calls a month.
- **Pausing:** a free Supabase project pauses after a week without activity. Restore it from the dashboard.
- **Spending alerts:** set them for Google (Cloud console) and Anthropic (Console limits). Plans are capped per person per day, and the counters live in the `rate_counters` table.
