import { expect, test } from "@playwright/test";

test("broadcasts real media to multiple viewers, adapts to packet loss and recovers", async ({
  page,
  context,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Streaming studio" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Go live", exact: true }).click();
  await expect(page.getByText("Broadcasting", { exact: true })).toBeVisible();
  await expect
    .poll(async () => {
      const rooms = await (await request.get("/api/rooms")).json();
      return rooms[0]?.tracks ?? 0;
    })
    .toBeGreaterThan(0);
  const rooms = await (await request.get("/api/rooms")).json();
  const id = rooms[0].id;
  const viewers = await Promise.all([
    context.newPage(),
    context.newPage(),
    context.newPage(),
  ]);
  for (const viewer of viewers) {
    await viewer.goto(`/watch/${id}`);
    await expect(viewer.getByText("LIVE", { exact: true })).toBeVisible();
    await expect
      .poll(() =>
        viewer.locator("video").evaluate((v: HTMLVideoElement) => v.videoWidth),
      )
      .toBeGreaterThan(0);
  }
  await expect
    .poll(async () => {
      const r = await (await request.get(`/api/rooms/${id}`)).json();
      return r.viewers;
    })
    .toBe(3);
  await page.screenshot({
    path: "test-results/studio-live.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Network lab", exact: false })
    .first()
    .click();
  await page.getByRole("button", { name: /On the edge/ }).click();
  await page.getByRole("button", { name: "Apply conditions" }).click();
  await expect(
    page.getByRole("heading", { name: "Protecting the stream" }),
  ).toBeVisible();
  await expect
    .poll(async () => {
      const r = await (await request.get(`/api/rooms/${id}`)).json();
      return r.droppedPackets;
    })
    .toBeGreaterThan(0);
  await expect(page.getByText("720p").first()).toBeVisible();
  await page.screenshot({
    path: "test-results/network-lab.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Restore network" }).click();
  await expect(
    page.getByRole("heading", { name: "Network healthy" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Studio", exact: true }).click();
  await page.getByRole("button", { name: "End stream", exact: true }).click();
  await expect
    .poll(async () => await (await request.get("/api/rooms")).json())
    .toEqual([]);
  for (const viewer of viewers) {
    await expect(
      viewer.getByRole("heading", { name: "This stream has ended" }),
    ).toBeVisible();
    await viewer.close();
  }
  expect(errors).toEqual([]);
});

test("camera and microphone capture produce video and audio RTP", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Camera", exact: true }).click();
  await page.getByRole("switch", { name: "Include microphone" }).click();
  await page.getByRole("button", { name: "Go live", exact: true }).click();
  await expect(page.getByText("Broadcasting", { exact: true })).toBeVisible();
  await expect
    .poll(async () => {
      const rooms = await (await request.get("/api/rooms")).json();
      return rooms[0]?.tracks;
    })
    .toBe(2);
  await page.getByRole("button", { name: "End stream", exact: true }).click();
});

test("mobile layout, navigation, empty state, and offline viewer", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBeTruthy();
  await page.screenshot({
    path: "test-results/studio-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Live streams", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "The stage is yours" }),
  ).toBeVisible();
  await page.goto("/watch/missing-stream");
  await expect(
    page.getByRole("heading", { name: "This stream is offline" }),
  ).toBeVisible();
});
