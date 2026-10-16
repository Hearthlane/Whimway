import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { writeFile } from "node:fs/promises";

const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });

// Only enlarge actual navigation labels. RN Web fixes fontScale at 1: this
// exercises text-layout adaptation, not an iOS Dynamic Type category/keyboard.
async function enlargeNavigation(page: Page) {
  await page.evaluate(() => {
    const enlarged = new WeakSet<HTMLElement>();
    const labels = new Set([
      "Back",
      "Next",
      "That’s the place",
      "Skip for now",
      "Make my day",
    ]);
    const enlarge = () => {
      for (const action of document.querySelectorAll<HTMLElement>(
        '[role="button"]',
      )) {
        if (!labels.has(action.textContent?.trim() ?? "")) continue;
        for (const label of action.querySelectorAll<HTMLElement>("*")) {
          if (
            enlarged.has(label) ||
            ![...label.childNodes].some(
              (node) =>
                node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
            )
          )
            continue;
          const style = getComputedStyle(label);
          enlarged.add(label);
          label.style.setProperty(
            "font-size",
            `${parseFloat(style.fontSize) * 4}px`,
            "important",
          );
          if (style.lineHeight !== "normal")
            label.style.setProperty(
              "line-height",
              `${parseFloat(style.lineHeight) * 4}px`,
              "important",
            );
        }
      }
    };
    enlarge();
    new MutationObserver(enlarge).observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
}

async function begin(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page
    .getByRole("switch", {
      name: "Use synthetic development fixtures",
      exact: true,
    })
    .check();
  await button(page, "Let’s find something good").click();
  await expect(page).toHaveURL(/\/planner/);
  await enlargeNavigation(page);
}

async function recordFooter(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  const footer = page.getByTestId("planner-footer");
  await expect(footer).toBeInViewport({ ratio: 1 });
  const data = await footer.evaluate((element) => {
    const box = (rect: DOMRect) => ({
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      height: rect.height,
    });
    const actions = [
      ...element.querySelectorAll<HTMLElement>('[role="button"]'),
    ].map((action) => {
      const words = [];
      const fontSizes = [];
      const walker = document.createTreeWalker(action, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const text = node.textContent ?? "";
        if (!text.trim()) continue;
        fontSizes.push(
          parseFloat(getComputedStyle(node.parentElement!).fontSize),
        );
        for (const match of text.matchAll(/\S+/g)) {
          const range = document.createRange();
          range.setStart(node, match.index);
          range.setEnd(node, match.index + match[0].length);
          words.push({
            word: match[0],
            rectangles: [...range.getClientRects()]
              .filter((r) => r.width > 0)
              .map(box),
          });
        }
      }
      return {
        label: action.getAttribute("aria-label") ?? action.textContent?.trim(),
        bounds: box(action.getBoundingClientRect()),
        words,
        fontSizes,
      };
    });
    return { footer: box(element.getBoundingClientRect()), actions };
  });
  const screenshot = info.outputPath(`${name}.png`);
  await page.screenshot({ path: screenshot });
  await info.attach(name, { path: screenshot, contentType: "image/png" });
  const json = info.outputPath(`${name}.json`);
  await writeFile(json, JSON.stringify({ labelScale: 4, ...data }, null, 2));
  await info.attach(`${name}-geometry`, {
    path: json,
    contentType: "application/json",
  });
  const viewport = page.viewportSize()!;
  for (const action of data.actions) {
    expect(action.bounds.left, action.label).toBeGreaterThanOrEqual(0);
    expect(action.bounds.right, action.label).toBeLessThanOrEqual(
      viewport.width,
    );
    expect(action.bounds.height, action.label).toBeGreaterThanOrEqual(44);
    expect(
      action.fontSizes.every((size) => size >= 55),
      "Labels remain at 4x",
    ).toBe(true);
    for (const word of action.words) {
      expect(
        word.rectangles,
        `${action.label}: whole word ${word.word}`,
      ).toHaveLength(1);
      const glyph = word.rectangles[0];
      expect(glyph.left, word.word).toBeGreaterThanOrEqual(
        action.bounds.left - 1,
      );
      expect(glyph.right, word.word).toBeLessThanOrEqual(
        action.bounds.right + 1,
      );
      expect(glyph.top, word.word).toBeGreaterThanOrEqual(
        action.bounds.top - 1,
      );
      expect(glyph.bottom, word.word).toBeLessThanOrEqual(
        action.bounds.bottom + 1,
      );
    }
  }
  expect(
    data.footer.height,
    "Pinned navigation leaves most space to the question",
  ).toBeLessThan(viewport.height * 0.45);
  expect(data.footer.bottom).toBeLessThanOrEqual(viewport.height + 1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

async function selectLocation(page: Page) {
  await page
    .getByRole("textbox", { name: "Search a place", exact: true })
    .fill("Toronto");
  await button(page, "CF Toronto Eaton Centre").click();
  await expect(button(page, "CF Toronto Eaton Centre")).not.toBeVisible();
  await expect(
    page.getByText("CF Toronto Eaton Centre", { exact: true }),
  ).toBeVisible();
  await expect(button(page, "Next")).toBeEnabled();
  await button(page, "Next").click();
  await expect(
    page.getByText("What sounds fun?", { exact: true }),
  ).toBeVisible();
}

for (const viewport of [
  { width: 360, height: 722 },
  { width: 430, height: 932 },
]) {
  test(`Planner navigation preserves whole 4x labels and working Back/Next at ${viewport.width}×${viewport.height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    await begin(page);
    await recordFooter(page, info, "location-footer-4x");
    await selectLocation(page);
    await button(page, "Food & drinks").click();
    await button(page, "Next").click();
    await expect(
      page.getByText("Who’s joining?", { exact: true }),
    ).toBeVisible();
    await button(page, "Back").click();
    await expect(button(page, "Food & drinks")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await recordFooter(page, info, "interests-footer-4x");
    const footer = page.getByTestId("planner-footer");
    await expect(
      footer.getByRole("button", { name: "Skip for now", exact: true }),
    ).toHaveCount(0);
    await expect(
      footer.getByRole("button", { name: "Make my day", exact: true }),
    ).toHaveCount(0);
    await button(page, "Skip for now").click();
    for (let index = 0; index < 6; index++) await button(page, "Next").click();
    await expect(
      page.getByText("Your day,\nyour way.", { exact: true }),
    ).toBeVisible();
    await recordFooter(page, info, "ready-footer-4x");
    await button(page, "Back").click();
    await expect(
      page.getByText("How long are we out?", { exact: true }),
    ).toBeVisible();
    await button(page, "Next").click();
    const generated = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/generate") && response.status() === 200,
    );
    await button(page, "Make my day").click();
    expect((await (await generated).json()).demo).toBe(true);
    await expect(page).toHaveURL(/\/plan\/[a-f\d-]+/);
  });
}

test("Planner keeps early generation reachable in question content under 4x labels", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await begin(page);
  await selectLocation(page);
  await button(page, "Food & drinks").click();
  await recordFooter(page, info, "early-generate-footer-4x");
  const early = button(page, "Make my day");
  await early.scrollIntoViewIfNeeded();
  await expect(early).toBeEnabled();
  await expect(early).toBeInViewport({ ratio: 1 });
  const generated = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/generate") && response.status() === 200,
  );
  await early.click();
  const plan = await (await generated).json();
  expect(plan.demo).toBe(true);
  expect(plan.request.interests).toEqual(["Food & drinks"]);
  await expect(page).toHaveURL(/\/plan\/[a-f\d-]+/);
});
