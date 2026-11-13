# How Whimway makes money

Everything here is a hypothesis to test in the beta, not validated demand. The dashboard
at `/admin` and `docs/metrics.sql` measure each one.

## The model: freemium subscription first, booking referrals second

| Line                  | What                                                          | Status                                                                                                           |
| --------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Whimway Plus**      | Subscription that removes limits and adds depth               | Built as a demo entitlement (no payment taken)                                                                   |
| **Booking referrals** | Commission when a plan leads to a reservation, ticket or ride | Hand-off links built and tracked; no partner agreements yet                                                      |
| Sponsored placement   | Venues paying to be recommended                               | **Deliberately not doing this.** The product's value is trust in the recommendation; paid ranking would spend it |

### Whimway Plus

|                                    | Free       | Plus      |
| ---------------------------------- | ---------- | --------- |
| Plans                              | 5 a month  | Unlimited |
| Magic Edits                        | 3 per plan | Unlimited |
| Save, share, maps, polls, feedback | Yes        | Yes       |
| Plan around a saved favourite      | —          | Yes       |
| Fine-tune: pace, alcohol-free      | —          | Yes       |
| Surprise mode                      | —          | Yes       |

Test prices: **$6.99 CAD a month** or **$39.99 CAD a year** (about 52% off), with a
7-day free trial. Constants live in `lib/plus.ts`.

Why this shape:

- **The core loop is never paywalled.** A free user can still go from a sentence to a
  real night out, save it and share it. Shared plans are the growth loop, so they stay free.
- **The limit is on volume, not on trying it.** Five plans a month covers a casual user;
  couples and friend groups who plan weekly hit it, and they are the ones getting value.
- **Each paid feature has its own paywall moment** (out of plans, out of edits, plan
  around a favourite, fine-tune, surprise), shown when the user reaches for it, plus one
  skippable offer after onboarding. The `reason` on `paywall_viewed` shows which moment converts.
- **Yearly is the default selection**: better retention and cash up front.

### Booking referrals

Each stop has a "Book or go" sheet (`lib/booking.ts`): find a table (OpenTable search),
tickets and admission (the venue's own site), venue website, directions, and a ride
(Uber). They are honest hand-offs: nothing is reserved and availability is never claimed.
Every tap is tracked as `booking_link_opened` / `navigation_opened` with its `kind`.

Links marked `partner` are where a referral code goes once agreements exist. Realistic
order: affiliate programmes that accept small apps first (ticketing and experiences
marketplaces, ride-hailing referral credits), then restaurant reservation partners,
which usually need volume first. Booking-tap volume from the dashboard is the evidence
to bring to those conversations.

## What to watch

| Question                             | Metric                                                  | Where                                 |
| ------------------------------------ | ------------------------------------------------------- | ------------------------------------- |
| Do people get value?                 | Went-on-the-plan rate, repeat planning in 7 and 30 days | `/admin` tiles                        |
| Will they pay?                       | Paywall views → Plus starts, by `reason`                | `/admin`, `docs/metrics.sql`          |
| Is the free limit right?             | Share of users hitting 5 plans a month                  | `paywall_viewed` with `reason: limit` |
| Is booking a business?               | Booking taps per plan, by kind                          | `/admin` "how people book"            |
| Does a plan cost less than it earns? | Google + OpenAI calls and tokens per plan               | server `plan_generated` logs          |

Rough unit economics to validate: a live plan costs a few cents in Google Places, Routes
and model calls (the server logs the exact call counts and tokens per plan). A weekly
planner on the yearly price pays about $3.33 a month, so cost per plan must stay well
under that divided by their monthly plans. Free users are capped at five plans a month,
which bounds the cost of acquisition.

## What is built for billing, and what still needs you

Built and tested:

- **Server-enforced allowance.** `/api/generate` counts plans per account (per install for
  guests) and returns `402 PLAN_LIMIT` after the free five; the app sends people to the
  paywall. Usage lives in Postgres (`plan_usage`), so reinstalling does not reset a signed-in account.
- **Server-side entitlement.** `GET /api/entitlement` is the source of truth. The app syncs
  it at sign-in and from "Restore purchases". Nobody can grant themselves Plus: the
  `entitlements` table is read-only to its owner.
- **Billing webhook.** `POST /api/webhooks/billing` accepts RevenueCat-format events,
  authenticated with `BILLING_WEBHOOK_SECRET`. Purchases, renewals and plan changes grant
  Plus until the expiry date; cancellation keeps access until then; expiration removes it.
- **Demo purchases** are honoured only where demo mode is on, never in production.
- **Paywall requirements**: auto-renewal disclosure, Restore purchases, Terms and Privacy links.

Still needs your accounts (about a day of setup, no more code beyond step 3):

1. **Apple Developer and Google Play accounts**, with two subscription products in each
   (`plus_monthly`, `plus_yearly`) and a 7-day free trial; banking and tax forms.
2. **A RevenueCat project** linked to both stores. Set its webhook URL to
   `https://<your-api>/api/webhooks/billing` with an Authorization header of
   `Bearer <secret>`; put the same secret in `BILLING_WEBHOOK_SECRET` and store its hash
   in the database (the SQL is at the top of `supabase/migrations/202611140001_entitlements.sql`).
   Use the Supabase user id as the RevenueCat app user id.
3. **The purchase call in the app**: add `react-native-purchases`, and replace the demo
   `start()` in `mobile/src/app/plus.tsx` with its purchase call (a development build is
   required; it does not run in Expo Go). Purchases need a signed-in account so the
   entitlement can follow the person.
4. **Partner agreements** before adding any referral codes to booking links.

Known limit: guests are counted per install, which a determined person can reset by
reinstalling; the daily per-network cap still applies. Signed-in accounts are counted
per account. Magic Edit limits (3 per plan on free) are enforced on the server the same way.
