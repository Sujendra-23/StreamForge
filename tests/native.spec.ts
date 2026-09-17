import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";

test("native H.264 and Opus reach ten browser viewers through the SFU", async ({
  context,
  request,
}) => {
  test.skip(
    !process.env.SF_NATIVE_E2E,
    "Run npm run test:native after building the native sender",
  );
  const id = `native-${Date.now()}`;
  const child = spawn("./scripts/native.sh", ["--test", "--room", id], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  try {
    await expect
      .poll(
        async () => {
          const response = await request.get(`/api/rooms/${id}`);
          if (!response.ok()) return 0;
          return (await response.json()).tracks;
        },
        { message: "Native publisher failed: " + output, timeout: 20000 },
      )
      .toBe(2);
    const viewers = await Promise.all(
      Array.from({ length: 10 }, () => context.newPage()),
    );
    await Promise.all(
      viewers.map(async (page) => {
        await page.goto(`/watch/${id}`);
        await expect(page.getByText("LIVE", { exact: true })).toBeVisible();
        await expect
          .poll(() =>
            page
              .locator("video")
              .evaluate((v: HTMLVideoElement) => ({
                width: v.videoWidth,
                tracks: (v.srcObject as MediaStream)?.getAudioTracks().length,
                frames: v.getVideoPlaybackQuality().totalVideoFrames,
              })),
          )
          .toMatchObject({ width: 1280, tracks: 1 });
        await expect
          .poll(() =>
            page
              .locator("video")
              .evaluate(
                (v: HTMLVideoElement) =>
                  v.getVideoPlaybackQuality().totalVideoFrames,
              ),
          )
          .toBeGreaterThan(20);
      }),
    );
    await expect
      .poll(
        async () =>
          (await (await request.get(`/api/rooms/${id}`)).json()).viewers,
      )
      .toBe(10);
    await viewers[0].screenshot({
      path: "test-results/native-viewer.png",
      fullPage: true,
    });
    for (const page of viewers) await page.close();
  } finally {
    child.kill("SIGTERM");
    await Promise.race([
      once(child, "exit"),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
    if (child.exitCode === null) child.kill("SIGKILL");
    console.log(output);
  }
  await expect
    .poll(async () => (await request.get(`/api/rooms/${id}`)).status())
    .toBe(404);
});
