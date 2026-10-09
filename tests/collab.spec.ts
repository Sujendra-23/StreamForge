import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("host and viewer see each other, share one note, and the panel passes axe", async ({
  page,
  context,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Go live", exact: true }).click();
  await expect(page.getByText("Broadcasting", { exact: true })).toBeVisible();

  const hostPanel = page.getByRole("region", { name: "In this room" });
  await expect(
    hostPanel.getByRole("list", { name: "Participants" }),
  ).toContainText("Host");

  await expect
    .poll(
      async () =>
        (await (await request.get("/api/rooms")).json())[0]?.tracks ?? 0,
    )
    .toBeGreaterThan(0);
  const id = (await (await request.get("/api/rooms")).json())[0].id;

  const viewer = await context.newPage();
  viewer.on("pageerror", (e) => errors.push(e.message));
  await viewer.goto(`/watch/${id}`);
  await expect(viewer.getByText("LIVE", { exact: true })).toBeVisible();
  const viewerPanel = viewer.getByRole("region", { name: "In this room" });

  // Presence: both sides list both people; the host's own row says "(you)".
  const hostList = hostPanel.getByRole("list", { name: "Participants" });
  const viewerList = viewerPanel.getByRole("list", { name: "Participants" });
  await expect(hostList.getByRole("listitem")).toHaveCount(2);
  await expect(viewerList.getByRole("listitem")).toHaveCount(2);
  await expect(hostList).toContainText("(you)");
  await expect(viewerList).toContainText("Host");

  // Rename is broadcast; a screen reader hears it in the live region.
  await viewerPanel.getByLabel("Your name").fill("Ana");
  await viewerPanel.getByRole("button", { name: "Set name" }).click();
  await expect(hostList).toContainText("Ana");
  await expect(hostPanel.locator("[aria-live=polite]").first()).toContainText(
    /is now Ana/,
  );

  // Shared note: the viewer saves, the host sees it and who wrote it.
  const viewerNote = viewerPanel.getByLabel(/Everyone in the room can edit/);
  await viewerNote.fill("Agenda: demo, Q&A");
  await viewerPanel.getByRole("button", { name: "Save note" }).click();
  const hostNote = hostPanel.getByLabel(/Everyone in the room can edit/);
  await expect(hostNote).toHaveValue("Agenda: demo, Q&A");
  await expect(hostPanel).toContainText("Version 1 · saved by Ana");

  // Last writer wins: the host edits and saves; the viewer follows, and the version counter advances.
  await hostNote.fill("Agenda: Q&A first");
  await hostPanel.getByRole("button", { name: "Save note" }).click();
  await expect(viewerNote).toHaveValue("Agenda: Q&A first");
  await expect(viewerPanel).toContainText("Version 2 · saved by Host");

  // A viewer with unsaved edits is warned, not overwritten, when the host saves.
  await viewerNote.fill("my unsaved thoughts");
  await hostNote.fill("Agenda: final");
  await hostPanel.getByRole("button", { name: "Save note" }).click();
  await expect(viewerPanel.getByRole("alert")).toContainText(
    "Host saved version 3",
  );
  await expect(viewerNote).toHaveValue("my unsaved thoughts");
  await viewerPanel
    .getByRole("button", { name: "Use their version instead" })
    .click();
  await expect(viewerNote).toHaveValue("Agenda: final");

  // Accessibility: no WCAG A/AA violations with the panel showing, on both pages.
  for (const target of [page, viewer]) {
    const result = await new AxeBuilder({ page: target })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      result.violations,
      JSON.stringify(result.violations, null, 2),
    ).toEqual([]);
  }

  // Leaving updates the other side.
  await viewer.close();
  await expect(hostList.getByRole("listitem")).toHaveCount(1);

  await page.getByRole("button", { name: "End stream", exact: true }).click();
  expect(errors).toEqual([]);
});
