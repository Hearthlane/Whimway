import { readFileSync } from "node:fs";
const issues = [];
const need = (name) => {
  if (!process.env[name]?.trim()) issues.push(name + " is missing");
};
for (const key of [
  "EXPO_PUBLIC_API_URL",
  "GOOGLE_MAPS_ANDROID_KEY",
  "GOOGLE_MAPS_IOS_KEY",
  "EAS_PROJECT_ID",
  "WHIMWAY_IOS_BUNDLE_ID",
  "WHIMWAY_ANDROID_PACKAGE",
])
  need(key);
try {
  if (new URL(process.env.EXPO_PUBLIC_API_URL).protocol !== "https:")
    issues.push("Production backend must use HTTPS");
} catch {
  issues.push("Production backend URL is invalid");
}
for (const key of ["WHIMWAY_IOS_BUNDLE_ID", "WHIMWAY_ANDROID_PACKAGE"]) {
  const id = process.env[key] || "";
  if (
    id.startsWith("com.example.") ||
    !/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*){2,}$/.test(id)
  )
    issues.push(key + " needs a confirmed application identifier");
}
if (!/^[a-f0-9-]{36}$/i.test(process.env.EAS_PROJECT_ID || ""))
  issues.push("EAS_PROJECT_ID must identify your registered EAS project");
const config = JSON.parse(
  readFileSync(new URL("../eas.json", import.meta.url)),
);
if (!config.build.production?.autoIncrement)
  issues.push("Production version increments are not configured");
if (issues.length) {
  console.error(
    "Native release configuration is incomplete:\n" +
      issues.map((issue) => "• " + issue).join("\n"),
  );
  process.exitCode = 1;
} else
  console.log(
    "Native release environment is configured. Run device, provider, legal and signed-build verification before submission.",
  );
