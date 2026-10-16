import { readFileSync } from "node:fs";

const permissions = readFileSync(process.argv[2], "utf8");
const forbidden = [
  "ACCESS_BACKGROUND_LOCATION",
  "RECORD_AUDIO",
  "READ_EXTERNAL_STORAGE",
  "WRITE_EXTERNAL_STORAGE",
  "SCHEDULE_EXACT_ALARM",
  "USE_EXACT_ALARM",
  "USE_BIOMETRIC",
  "USE_FINGERPRINT",
  "SYSTEM_ALERT_WINDOW",
  "FOREGROUND_SERVICE",
  "FOREGROUND_SERVICE_LOCATION",
];
for (const permission of forbidden)
  if (permissions.includes(`android.permission.${permission}`))
    throw new Error(
      `Compiled APK contains unrequested permission: ${permission}`,
    );
if (!permissions.includes("android.permission.ACCESS_FINE_LOCATION"))
  throw new Error("Compiled APK is missing foreground location support");
if (!permissions.includes("android.permission.POST_NOTIFICATIONS"))
  throw new Error("Compiled APK is missing opt-in reminder support");
if (
  permissions.includes(
    "com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE",
  )
)
  throw new Error("Compiled APK contains unused install-referrer permission");
console.log(
  "Compiled APK permission scope verified: foreground location and opt-in reminders; no background location, microphone, storage, exact alarms, biometrics, overlays, persistent location service or install referrer.",
);
