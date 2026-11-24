# Put Whimway online with Vercel

Whimway goes online as **two Vercel projects from this one repository**:

| Project | Folder | What it is | Address (example) |
| --- | --- | --- | --- |
| `whimway-api` | repository root | The Next.js API, the share pages and all the secret keys | `https://whimway-api.vercel.app` |
| `whimway` | `mobile` | The app's website, the one you open on your phone and PC | `https://whimway.vercel.app` |

The app site forwards every `/api/...` call to the API project (`mobile/api/proxy.js`), so
the browser only ever talks to one address, exactly like the local preview.

Vercel may give a project a slightly different address if the name is taken. Use the real
addresses wherever this guide says `API_ADDRESS` and `APP_ADDRESS`.

## Before you start

- A free Vercel account (sign up at vercel.com with GitHub, and allow it to see `Hearthlane/Whimway`).
- Your keys, ready to paste:
  - **Google Maps server key**: Google Cloud console → APIs & Services → Credentials. It needs Places API (New), Routes API and Geocoding API enabled.
  - **Anthropic API key**: console.anthropic.com → API Keys (with credit on the account).
- A **shared secret**: any long random string of 24+ letters and numbers that you make up. You paste the same value into both projects. It lets the API trust the visitor address the app site passes on.

## 1. Create the API project (`whimway-api`)

1. Vercel → **Add New… → Project** → import `Hearthlane/Whimway`.
2. **Project name:** `whimway-api`. **Framework:** Next.js. **Root directory:** leave as the repository root.
3. **Environment variables:**

   | Name | Value |
   | --- | --- |
   | `GOOGLE_MAPS_SERVER_KEY` | your Google Maps server key |
   | `ANTHROPIC_API_KEY` | your Anthropic key |
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://studvwvuoqdsevlhwofw.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_7iDjquzMnUJ6K4x6YGs8YQ_S4MFgTwP` |
   | `WHIMWAY_PROXY_SECRET` | your shared secret |
   | `APP_ORIGIN` | `APP_ADDRESS` (fill in after step 2, then redeploy) |
   | `DAILY_GUEST_GENERATIONS` | `20` (plans per person per day while you test; the default is 3) |

4. **Deploy.** Then: project → **Storage → Create / Connect Database → Upstash (Redis)**, free plan, connect it to `whimway-api`. This adds the Redis settings automatically. Production refuses to plan without it, because it protects your keys from overuse.
5. **Redeploy** (Deployments → ⋯ → Redeploy) so it picks up Redis.
6. Check: open `API_ADDRESS/api/status`. You want `"places":true`, `"ai":true`, `"demo":false`.

## 2. Create the app project (`whimway`)

1. Vercel → **Add New… → Project** → import `Hearthlane/Whimway` again.
2. **Project name:** `whimway`. **Root directory:** `mobile`. **Framework:** Other. `mobile/vercel.json` sets the build.
3. **Environment variables:**

   | Name | Value |
   | --- | --- |
   | `WHIMWAY_API_ORIGIN` | `API_ADDRESS` |
   | `WHIMWAY_PROXY_SECRET` | the same shared secret |
   | `EXPO_PUBLIC_SUPABASE_URL` | `https://studvwvuoqdsevlhwofw.supabase.co` |
   | `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_7iDjquzMnUJ6K4x6YGs8YQ_S4MFgTwP` |
   | `EXPO_PUBLIC_SHARE_ORIGIN` | `API_ADDRESS` (share links open the API's share pages) |

4. **Deploy.**
5. Go back to `whimway-api`, set `APP_ORIGIN` to `APP_ADDRESS`, and redeploy it.

## 3. Which branch

Until the pull request is merged, the work lives on `guided-planner`. In **both** projects:
**Settings → Git → Production Branch → `guided-planner`**, then redeploy. After merging, set it
back to `main`.

## 4. Sign-in emails (optional)

Supabase → Authentication:

- **URL Configuration:** set the Site URL to `APP_ADDRESS`, and add `APP_ADDRESS` and `API_ADDRESS/auth/callback` to the Redirect URLs.
- **Email Templates → Magic Link** (and **Confirm signup**): include `Your Whimway code is {{ .Token }}` so people get the 6-digit code the app asks for.

## 5. Try it

Open `APP_ADDRESS` on your phone and your computer. You should see onboarding, then Home. Make
a plan: it should be built from real places, planned by Claude.

If something fails, the app shows the reason. For more detail, open the project in Vercel →
**Logs**.

## Costs and safety

- **Google:** each plan makes a handful of Places/Routes calls, cached for 15 minutes. Set a budget alert and quota in Google Cloud.
- **Anthropic:** Claude Haiku costs a fraction of a cent per plan. Set a spend limit in the Console.
- **Usage caps:** per-person daily limits (`DAILY_GUEST_GENERATIONS`) and a site-wide cap (`GLOBAL_DAILY_PROVIDER_LIMIT`, default 300) stop a public link from running up a bill.
- **Keys:** they stay in the `whimway-api` project. The app site holds only the public Supabase key and the shared secret.
