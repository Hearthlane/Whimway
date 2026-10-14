import { readFileSync } from "node:fs";

const permissions = readFileSync(process.argv[2], "utf8");
const forbidden = [
  "ACCESS_BACKGROUND_LOCATION",
  "RECORD_AUDIO",
  "READ_EXTERNAL_STORAGE",
  "WRITE_EXTERNAL_STORAGE",
  "SCHEDULE_EXACT_ALARM",
  "USE_EXACT_ALARM",
];
for (const permission of forbidden)
  if (permissions.includes(`android.permission.${permission}`))
    throw new Error(
      `Compiled APK contains unrequested permission: ${permission}`,
    );
if (!permissions.includes("android.permission.ACCESS_FINE_LOCATION"))
  throw new Error("Compiled APK is missing foreground location support");
console.log(
  "Compiled APK permission scope verified: foreground location, no background/microphone/storage/exact alarms.",
);
