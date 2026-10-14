import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(
  new URL("../apps/mobile/scripts/release-check.mjs", import.meta.url),
);
function check(overrides: Record<string, string> = {}) {
  return spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: {
      ...process.env,
      EXPO_PUBLIC_API_URL: "https://staging.whimway.app",
      GOOGLE_MAPS_ANDROID_KEY: "test-key-android",
      GOOGLE_MAPS_IOS_KEY: "test-key-ios",
      EAS_PROJECT_ID: "00000000-0000-4000-8000-000000000001",
      WHIMWAY_IOS_BUNDLE_ID: "com.whimway.nativeqa",
      WHIMWAY_ANDROID_PACKAGE: "com.whimway.nativeqa",
      WHIMWAY_NATIVE_BUILD_CHECK: "false",
      ...overrides,
    },
  });
}

describe("native distribution configuration gate", () => {
  it("checks only configuration shape and keeps device/provider/legal verification explicit", () => {
    const result = check();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "device, provider, legal and signed-build verification",
    );
  });
  it("rejects internal compilation-check artifacts even when other fields are supplied", () => {
    const result = check({ WHIMWAY_NATIVE_BUILD_CHECK: "true" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("cannot be used for distribution");
  });
  it("rejects placeholder endpoints, embedded credentials and malformed project UUIDs", () => {
    for (const url of [
      "https://whimway.invalid",
      "https://whimway.test",
      "https://localhost",
      "https://user:password@staging.whimway.app",
    ]) {
      expect(check({ EXPO_PUBLIC_API_URL: url }).status).toBe(1);
    }
    expect(check({ EAS_PROJECT_ID: "-".repeat(36) }).status).toBe(1);
  });
});
