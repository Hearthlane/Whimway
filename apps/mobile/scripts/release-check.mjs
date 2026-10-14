import { readFileSync } from "node:fs";
const issues = [];
if (process.env.WHIMWAY_NATIVE_BUILD_CHECK === "true")
  issues.push("CI native build-check mode cannot be used for distribution");
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
  const backend = new URL(process.env.EXPO_PUBLIC_API_URL);
  if (backend.protocol !== "https:")
    issues.push("Production backend must use HTTPS");
  if (backend.username || backend.password || backend.search || backend.hash)
    issues.push(
      "Production backend URL cannot contain credentials, query or fragment",
    );
  if (
    /^(localhost|127\.0\.0\.1|\[::1\])$|\.invalid$|\.example$/i.test(
      backend.hostname,
    )
  )
    issues.push(
      "Production backend must not use a placeholder or localhost address",
    );
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
if (
  !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(
    process.env.EAS_PROJECT_ID || "",
  )
)
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
