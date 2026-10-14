#!/usr/bin/env bash
# Only the disposable hosted emulator and explicit synthetic fixture services.
set -euo pipefail
app_id=com.example.whimway
dev_url='exp+whimway://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081&disableOnboarding=1&disableFab=1&disableAutoLaunch=1'
mkdir -p native-test-artifacts
capture() {
  adb logcat -d -v threadtime > native-test-artifacts/android-logcat.txt 2>&1 || true
  adb shell dumpsys gfxinfo "$app_id" framestats > native-test-artifacts/android-frames.txt 2>&1 || true
  adb shell dumpsys meminfo "$app_id" > native-test-artifacts/android-memory.txt 2>&1 || true
  adb shell settings put system font_scale 1.0 || true
}
trap 'result=$?; capture; exit "$result"' EXIT
adb reverse tcp:3000 tcp:3000
adb reverse tcp:8081 tcp:8081
adb shell settings put secure show_ime_with_hard_keyboard 1
adb shell settings put system font_scale 1.0
adb install apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
adb logcat -c
adb shell getprop ro.build.version.release > native-test-artifacts/android-os.txt
adb shell getprop ro.build.version.sdk >> native-test-artifacts/android-os.txt
adb shell wm size >> native-test-artifacts/android-os.txt
adb shell wm density >> native-test-artifacts/android-os.txt
for i in {1..180}; do test -f native-test-artifacts/ready.json && break; sleep 1; done
test -f native-test-artifacts/ready.json
maestro test --test-output-dir native-results/android -e APP_ID="$app_id" -e EXPO_DEV_URL="$dev_url" e2e-native/smoke.yaml
maestro test --test-output-dir native-results/android-reminders -e APP_ID="$app_id" -e EXPO_DEV_URL="$dev_url" e2e-native/reminders-allow.yaml
adb shell settings put system font_scale 2.0
adb shell settings get system font_scale > native-test-artifacts/android-large-font-scale.txt
maestro test --test-output-dir native-results/android-large-text -e APP_ID="$app_id" -e EXPO_DEV_URL="$dev_url" e2e-native/large-text.yaml
