# Sponsored placements

Whimway is free and paid for by local businesses through clearly labelled sponsored
placements. This page explains how they work and how to run one.

## Rules the code enforces

- **Labelled, separate, rare.** A placement always shows "Sponsored" and the business
  name. It sits in its own slot, never inside a plan and never in organic ranking. At
  most one appears on a surface: the home screen, or after the third Discover result.
- **Relevant.** It is shown only inside the campaign's area (centre and radius). If it
  lists categories (`mexican`, `games`, …), it appears in Discover only when someone is
  browsing one of them.
- **Nothing by default.** There are no built-in advertisers. Until you create a
  campaign, nothing sponsored is shown anywhere.
- **Honest counts.** Views and taps are counted once per network per day, so refreshes
  and rotated install ids cannot inflate them. People on the same network count once,
  which slightly undercounts busy shared Wi-Fi.
- **Safe links.** Campaign links must use `https://`. The server never fetches them; the
  app opens them in the browser when someone taps.

## Running a campaign

All admin calls need the `x-admin-key` header set to your `ADMIN_KEY`. The key is never
accepted in the URL. Use HTTPS in production.

**Create**

```bash
curl -X POST "$APP_ORIGIN/api/admin/campaigns" -H "Origin: $APP_ORIGIN" -H "Content-Type: application/json" -H "x-admin-key: $ADMIN_KEY" -d '{"business":{"name":"Example Tacos","category":"mexican restaurant"},"headline":"Two-for-one tacos on Tuesdays","body":"Five minutes from Kensington Market.","cta":"See the menu","url":"https://example.com","area":{"center":{"lat":43.6545,"lng":-79.4006},"radius":3000},"categories":["mexican"],"surfaces":["home","discover"],"startsAt":"2026-12-01T00:00:00Z","endsAt":"2027-01-01T00:00:00Z","impressionCap":0}'
```

**List, with views and taps.** Paused, scheduled and ended campaigns are included.

```bash
curl "$APP_ORIGIN/api/admin/campaigns" -H "Origin: $APP_ORIGIN" -H "x-admin-key: $ADMIN_KEY"
```

**Pause, resume or change.** Send the `id` with only the fields to change; the rest are
kept as they are.

```bash
curl -X POST "$APP_ORIGIN/api/admin/campaigns" -H "Origin: $APP_ORIGIN" -H "Content-Type: application/json" -H "x-admin-key: $ADMIN_KEY" -d '{"id":"<campaign id>","active":false}'
```

**Delete** (also deletes its counts)

```bash
curl -X DELETE "$APP_ORIGIN/api/admin/campaigns/<campaign id>" -H "Origin: $APP_ORIGIN" -H "x-admin-key: $ADMIN_KEY"
```

The `/admin` dashboard shows every campaign, whether it is running, and how many people saw
and tapped it.

### Fields

| Field | Meaning |
| --- | --- |
| `business.name` | Shown on the card (1–120 characters) |
| `business.placeId` | Optional Google place ID of the business |
| `headline`, `body`, `cta` | Card text (80 / 200 / 30 characters) |
| `url` | Where a tap goes; `https://` only |
| `area.center`, `area.radius` | Where it may be shown, radius 500 m to 50 km |
| `categories` | Guided-planning category keys it is relevant to; empty means any |
| `surfaces` | `home`, `discover`, `options` (options is reserved for a future slot) |
| `startsAt`, `endsAt` | ISO times; outside this window it is not shown |
| `active` | Pause or resume |
| `impressionCap` | Stop after this many counted views; 0 means no cap |

## Storage and security

- **Without Supabase:** campaigns and counts live in server memory and are lost on
  restart. That is fine for development only.
- **With Supabase:** apply `supabase/migrations/202611170001_sponsored.sql`, set
  `SUPABASE_SECRET_KEY` (the project's secret / service-role key) on the server, and store
  the admin secret's hash:

  ```sql
  insert into public.app_secrets(name, hash)
  values ('admin', encode(sha256(convert_to('<your ADMIN_KEY>', 'utf8')), 'hex'));
  ```

  The campaign tables are closed to clients, and every function runs only for the
  service role, so the app's public key cannot read campaign details or record events.
  Rules are tested in `tests/database/sponsored.sql`.

## Not built yet

- A self-serve portal where businesses create and pay for campaigns. Today you create
  campaigns for them through the admin API.
- Billing and invoicing.
- A placement on the plan-options screen. The `options` surface exists in the data model,
  but the app doesn't render it there.
