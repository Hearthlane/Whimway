# Native development-client smoke flows

These are Maestro flows for actual iOS/Android native views. Execution results apply only to the source and scope recorded in [the validation checklist](../docs/mobile-checklist.md). They are not browser tests and do not use fake map keys or enable fixtures in production builds. All tested venue/price/route data is explicitly synthetic; no cloud messages or live provider calls are expected.

Use the dedicated development-client app (`com.example.whimway` unless overridden), a running fixture Next backend and a running native Metro development server. The boot helper clears this test app's local data. Keep these flows separate from a production install/account. The standalone Release compilation-check app cannot load a development server or show the fixture toggle.

`smoke.yaml` covers Explore/Saved/Profile, local budget preferences, denied location, adaptive fixture planning, Android hardware Back (visible Back on iOS), sheet-header drag dismissal, invalid-edit error shown inside a keyboard sheet, successful retry, notification opt-in/denied state, Day completion and process-restored progress. `reminders-allow.yaml` covers a granted native permission state, actual local scheduling counts and cancellation. Delivery timing, notification taps, live native maps/attribution and physical haptics remain separate device checks.

From the root, start the backend with `WHIMWAY_DEMO_MODE=true`, `NEXT_PUBLIC_WHIMWAY_DEMO_MODE=true`, `DAILY_GUEST_GENERATIONS=100`, `DAILY_REMIX_LIMIT=100`, `GLOBAL_DAILY_PROVIDER_LIMIT=1000` and `APP_ORIGIN` unset. Start Metro from `apps/mobile` using `npx expo start --dev-client --port 8081`, with `EXPO_PUBLIC_API_URL=http://127.0.0.1:3000` for Android or `http://localhost:3000` for the iOS simulator. Local HTTP is allowed only by development source; production remains HTTPS-only.

Install the Debug/development-client APK or simulator development `.app`, then run, for example:

For the Android emulator, forward both development ports first: `adb reverse tcp:3000 tcp:3000` and `adb reverse tcp:8081 tcp:8081`. The flow uses the same localhost origin as the iOS simulator and runner.

```bash
maestro test --test-output-dir native-results/android \
  -e APP_ID=com.example.whimway \
  -e 'EXPO_DEV_URL=exp+whimway://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081&disableOnboarding=1&disableFab=1&disableAutoLaunch=1' \
  e2e-native/smoke.yaml

maestro test --driver-host-port 7002 --test-output-dir native-results/ios \
  -e APP_ID=com.example.whimway -e IOS_DRIVER_PORT=7002 \
  -e 'EXPO_DEV_URL=exp+whimway://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081&disableOnboarding=1&disableFab=1&disableAutoLaunch=1' \
  e2e-native/smoke.yaml
```

The iOS plan helpers also require the local viewport observer on port 8766 and the separate gesture broker on port 8767. Hosted CI starts both with the test services. For a manual run alongside your existing backend/Metro, start them together in another terminal:

```bash
node --input-type=module -e "
import {startIOSViewportServer} from './scripts/native-ios-viewport-server.mjs';
import {startIOSGestureBroker} from './scripts/native-ios-gesture-server.mjs';
const observer = await startIOSViewportServer({artifactDirectory:'native-test-artifacts/ios-plan-viewport'});
await startIOSGestureBroker({consumeObservation:observer.consumeObservation,artifactDirectory:'native-test-artifacts/ios-plan-gestures'});
"
```

Keep the explicitly selected Maestro driver port and `IOS_DRIVER_PORT` identical (allowed ports: 7001–7004).

Hosted iOS scopes run through `scripts/run-ios-native-qa.mjs`. Maestro 2.11 can time out before registering its session cleanup hook, leaving its XCTest installer alive while the next scope starts. The runner records process birth identities while each scope is active, captures failure-time diagnostics, then stops only that scope's corroborated installer/selected-simulator driver and requires two continuous seconds of absence before proceeding. Unknown processes or an unproven teardown stop subsequent scopes. A failed scope stays failed; the fence does not retry app assertions or establish the cause of the first driver bootstrap failure. The original failure evidence remains retained.

CI pins Maestro 2.11.0 and converts every flow with its actual `YamlCommandReader.readCommands` before native compilation. The shallow `check-syntax` command misses eager coordinate-conversion errors. Its YAML swipe converter does not defer expressions, so the iOS plan loop obtains fresh, clipped and damped points from the observer. That observer only reads hierarchy/device information and issues a short-lived, single-use observation token. The JavaScript helper sends only this token to the separate broker, which consumes the trusted observation before making one native `/swipeV2` request to the same driver. Taps remain real Maestro `tapOn` commands using absolute integer points revalidated after rounding. The loop permits at most 20 gestures and still requires the actual sheet/Day assertions. [Maestro 2.11 swipe implementation](https://github.com/mobile-dev-inc/Maestro/blob/cli-2.11.0/maestro-ios-xctest-runner/maestro-driver-iosUITests/Routes/Handlers/SwipeRouteHandlerV2.swift)

An isolated run of the actual Maestro 2.11 JavaScript runtime showed its generic HTTP client automatically replaying a direct native HTTP 408 response before JavaScript could reject it. The broker uses Node's HTTP client without retries and caches each identity's in-flight or completed result, including after a client disconnect, native timeout or lost connection. Driver outcomes use HTTP 200 envelopes with an explicit success/failure field, preventing HTTP-408 replay while preserving failure assertions. Repeated requests for the same identity never dispatch another gesture. Bounded native status/body evidence is retained in `native-test-artifacts/ios-plan-gestures`, with response summaries in Maestro logs. This isolated transport regression is separate from actual simulator UI execution.

Run `reminders-allow.yaml` with the same platform arguments after the main flow. Maestro permission settings are explicit; iOS notification prompts can be handled automatically by the tool, so a granted state is not evidence of a manually granted first-use dialog. The denied flow must actually reach the app's denied message to pass. Also perform a fresh manual grant/deny check with tool auto-handling disabled. [Maestro permission behavior](https://docs.maestro.dev/maestro-flows/flow-control-and-logic/permissions)

The SDK-57 development-client URL deliberately uses the legacy `expo-development-client/?url=` form. Disable flags remove developer overlays only for this test launch and do not alter Whimway's production guards. [Expo development-client launch URLs](https://docs.expo.dev/develop/development-builds/development-workflows/)

Use an English simulator/emulator and enable its software keyboard. Android CI can set `show_ime_with_hard_keyboard=1`; iOS simulator should disconnect the hardware keyboard. The optional keyboard Done tap handles platforms where no software keyboard is displayed, so inspect screenshots and report actual keyboard coverage rather than inferring it. OS Back is run only on Android, using the documented hardware command. [Maestro hardware keys](https://docs.maestro.dev/reference/commands-available/presskey)

The fixture helper dismisses the real keyboard before selecting the exact CF Toronto result, then re-finds it in the expanded viewport. On iOS it requires the keyboard's Delete key and Done control to disappear. Query clearance and the selected-place label must be observed before entering planning; the interests assertion remains mandatory. The retained largest-type failure had tapped the result behind the keyboard, so a completed tap is insufficient proof of selection.

After a process restart, Saved refreshes provider details before opening a plan. The flow allows the existing 105-second API request window plus a ten-second UI margin to reach the actual Plan heading, requires its timeline, and rejects remaining Refreshing/Cancel controls. It then positions and taps Start through the platform's real UI and still requires restored `1 DONE`. A pending, failed or cancelled Saved opening cannot count as a completed restore; the readiness change needs a native replay.

Tab selectors accept the observed Android labels and iOS combined labels, such as `Profile, tab, 3 of 3`. The boot helper also rejects the specific Expo notification Keychain entitlement error. It does not dismiss or hide application warnings.

Hosted iOS compilation retains Xcode's original ad-hoc Simulator archives. `scripts/sign-ios-simulator-test-app.sh` verifies and copies that product without re-signing: it checks embedded XML/DER Simulator entitlements separately from the host signature and requires exact original/runtime tree hashes. This uses no developer certificate, provisioning profile or store signing; Apple documents simulator [Sign to Run Locally](https://developer.apple.com/forums/thread/826882). `scripts/check-ios-simulator-keychain.mjs` exercises native registration-state access and installation-ID write/read in the actual Debug app, returning only success booleans. That runtime proof remains required on the fresh hosted build; signature verification alone does not establish working Keychain access.

Retain Maestro command reports, screenshots, device/OS/build metadata, commit SHA, Metro/backend logs and native crash logs. A YAML file that parses is not a passed flow. Record compile, installation, launch and each journey separately in `docs/mobile-checklist.md` after inspecting runner output.

Android CI also runs large-text.yaml with real OS font_scale=2.0, captures the current scale, and restores the default after the flow. The hosted QA script retains logcat, device/API dimensions, gfxinfo frame samples and meminfo on success or failure. These Debug/emulator observations do not establish production frame-rate, battery use or physical haptics. See the official Android dumpsys reference: https://developer.android.com/tools/dumpsys.

Before each Android scope (`smoke`, `reminders`, `large-text`, and `release`), the guarded CI runner stops and clears only `com.example.whimway`, requires `pm clear` to report `Success`, and observes package process/task removal for at least two continuous quiet seconds within a 30-second deadline. Snapshots and failures remain in `native-test-artifacts/android-reset`. Android 14 can otherwise kill a new process when an older task's delayed removal fires: see [ActivityTaskSupervisor's task-removal timeout](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/android14-release/services/core/java/com/android/server/wm/ActivityTaskSupervisor.java) and [Task's pending-kill dump field](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/android14-release/services/core/java/com/android/server/wm/Task.java). The runner changes large-text settings while the app is stopped, then passes `ANDROID_HOST_PREPARED=1` only after successful preparation so Maestro does not clear or stop it again. Direct/manual flows keep their existing clean-state launch. A failed reset prevents that flow from launching; app crashes and failed app assertions are not retried or hidden.

Release preparation runs after standalone APK replacement and before the measured `am start -W` launch. The prepared Release flow preserves that running activity with `clearState: false` and `stopApp: false`; it still denies location/notification permissions and requires the actual Explore heading within 120 seconds. A failed reset, foreign launcher activity, or failed cold-launch command prevents the Release UI probe and retains failure diagnostics. The activity launch timing measures the native Activity only; Release interactivity is established separately by the guest Explore, Profile, and Saved assertions.
