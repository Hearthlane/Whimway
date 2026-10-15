import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test("Enlarged location-action text wraps inside a narrow phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const action = page.getByRole("button", { name: "Near me", exact: true });
  await expect(action).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  // Deliberate browser-only text stress. Native Choose on map uses the same
  // row constraints, but its actual iOS accessibility category needs OS proof.
  await action.getByText("Near me", { exact: true }).evaluate((element) => {
    element.style.setProperty("font-size", "100px", "important");
    element.style.setProperty("line-height", "120px", "important");
  });
  await action.scrollIntoViewIfNeeded();
  const geometry = await action.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const label = [...element.children].find(
      (child) => child.textContent === "Near me",
    )!;
    const range = document.createRange();
    range.selectNodeContents(label);
    return {
      left: box.left,
      right: box.right,
      height: box.height,
      viewport: innerWidth,
      text: [...range.getClientRects()].map(({ left, right }) => ({
        left,
        right,
      })),
      overflow: document.documentElement.scrollWidth - innerWidth,
    };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.height).toBeGreaterThan(140);
  expect(geometry.text.length).toBeGreaterThan(1);
  for (const line of geometry.text) {
    expect(line.left).toBeGreaterThanOrEqual(geometry.left - 1);
    expect(line.right).toBeLessThanOrEqual(geometry.right + 1);
  }
  expect(geometry.overflow).toBeLessThanOrEqual(0);
  await mkdir("docs/screenshots/mobile-preview", { recursive: true });
  await page.screenshot({
    path: "docs/screenshots/mobile-preview/location-action-large-label-360.png",
  });
});
