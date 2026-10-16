import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import type { Itinerary } from "../lib/schema";

const title = "Make room for your day";
const dialog = (page: Page) =>
  page.getByRole("dialog", { name: title, exact: true });

async function fixturePlan(page: Page): Promise<Itinerary> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page
    .getByRole("switch", {
      name: "Use synthetic development fixtures",
      exact: true,
    })
    .check();
  await page
    .getByRole("textbox", { name: "Search a place", exact: true })
    .fill("Toronto");
  await page
    .getByRole("button", { name: "CF Toronto Eaton Centre", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "CF Toronto Eaton Centre", exact: true }),
  ).not.toBeVisible();
  await page
    .getByRole("button", { name: "Let’s find something good", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Food & drinks", exact: true })
    .click();
  const generated = page.waitForResponse((response) =>
    response.url().endsWith("/api/generate"),
  );
  await page.getByRole("button", { name: "Make my day", exact: true }).click();
  const response = await generated;
  expect(response.status(), "The isolated fixture plan must generate").toBe(
    200,
  );
  const plan = await response.json();
  await expect(page).toHaveURL(new RegExp(`/plan/${plan.id}$`));
  return plan;
}

// Enlarge rendered sheet text and input values, without changing fontScale,
// app data or platform APIs. This is browser text-layout stress, not native
// Dynamic Type or an OS keyboard/gesture result.
async function enlargeSheetText(page: Page) {
  await page.evaluate((sheetTitle) => {
    const enlarged = new WeakSet<HTMLElement>();
    const enlarge = () => {
      for (const sheet of document.querySelectorAll<HTMLElement>(
        '[role="dialog"]',
      )) {
        if (sheet.getAttribute("aria-label") !== sheetTitle) continue;
        for (const label of sheet.querySelectorAll<HTMLElement>("*")) {
          if (
            enlarged.has(label) ||
            (!label.matches("input,textarea") &&
              ![...label.childNodes].some(
                (node) =>
                  node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
              ))
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
  }, title);
}

async function geometry(page: Page, info: TestInfo, name: string) {
  const sheet = dialog(page);
  const heading = sheet.getByRole("heading", { name: title, exact: true });
  await page.evaluate(() => document.fonts.ready);
  const data = await heading.evaluate((element) => {
    const rect = (value: DOMRect) => ({
      left: value.left,
      right: value.right,
      top: value.top,
      bottom: value.bottom,
      height: value.height,
    });
    let scroll: HTMLElement | null = element.parentElement;
    while (scroll && !/auto|scroll/.test(getComputedStyle(scroll).overflowY))
      scroll = scroll.parentElement;
    const words = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      for (const word of (node.textContent ?? "").matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(node, word.index);
        range.setEnd(node, word.index + word[0].length);
        words.push({
          text: word[0],
          rects: [...range.getClientRects()]
            .filter((box) => box.width > 0)
            .map(rect),
        });
      }
    }
    return {
      title: rect(element.getBoundingClientRect()),
      fontSize: parseFloat(getComputedStyle(element).fontSize),
      scroll: scroll ? rect(scroll.getBoundingClientRect()) : null,
      words,
    };
  });
  const image = info.outputPath(`${name}.png`);
  await page.screenshot({ path: image });
  await info.attach(name, { path: image, contentType: "image/png" });
  const json = info.outputPath(`${name}.json`);
  await writeFile(
    json,
    JSON.stringify(
      { viewport: page.viewportSize(), labelScale: 4, ...data },
      null,
      2,
    ),
  );
  await info.attach(`${name}-geometry`, {
    path: json,
    contentType: "application/json",
  });
  expect(
    data.fontSize,
    "The complete heading keeps its 4x size",
  ).toBeGreaterThanOrEqual(103);
  expect(
    data.scroll,
    "Oversized title shares the form's scrollable viewport",
  ).not.toBeNull();
  expect(
    data.scroll!.height,
    "The form retains most of the viewport",
  ).toBeGreaterThan(page.viewportSize()!.height * 0.55);
  for (const word of data.words) {
    expect(word.rects, word.text).toHaveLength(1);
    expect(word.rects[0].left, word.text).toBeGreaterThanOrEqual(
      data.title.left - 1,
    );
    expect(word.rects[0].right, word.text).toBeLessThanOrEqual(
      data.title.right + 1,
    );
  }
  await expect(
    sheet.getByRole("button", { name: "Close", exact: true }),
  ).toBeInViewport({ ratio: 1 });
}

for (const viewport of [
  { width: 360, height: 722 },
  { width: 430, height: 932 },
]) {
  test(`Sheet keeps its full 4x title, form and pinned Close usable at ${viewport.width}×${viewport.height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    const plan = await fixturePlan(page);
    let edits = 0;
    page.on("request", (request) => {
      if (request.url().endsWith("/api/edit")) edits++;
    });
    await page
      .getByRole("button", { name: "Adjust plan", exact: true })
      .click();
    await enlargeSheetText(page);
    await geometry(page, info, "sheet-title-4x");
    const sheet = dialog(page);
    const budget = sheet.getByRole("textbox", {
      name: "Plan budget",
      exact: true,
    });
    await budget.fill("73");
    await budget.evaluate((input) =>
      input.scrollIntoView({ block: "center", inline: "nearest" }),
    );
    await expect(budget).toBeInViewport({ ratio: 1 });
    const walking = sheet.getByRole("button", {
      name: "Walking",
      exact: true,
    });
    const driving = sheet.getByRole("button", {
      name: "Driving",
      exact: true,
    });
    await walking
      .locator("..")
      .evaluate((group) =>
        group.scrollIntoView({ block: "center", inline: "nearest" }),
      );
    // Check both modes in the same actual viewport before any click can scroll
    // a clipped second button sideways and conceal the original row overflow.
    for (const mode of [walking, driving]) {
      await expect(mode).toBeInViewport({ ratio: 1 });
      const bounds = await mode.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    }
    const scroll = sheet.getByTestId("sheet-scroll");
    expect(
      await scroll.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
      "Both transport controls fit without horizontal scrolling",
    ).toBeLessThanOrEqual(1);
    expect(await scroll.evaluate((element) => element.scrollLeft)).toBe(0);
    await driving.click();
    await expect(driving).toHaveAttribute("aria-pressed", "true");
    const modesImage = info.outputPath("sheet-modes-4x.png");
    await page.screenshot({ path: modesImage });
    await info.attach("sheet-modes-4x", {
      path: modesImage,
      contentType: "image/png",
    });
    const update = sheet.getByRole("button", {
      name: "Update my plan",
      exact: true,
    });
    await update.evaluate((action) =>
      action.scrollIntoView({ block: "center", inline: "nearest" }),
    );
    await expect(update).toBeInViewport({ ratio: 1 });
    await expect(
      sheet.getByRole("button", { name: "Close", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: info.outputPath("sheet-update-4x.png") });
    await sheet.getByRole("button", { name: "Close", exact: true }).click();
    await expect(sheet).not.toBeVisible();
    expect(edits, "Closing an edited form must not submit it").toBe(0);
    await page
      .getByRole("button", { name: "Adjust plan", exact: true })
      .click();
    await expect(budget).toHaveValue(String(plan.request.budget));
    await expect(walking).toHaveAttribute(
      "aria-pressed",
      String(plan.request.mode === "WALK"),
    );
    await budget.fill("74");
    await driving.click();
    const edited = page.waitForResponse((response) =>
      response.url().endsWith("/api/edit"),
    );
    await update.click();
    const response = await edited;
    expect(response.status(), "The real fixture edit must succeed").toBe(200);
    const next = await response.json();
    expect(next.request.budget).toBe(74);
    expect(next.request.mode).toBe("DRIVE");
    expect(next.revision).toBe(plan.revision + 1);
    expect(edits).toBe(1);
    await expect(sheet).not.toBeVisible();
    await page
      .getByRole("button", { name: "Adjust plan", exact: true })
      .click();
    await expect(budget).toHaveValue("74");
    await sheet.getByRole("button", { name: "Close", exact: true }).click();
  });
}
