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

maestro test --test-output-dir native-results/ios \
  -e APP_ID=com.example.whimway \
  -e 'EXPO_DEV_URL=exp+whimway://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081&disableOnboarding=1&disableFab=1&disableAutoLaunch=1' \
  e2e-native/smoke.yaml
```

Run `reminders-allow.yaml` with the same platform arguments after the main flow. Maestro permission settings are explicit; iOS notification prompts can be handled automatically by the tool, so a granted state is not evidence of a manually granted first-use dialog. The denied flow must actually reach the app's denied message to pass. Also perform a fresh manual grant/deny check with tool auto-handling disabled. [Maestro permission behavior](https://docs.maestro.dev/maestro-flows/flow-control-and-logic/permissions)

The SDK-57 development-client URL deliberately uses the legacy `expo-development-client/?url=` form. Disable flags remove developer overlays only for this test launch and do not alter Whimway's production guards. [Expo development-client launch URLs](https://docs.expo.dev/develop/development-builds/development-workflows/)

Use an English simulator/emulator and enable its software keyboard. Android CI can set `show_ime_with_hard_keyboard=1`; iOS simulator should disconnect the hardware keyboard. The optional keyboard Done tap handles platforms where no software keyboard is displayed, so inspect screenshots and report actual keyboard coverage rather than inferring it. OS Back is run only on Android, using the documented hardware command. [Maestro hardware keys](https://docs.maestro.dev/reference/commands-available/presskey)

Tab selectors accept the observed Android labels and iOS combined labels, such as `Profile, tab, 3 of 3`. The boot helper also rejects the specific Expo notification Keychain entitlement error. It does not dismiss or hide application warnings.

Hosted iOS compilation retains Xcode's original ad-hoc Simulator archives. `scripts/sign-ios-simulator-test-app.sh` verifies and copies that product without re-signing: it checks embedded XML/DER Simulator entitlements separately from the host signature and requires exact original/runtime tree hashes. This uses no developer certificate, provisioning profile or store signing; Apple documents simulator [Sign to Run Locally](https://developer.apple.com/forums/thread/826882). `scripts/check-ios-simulator-keychain.mjs` exercises native registration-state access and installation-ID write/read in the actual Debug app, returning only success booleans. That runtime proof remains required on the fresh hosted build; signature verification alone does not establish working Keychain access.

Retain Maestro command reports, screenshots, device/OS/build metadata, commit SHA, Metro/backend logs and native crash logs. A YAML file that parses is not a passed flow. Record compile, installation, launch and each journey separately in `docs/mobile-checklist.md` after inspecting runner output.

Android CI also runs large-text.yaml with real OS font_scale=2.0, captures the current scale, and restores the default after the flow. The hosted QA script retains logcat, device/API dimensions, gfxinfo frame samples and meminfo on success or failure. These Debug/emulator observations do not establish production frame-rate, battery use or physical haptics. See the official Android dumpsys reference: https://developer.android.com/tools/dumpsys.

Before each of the three Debug flows, the guarded CI runner stops and clears only `com.example.whimway`, requires `pm clear` to report `Success`, and observes package process/task removal for at least two continuous quiet seconds within a 30-second deadline. Snapshots and failures remain in `native-test-artifacts/android-reset`. Android 14 can otherwise kill a new process when an older task's delayed removal fires: see [ActivityTaskSupervisor's task-removal timeout](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/android14-release/services/core/java/com/android/server/wm/ActivityTaskSupervisor.java) and [Task's pending-kill dump field](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/android14-release/services/core/java/com/android/server/wm/Task.java). The runner changes large-text settings while the app is stopped, then passes `ANDROID_HOST_PREPARED=1` only to the prepared Debug flow so boot does not clear or stop it again. Direct/manual flows keep their existing clean-state launch. A failed reset prevents that flow from launching; app crashes and failed app assertions are not retried or hidden.
