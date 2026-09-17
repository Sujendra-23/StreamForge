import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  timeout: 90000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5173",
    headless: true,
    viewport: { width: 1440, height: 1100 },
    launchOptions: {
      args: [
        "--autoplay-policy=no-user-gesture-required",
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
      ],
    },
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:5173/healthz",
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
});
