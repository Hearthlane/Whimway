import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import type { Itinerary } from "../lib/schema";

const labels = ["Day Remix ✦", "Adjust plan", "Add a stop +"];
const caption = "SYNTHETIC PLACE · NO VENUE PHOTO";

// Browser-only stress: enlarge these three action labels and synthetic photo
// captions to 4x computed font size. Other text and icons keep their real size.
// This is not a native fontScale/Dynamic Type category or OS rendering test.
async function generateFixture(page: Page): Promise<Itinerary> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page
    .getByRole("switch", {
      name: "Use synthetic development fixtures",
      exact: true,
    })
    .check();
  await page.getByRole("textbox", { name: "Search a place" }).fill("Toronto");
  await page
    .getByRole("button", { name: "CF Toronto Eaton Centre", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "CF Toronto Eaton Centre", exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByText("CF Toronto Eaton Centre", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Let’s find something good", exact: true })
    .click();
  await expect(page).toHaveURL(/\/planner/);
  await page
    .getByRole("button", { name: "Food & drinks", exact: true })
    .click();
  const generated = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/generate") && response.status() === 200,
  );
  await page.getByRole("button", { name: "Make my day", exact: true }).click();
  const plan: Itinerary = await (await generated).json();
  expect(plan.demo).toBe(true);
  await expect(page).toHaveURL(new RegExp(`/plan/${plan.id}$`));
  await expect(page.getByRole("button", { name: /^Customize / })).toHaveCount(
    plan.stops.length,
  );
  return plan;
}

async function enlargeContentLabels(page: Page) {
  await page.evaluate(
    ({ actions, fallback }) => {
      for (const element of document.querySelectorAll<HTMLElement>(
        "div,span",
      )) {
        if (![...actions, fallback].includes(element.textContent?.trim() ?? ""))
          continue;
        if (
          ![...element.childNodes].some(
            (node) =>
              node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
          )
        )
          continue;
        const style = getComputedStyle(element);
        const size = parseFloat(style.fontSize);
        const line = style.lineHeight;
        element.style.setProperty("font-size", `${size * 4}px`, "important");
        if (line !== "normal")
          element.style.setProperty(
            "line-height",
            `${parseFloat(line) * 4}px`,
            "important",
          );
      }
    },
    { actions: labels, fallback: caption },
  );
}

async function capture(
  page: Page,
  info: TestInfo,
  name: string,
  geometry: unknown,
) {
  const image = info.outputPath(`${name}.png`);
  await page.screenshot({ path: image, fullPage: false });
  await info.attach(name, { path: image, contentType: "image/png" });
  const json = info.outputPath(`${name}.json`);
  await writeFile(
    json,
    JSON.stringify(
      { viewport: page.viewportSize(), labelScale: 4, geometry },
      null,
      2,
    ),
  );
  await info.attach(`${name}-geometry`, {
    path: json,
    contentType: "application/json",
  });
}

async function actionGeometry(page: Page) {
  const result = [];
  for (const name of labels) {
    const button = page.getByRole("button", { name, exact: true });
    await expect(button).toHaveCount(1);
    await expect(button).toBeEnabled();
    result.push(
      await button.evaluate((element, label) => {
        const box = (value: DOMRect) => ({
          left: value.left,
          right: value.right,
          top: value.top,
          bottom: value.bottom,
          height: value.height,
        });
        const glyphs = [];
        const adjustWord = [];
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode;
          if (!node.textContent?.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          glyphs.push(...[...range.getClientRects()].map(box));
          const start = node.textContent.indexOf("Adjust");
          if (start >= 0) {
            range.setStart(node, start);
            range.setEnd(node, start + "Adjust".length);
            adjustWord.push(...[...range.getClientRects()].map(box));
          }
        }
        return {
          name: label,
          button: box(element.getBoundingClientRect()),
          glyphs,
          adjustWord,
        };
      }, name),
    );
  }
  return result;
}

async function fallbackGeometry(page: Page) {
  return page
    .getByText(caption, { exact: true })
    .first()
    .evaluate((label) => {
      const card = label.parentElement!;
      const box = (value: DOMRect) => ({
        left: value.left,
        right: value.right,
        top: value.top,
        bottom: value.bottom,
        height: value.height,
      });
      const range = document.createRange();
      range.selectNodeContents(label);
      return {
        card: box(card.getBoundingClientRect()),
        caption: box(label.getBoundingClientRect()),
        glyphs: [...range.getClientRects()].map(box),
        icons: [...card.querySelectorAll("svg")].map((icon) =>
          box(icon.getBoundingClientRect()),
        ),
      };
    });
}

for (const viewport of [
  { width: 360, height: 800 },
  { width: 430, height: 932 },
]) {
  test(`Plan actions and fallback card contain browser 4x labels at ${viewport.width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    await generateFixture(page);
    await enlargeContentLabels(page);
    const adjust = page.getByRole("button", {
      name: "Adjust plan",
      exact: true,
    });
    await adjust
      .locator("..")
      .evaluate((group) =>
        group.scrollIntoView({ block: "center", inline: "nearest" }),
      );
    const actions = await actionGeometry(page);
    await capture(
      page,
      info,
      `rn-web-plan-tools-label-stress-4x-${viewport.width}`,
      actions,
    );
    // Soft assertions retain independent action AND photo evidence on the old
    // export, rather than stopping before the second known native failure.
    for (const action of actions) {
      expect
        .soft(action.button.left, `${action.name} left`)
        .toBeGreaterThanOrEqual(0);
      expect
        .soft(action.button.right, `${action.name} right`)
        .toBeLessThanOrEqual(viewport.width);
      expect
        .soft(action.button.height, `${action.name} touch target`)
        .toBeGreaterThanOrEqual(44);
      for (const glyph of action.glyphs) {
        expect
          .soft(glyph.left, `${action.name} glyph left`)
          .toBeGreaterThanOrEqual(action.button.left - 1);
        expect
          .soft(glyph.right, `${action.name} glyph right`)
          .toBeLessThanOrEqual(action.button.right + 1);
        expect
          .soft(glyph.top, `${action.name} glyph top`)
          .toBeGreaterThanOrEqual(action.button.top - 1);
        expect
          .soft(glyph.bottom, `${action.name} glyph bottom`)
          .toBeLessThanOrEqual(action.button.bottom + 1);
      }
      await expect
        .soft(page.getByRole("button", { name: action.name, exact: true }))
        .toBeInViewport({ ratio: 1 });
    }
    expect
      .soft(
        actions.find((action) => action.name === "Adjust plan")!.adjustWord,
        "Adjust remains one whole word on one line",
      )
      .toHaveLength(1);

    const photo = page
      .getByText(caption, { exact: true })
      .first()
      .locator("..");
    await photo.evaluate((card) =>
      card.scrollIntoView({ block: "center", inline: "nearest" }),
    );
    const fallback = await fallbackGeometry(page);
    await capture(
      page,
      info,
      `rn-web-photo-fallback-label-stress-4x-${viewport.width}`,
      fallback,
    );
    await expect.soft(photo).toBeInViewport({ ratio: 1 });
    expect
      .soft(fallback.icons, "The actual fallback card retains its MapPin")
      .toHaveLength(1);
    expect.soft(fallback.card.left).toBeGreaterThanOrEqual(0);
    expect.soft(fallback.card.right).toBeLessThanOrEqual(viewport.width);
    for (const [index, child] of [
      fallback.caption,
      ...fallback.glyphs,
      ...fallback.icons,
    ].entries()) {
      expect
        .soft(child.left, `Fallback content ${index} left`)
        .toBeGreaterThanOrEqual(fallback.card.left - 1);
      expect
        .soft(child.right, `Fallback content ${index} right`)
        .toBeLessThanOrEqual(fallback.card.right + 1);
      expect
        .soft(child.top, `Fallback content ${index} top`)
        .toBeGreaterThanOrEqual(fallback.card.top - 1);
      expect
        .soft(child.bottom, `Fallback content ${index} bottom`)
        .toBeLessThanOrEqual(fallback.card.bottom + 1);
    }
    // The same real edit entry remains reachable after content has reflowed.
    await adjust.scrollIntoViewIfNeeded();
    await adjust.click();
    const sheet = page.getByRole("dialog", {
      name: "Make room for your day",
      exact: true,
    });
    await expect(sheet).toBeVisible();
    await expect(
      sheet.getByRole("textbox", { name: "Plan budget", exact: true }),
    ).toBeVisible();
    await expect(
      sheet.getByRole("button", { name: "Update my plan", exact: true }),
    ).toBeEnabled();
    await sheet.getByRole("button", { name: "Close", exact: true }).click();
    await expect(sheet).not.toBeVisible();
  });
}
