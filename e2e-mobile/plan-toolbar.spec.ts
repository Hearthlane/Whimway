import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import type { Itinerary } from "../lib/schema";

// Deliberately enlarge only toolbar labels to 4x their computed browser font.
// This isolates wrapping under browser label stress; it does not simulate an
// iOS Dynamic Type category or constitute native accessibility verification.
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

async function enlargeToolbarLabels(page: Page) {
  await page.evaluate(() => {
    const enlarged = new WeakSet<HTMLElement>();
    const enlarge = () => {
      for (const button of document.querySelectorAll<HTMLElement>(
        '[role="button"]',
      )) {
        if (
          button.getAttribute("aria-label") !== "Share plan" &&
          !["Map", "Timeline"].includes(button.textContent?.trim() ?? "")
        )
          continue;
        for (const label of button.querySelectorAll<HTMLElement>("*")) {
          if (
            enlarged.has(label) ||
            ![...label.childNodes].some(
              (node) =>
                node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
            )
          )
            continue;
          const style = getComputedStyle(label);
          const size = parseFloat(style.fontSize);
          const line = style.lineHeight;
          enlarged.add(label);
          label.style.setProperty("font-size", `${size * 4}px`, "important");
          if (line !== "normal")
            label.style.setProperty(
              "line-height",
              `${parseFloat(line) * 4}px`,
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

async function toolbarGeometry(page: Page, mode: "Map" | "Timeline") {
  const actions = [];
  for (const name of [mode, "Save plan", "Share plan"]) {
    const button = page.getByRole("button", { name, exact: true });
    await expect(button).toHaveCount(1);
    await expect(button).toBeEnabled();
    actions.push(
      await button.evaluate((element, action) => {
        const rect = element.getBoundingClientRect();
        const content = [];
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          if (!walker.currentNode.textContent?.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(walker.currentNode);
          for (const textRect of range.getClientRects())
            content.push({
              type: "label",
              left: textRect.left,
              right: textRect.right,
            });
        }
        for (const icon of element.querySelectorAll("svg")) {
          const iconRect = icon.getBoundingClientRect();
          content.push({
            type: "icon",
            left: iconRect.left,
            right: iconRect.right,
          });
        }
        return {
          name: action,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          height: rect.height,
          content,
        };
      }, name),
    );
  }
  return actions;
}

async function record(
  page: Page,
  info: TestInfo,
  mode: "Map" | "Timeline",
  width: number,
) {
  const actions = await toolbarGeometry(page, mode);
  const name = `rn-web-toolbar-label-stress-4x-${mode.toLowerCase()}-${width}`;
  const screenshot = info.outputPath(`${name}.png`);
  await page.screenshot({ path: screenshot, fullPage: false });
  await info.attach(name, { path: screenshot, contentType: "image/png" });
  const geometry = info.outputPath(`${name}.json`);
  await writeFile(
    geometry,
    JSON.stringify(
      { viewport: page.viewportSize(), labelScale: 4, actions },
      null,
      2,
    ),
  );
  await info.attach(`${name}-geometry`, {
    path: geometry,
    contentType: "application/json",
  });
  // Assert actual button, text glyph and icon bounds before any click can
  // auto-scroll an overflowed action into view and hide the original failure.
  for (const action of actions) {
    expect(action.left, `${action.name} left`).toBeGreaterThanOrEqual(0);
    expect(action.right, `${action.name} right`).toBeLessThanOrEqual(width);
    expect(action.height, `${action.name} touch height`).toBeGreaterThanOrEqual(
      44,
    );
    for (const child of action.content) {
      expect(
        child.left,
        `${action.name} ${child.type} left`,
      ).toBeGreaterThanOrEqual(action.left - 1);
      expect(
        child.right,
        `${action.name} ${child.type} right`,
      ).toBeLessThanOrEqual(action.right + 1);
    }
    await expect(
      page.getByRole("button", { name: action.name, exact: true }),
    ).toBeInViewport({ ratio: 1 });
  }
  const map = actions[0],
    share = actions[2];
  expect(
    share.top,
    "Share wraps below Map or Timeline at this stress size",
  ).toBeGreaterThanOrEqual(map.bottom);
}

for (const viewport of [
  { width: 360, height: 800 },
  { width: 430, height: 932 },
]) {
  test(`Plan toolbar keeps Map, Save and Share within ${viewport.width}px under browser label stress`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    const plan = await generateFixture(page);
    await enlargeToolbarLabels(page);
    await record(page, info, "Map", viewport.width);
    await page.getByRole("button", { name: "Map", exact: true }).click();
    await record(page, info, "Timeline", viewport.width);
    await page.getByRole("button", { name: "Timeline", exact: true }).click();
    await page.getByRole("button", { name: "Save plan", exact: true }).click();
    const save = page.getByRole("dialog", {
      name: "Keep this good day",
      exact: true,
    });
    await expect(save).toBeVisible();
    await save
      .getByRole("button", { name: "Save on this device", exact: true })
      .click();
    await expect(save).not.toBeVisible();
    await expect(
      page.getByText("Saved on this device.", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Share plan", exact: true }).click();
    const share = page.getByRole("dialog", {
      name: "Take a friend along",
      exact: true,
    });
    await expect(share).toBeVisible();
    await expect(
      share.getByRole("button", { name: "Share a text summary", exact: true }),
    ).toBeEnabled();
    await share.getByRole("button", { name: "Close", exact: true }).click();
    await expect(share).not.toBeVisible();
    const saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("whimway:native:plans:v1") ?? "[]"),
    );
    expect(saved[0].id).toBe(plan.id);
    expect(saved[0].revision).toBe(plan.revision);
  });
}
