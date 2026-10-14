#!/usr/bin/env bash
# Only the disposable hosted emulator and explicit synthetic fixture services.
set -euo pipefail
export MAESTRO_CLI_NO_ANALYTICS=1
app_id=com.example.whimway
dev_url='exp+whimway://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081&disableOnboarding=1&disableFab=1&disableAutoLaunch=1'
mkdir -p native-test-artifacts
emulator_serial=$(adb get-serialno | tr -d '\r')
require_disposable_emulator() {
  if [[ "${CI:-}" != "true" || ! "$emulator_serial" =~ ^emulator-[0-9]+$ ]]; then
    echo 'Native app replacement is allowed only on a disposable CI Android emulator.' >&2
    return 1
  fi
}
require_disposable_emulator
device_adb() { adb -s "$emulator_serial" "$@"; }
phase=debug
release_installed=false
capture() {
  local build_mode="$1"
  device_adb logcat -d -v threadtime > "native-test-artifacts/android-${build_mode}-logcat.txt" 2>&1 || true
  if [[ "$build_mode" == release && "$release_installed" != true ]]; then
    echo 'Release installation did not complete; no Release frame measurements.' > native-test-artifacts/android-release-gfxinfo.txt
    echo 'Release installation did not complete; no Release memory measurements.' > native-test-artifacts/android-release-meminfo.txt
  else
    device_adb shell dumpsys gfxinfo "$app_id" framestats > "native-test-artifacts/android-${build_mode}-gfxinfo.txt" 2>&1 || true
    device_adb shell dumpsys meminfo "$app_id" > "native-test-artifacts/android-${build_mode}-meminfo.txt" 2>&1 || true
  fi
}
cleanup() {
  local exit_code=$?
  trap - EXIT
  capture "$phase"
  device_adb shell settings put system font_scale 1.0 || true
  exit "$exit_code"
}
trap cleanup EXIT
cat > native-test-artifacts/android-performance-context.txt <<'EOF'
Environment: disposable GitHub Actions Android emulator with software GPU.
Debug: development client loading current JavaScript from Metro; Debug jank and PSS are not production app measurements.
Release: standalone compiled APK, guest Explore/Profile/Saved surfaces, no provider credentials.
All frame and memory diagnostics are emulator observations without performance pass/fail thresholds or production FPS claims.
Startup: force-stop followed by am start -W measures native Activity cold launch, not JavaScript interactivity or time-to-interactive.
EOF
device_adb reverse tcp:3000 tcp:3000
device_adb reverse tcp:8081 tcp:8081
device_adb shell settings put secure show_ime_with_hard_keyboard 1
device_adb shell settings put system font_scale 1.0
device_adb install apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
device_adb logcat -c
device_adb shell getprop ro.build.version.release > native-test-artifacts/android-os.txt
device_adb shell getprop ro.build.version.sdk >> native-test-artifacts/android-os.txt
device_adb shell wm size >> native-test-artifacts/android-os.txt
device_adb shell wm density >> native-test-artifacts/android-os.txt
device_adb shell dumpsys SurfaceFlinger | sed -n '/GLES:/p' > native-test-artifacts/android-renderer.txt || true
for i in {1..180}; do test -f native-test-artifacts/ready.json && break; sleep 1; done
test -f native-test-artifacts/ready.json
result=0
maestro test --test-output-dir native-results/android -e APP_ID="$app_id" -e EXPO_DEV_URL="$dev_url" e2e-native/smoke.yaml || result=1
maestro test --test-output-dir native-results/android-reminders -e APP_ID="$app_id" -e EXPO_DEV_URL="$dev_url" e2e-native/reminders-allow.yaml || result=1
device_adb shell settings put system font_scale 2.0
device_adb shell settings get system font_scale > native-test-artifacts/android-large-font-scale.txt
maestro test --test-output-dir native-results/android-large-text -e APP_ID="$app_id" -e EXPO_DEV_URL="$dev_url" e2e-native/large-text.yaml || result=1
# Preserve the complete Debug session before replacing it. The emulator is
# disposable; never uninstall an app from a physical or non-CI device.
capture debug
device_adb shell settings put system font_scale 1.0
require_disposable_emulator
test -f apps/mobile/android/app/build/outputs/apk/release/app-release.apk
phase=release
echo 'Preparing standalone Release replacement on disposable emulator.' > native-test-artifacts/android-release-probe-state.txt
device_adb logcat -c
device_adb uninstall "$app_id"
device_adb install apps/mobile/android/app/build/outputs/apk/release/app-release.apk
release_installed=true
echo 'Standalone Release APK installed; diagnostics refer to Release only.' > native-test-artifacts/android-release-probe-state.txt
device_adb shell settings get system font_scale > native-test-artifacts/android-release-font-scale.txt
device_adb shell am force-stop "$app_id"
activity=$(device_adb shell cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.LAUNCHER "$app_id" | tr -d '\r' | tail -n 1)
if [[ "$activity" == "$app_id/"* ]]; then
  device_adb shell am start -W -n "$activity" > native-test-artifacts/android-release-activity-cold-start.txt 2>&1 || result=1
else
  echo 'Could not resolve the installed Release launcher activity.' > native-test-artifacts/android-release-activity-cold-start.txt
  result=1
fi
maestro test --test-output-dir native-results/android-release -e APP_ID="$app_id" e2e-native/release-launch.yaml || result=1
exit "$result"
