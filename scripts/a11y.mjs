import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
let failures = 0;
for (const route of [
  "",
  "#lab",
  "#streams",
  "#operations",
  "#architecture",
  "#settings",
]) {
  await page.goto(`http://127.0.0.1:5173/${route}`);
  await page.locator("h1").waitFor();
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  const violations = result.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    nodes: v.nodes.map((n) => ({
      target: n.target,
      summary: n.failureSummary,
    })),
  }));
  failures += violations.length;
  console.log(
    JSON.stringify({ route: route || "studio", violations }, null, 2),
  );
}
await browser.close();
process.exitCode = failures ? 1 : 0;
