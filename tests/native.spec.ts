import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";

const viewerCount = Number(
  process.env.SF_VIEWERS ?? (process.env.SF_LOAD_E2E ? 50 : 10),
);
const holdSeconds = Number(process.env.SF_HOLD_SECONDS ?? 0);
const minimumFrames = Number(
  process.env.SF_MIN_FRAMES ?? (process.env.SF_LOAD_E2E ? 5 : 20),
);

test(`native H.264 and Opus reach ${viewerCount} browser viewers through the SFU`, async ({
  context,
  request,
}) => {
  test.setTimeout(Math.max(30_000, viewerCount * 1_500 + holdSeconds * 1_000));
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
      Array.from({ length: viewerCount }, () => context.newPage()),
    );
    for (let start = 0; start < viewers.length; start += 20) {
      const batch = viewers.slice(start, start + 20);
      await Promise.all(
        batch.map(async (page) => {
          await page.goto(`/watch/${id}`);
          await expect(page.getByText("LIVE", { exact: true })).toBeVisible({
            timeout: 45_000,
          });
          await expect
            .poll(
              () =>
                page.locator("video").evaluate((v: HTMLVideoElement) => ({
                  width: v.videoWidth,
                  tracks: (v.srcObject as MediaStream)?.getAudioTracks().length,
                  frames: v.getVideoPlaybackQuality().totalVideoFrames,
                })),
              { timeout: 45_000 },
            )
            .toMatchObject({ width: 1280, tracks: 1 });
          await expect
            .poll(
              () =>
                page
                  .locator("video")
                  .evaluate(
                    (v: HTMLVideoElement) =>
                      v.getVideoPlaybackQuality().totalVideoFrames,
                  ),
              { timeout: 45_000 },
            )
            .toBeGreaterThan(minimumFrames);
        }),
      );
    }
    await expect
      .poll(
        async () =>
          (await (await request.get(`/api/rooms/${id}`)).json()).viewers,
      )
      .toBe(viewerCount);
    if (holdSeconds > 0) {
      await Promise.all(
        viewers.map((page) => page.waitForTimeout(holdSeconds * 1000)),
      );
    }
    const frameCounts = await Promise.all(
      viewers.map((page) =>
        page
          .locator("video")
          .evaluate(
            (video: HTMLVideoElement) =>
              video.getVideoPlaybackQuality().totalVideoFrames,
          ),
      ),
    );
    frameCounts.sort((a, b) => a - b);
    console.log(
      `Decoded frames across ${viewerCount} viewers: min=${frameCounts[0]}, median=${frameCounts[Math.floor(frameCounts.length / 2)]}, max=${frameCounts.at(-1)}`,
    );
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
