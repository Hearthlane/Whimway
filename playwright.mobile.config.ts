import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e-mobile",
  outputDir: "./test-results-mobile",
  fullyParallel: false,
  workers: 1,
  timeout: 120000,
  expect: { timeout: 20000 },
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:8082",
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "npm run dev",
      url: "http://127.0.0.1:3000/api/status",
      reuseExistingServer: !process.env.CI,
      timeout: 180000,
      env: {
        WHIMWAY_DEMO_MODE: "true",
        NEXT_PUBLIC_WHIMWAY_DEMO_MODE: "true",
        DAILY_GUEST_GENERATIONS: "100",
        DAILY_REMIX_LIMIT: "100",
        GLOBAL_DAILY_PROVIDER_LIMIT: "1000",
      },
    },
    {
      command: "node scripts/serve-mobile-preview.mjs --build",
      url: "http://127.0.0.1:8082",
      reuseExistingServer: !process.env.CI,
      timeout: 180000,
      env: {
        EXPO_NO_TELEMETRY: "1",
      },
    },
  ],
});
