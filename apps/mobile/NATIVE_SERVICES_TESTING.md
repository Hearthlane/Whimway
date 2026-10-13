# Native integrations and device verification

The mobile app uses the existing Whimway backend and `lib/schema.ts` contract.
`src/services/api.ts` validates every supported response before screens consume it.
Public generation and exploration work as a guest. Account APIs use an optional
Supabase bearer token verified by the backend; mobile requests do not use browser
session cookies. Server Places/OpenAI keys never belong in the mobile environment.

## Maps and foreground location

`RouteMap.native.tsx` uses `react-native-maps` with Google's native provider on
both platforms. Supply restricted `GOOGLE_MAPS_ANDROID_KEY` and
`GOOGLE_MAPS_IOS_KEY` at build time, enable the appropriate native Maps SDKs, and
create a new development build. The config exposes only a configured/not-configured
flag to the component. Google attribution stays visible in the native SDK.

The map draws numbered real place markers, the selected radius, and decoded
verified route geometry. Unverified fixture routes and unavailable routes are
never rendered as invented straight-line directions. Stop selection moves the
camera; Fit route and My location are real camera actions. A current-position
route is obtained separately through `POST /api/route` and drawn through
`guideLeg`. This is map and route guidance, not turn-by-turn navigation.

Only `requestCurrentLocation()` prompts for foreground location, following an
explicit Near me or Locate me tap. `watchForegroundLocation()` requires an
existing grant, removes subscriptions on background/unmount, and restarts only
in the foreground. No background task or background location permission is used.
Coordinates are kept in memory; saved Day Mode progress contains only place IDs
and a user start timestamp.

On a physical Android and iPhone development build:

1. Launch fresh and confirm no location prompt appears.
2. Tap Near me, deny permission, and complete location selection through search.
3. Allow foreground location from an explicit tap. Check your location appears,
   camera recentering works, and location-to-stop routing displays a verified line.
4. Move between itinerary cards and markers; check selection stays synchronized.
5. Background the app and return. Confirm watchers stop while backgrounded and
   resume when authorized; revoke location in Settings and confirm graceful fallback.
6. Test an unavailable route and a fixture plan. No synthetic route line should appear.
7. With Reduce Motion on, camera changes should avoid animated travel.

## Reminders

`schedulePlanReminders()` is reserved for an explicit Yes, remind me tap. App
startup, settings hydration, and `updatePlanReminders()` never request OS permission.
Android's channel is created before the permission request. iOS authorized,
provisional, and ephemeral grants are recognized. Reminders use absolute dates
derived from the destination timezone and offset-bearing stop arrivals.

The default is a single reminder 15 minutes before the outing. Optional stop
reminders can be enabled with configurable lead time. Updates cancel the old
plan's notifications and recreate its future schedule using stored consent.
Starting Day Mode suppresses the start reminder. Completed and skipped stop IDs
are read before every reschedule, including later itinerary edits, so reminders
for those stops are not recreated.
Cancellation affects Whimway notifications only. Failures cancel partial schedules
and surface an error. No push token, push server, exact-alarm permission, calendar
permission, or background location permission is needed.

Delivery can be delayed by battery management, Focus/Do Not Disturb, OS scheduling,
or a changed clock. The installed Expo 57 Android scheduler explicitly falls back
to `setAndAllowWhileIdle` when exact alarms are unavailable; the app blocks exact
alarm permissions and does not promise exact delivery.

On each native platform:

1. Generate a future plan; verify no reminder permission prompt appears yet.
2. Tap Yes, remind me and test both granting and denying permission.
3. Confirm the OS schedule has the expected destination-local start and optional
   stop times. Change device timezone and confirm the absolute instants stay correct.
4. Edit date/start/duration/order and verify old notifications are removed, with
   replacement notifications following the new arrival times.
5. Delete/cancel the plan and disable reminders in Profile. Verify only Whimway
   reminders are cancelled.
6. Tap a delivered reminder while the app is closed. It should open `/plan/{id}`
   and hydrate current provider data from the stored reference.
7. Try a past itinerary: no immediate or stale reminders should be scheduled.

## Device storage, sharing and optional accounts

Saved plans use AsyncStorage with `persistSpec()`: IDs, user choices and stop
references only. Place photos, hours, prices, arrival times and route geometry
are not persisted. Reopening hydrates from the backend and requires connectivity.
Preferences and completed/skipped stop IDs are validated on read and write.
Favorite places store only provider IDs, the selected currency/timezone and a
fixture flag. Names, photographs, hours, prices and coordinates are hydrated into
memory when the favorite collection opens. Favorites remain usable independently
of the original plan's device copy. They are local to the device in this release.

Account preferences load on sign-in. A default device profile can adopt account
preferences; custom or unsaved device choices are preserved with an explicit
Use my account preferences action. A stored budget is reused only when its ISO
currency matches the selected destination, and is never treated as a conversion.

Native text sharing is available to guests and explicitly labels prices as estimates
and the export as a text itinerary. Live cloud sharing saves the reference to the
signed-in account, creates a server share token, and shares the backend's real URL.
It refuses fixture publication. Server sharing removes the private prompt,
dietary/accessibility notes and personal start/end anchors.

For accounts, set `EXPO_PUBLIC_SUPABASE_URL` and
`EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; allow `whimway://auth/callback` in the
Supabase redirect list. Email magic links use PKCE and must be opened on the same
device that requested them. Session and verifier values live in OS SecureStore,
chunked below historical Keychain size limits. The web preview keeps accounts
in memory only. The app stops auth refresh while backgrounded.

Device checks: request a link, reopen from email, verify cloud plans are scoped to
the account, sign out, and confirm planning/device saving still work as a guest.
Confirm deleted plans cancel their reminders and that deleted accounts remove
their cloud data through the existing backend endpoint.

## Automated checks and current limits

From the repository root:

```powershell
npm test -- --run tests/native-services.test.ts
```

From `apps/mobile`:

```powershell
npm run typecheck
```

The automated service tests cover response validation, bearer transport without
cookies, cancellation/timeouts, endpoint safety, reference-only persistence,
progress reconciliation, destination timezone and DST reminder rules, and real
polyline decoding. They cannot validate OS permission dialogs, notification
delivery, native Google map rendering, Keychain/Keystore persistence, or real GPS.
Those checks require configured development builds on Android/iOS devices and
must be recorded separately; a browser preview does not establish native success.

Official integration references: [Expo maps](https://docs.expo.dev/versions/v57.0.0/sdk/map-view/),
[Expo location](https://docs.expo.dev/versions/v57.0.0/sdk/location/),
[Expo notifications](https://docs.expo.dev/versions/v57.0.0/sdk/notifications/),
[Supabase React Native auth](https://supabase.com/docs/guides/auth/quickstarts/react-native),
[Supabase PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow).
