import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

// These tests render the real React Native screen through RN Web. Browser
// rectangles, focused inputs and reduced content space are layout evidence;
// they do not establish OS safe-area, software-keyboard or device behavior.
const questions = [
  "Where are we heading?",
  "What sounds fun?",
  "Who’s joining?",
  "What’s your energy today?",
  "What’s the vibe?",
  "What’s your budget?",
  "When’s the adventure?",
  "How long are we out?",
] as const;
const choices = {
  interests: [
    "Food & drinks",
    "Shopping",
    "Games & entertainment",
    "Nature & outdoors",
    "Arts & culture",
    "Relaxation",
    "Nightlife",
    "Family",
    "Hidden gems",
    "Surprise me",
  ],
  companion: ["Just me", "A date", "Friends", "Family", "A group"],
  energy: ["Chill & relaxed", "A little of both", "Active & adventurous"],
  vibes: [
    "Budget-friendly",
    "Cute & romantic",
    "Exciting",
    "Cozy",
    "Trendy",
    "Hidden gems",
    "Luxurious",
    "Anything goes",
  ],
  budget: ["Free", "Affordable", "Moderate", "Treat myself"],
  date: ["Today", "Tomorrow", "I’m flexible"],
  duration: ["A quick outing", "A few hours", "Half a day", "All day"],
};
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
type GeometrySample = {
  heading: string;
  viewport: { width: number; height: number };
  boxes: Record<
    string,
    { x: number; y: number; width: number; height: number }
  >;
  scroll: { top: number; excess: number }[];
};

async function beginWithoutLocation(page: Page) {
  // Keep Today selectable regardless of the CI machine's actual hour. The
  // final request uses Tomorrow, which remains future relative to the backend.
  const morning = new Date();
  morning.setUTCHours(14, 0, 0, 0);
  await page.clock.install({ time: morning });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page
    .getByRole("switch", {
      name: "Use synthetic development fixtures",
      exact: true,
    })
    .check();
  await button(page, "Let’s find something good").click();
  await expect(page).toHaveURL(/\/planner/);
  await expect(
    page
      .getByTestId("planner-question")
      .getByText(questions[0], { exact: true }),
  ).toBeVisible();
}

async function fullyInView(page: Page, locator: Locator, label: string) {
  await expect(locator, label).toBeInViewport({ ratio: 1 });
  const bounds = await locator.boundingBox(),
    viewport = page.viewportSize()!;
  expect(bounds, label).not.toBeNull();
  expect(bounds!.x, `${label}: left edge`).toBeGreaterThanOrEqual(-1);
  expect(bounds!.y, `${label}: top edge`).toBeGreaterThanOrEqual(-1);
  expect(bounds!.x + bounds!.width, `${label}: right edge`).toBeLessThanOrEqual(
    viewport.width + 1,
  );
  expect(
    bounds!.y + bounds!.height,
    `${label}: bottom edge`,
  ).toBeLessThanOrEqual(viewport.height + 1);
  return bounds!;
}

async function geometry(
  page: Page,
  index: number,
  names: string[],
  samples: GeometrySample[],
) {
  await expect(
    page
      .getByTestId("planner-question")
      .getByText(questions[index], { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const question = page.getByTestId("planner-question"),
    footer = page.getByTestId("planner-footer");
  const progress = page.getByRole("progressbar", {
    name: "Planning progress",
    exact: true,
  });
  await expect(progress).toHaveAttribute("aria-valuenow", String(index + 1));
  await expect(progress).toHaveAttribute("aria-valuemax", "8");
  const boxes: GeometrySample["boxes"] = {};
  boxes.Back = await fullyInView(page, button(page, "Back"), "Back");
  boxes.footer = await fullyInView(page, footer, "Pinned planning footer");
  boxes.heading = await fullyInView(
    page,
    question.getByText(questions[index], { exact: true }),
    questions[index],
  );
  const nextName = index === 0 ? "That’s the place" : "Next";
  boxes[nextName] = await fullyInView(page, button(page, nextName), nextName);
  expect(boxes[nextName].height).toBeGreaterThanOrEqual(43);
  for (const name of names) {
    const choice = button(page, name);
    boxes[name] = await fullyInView(
      page,
      choice,
      `${questions[index]}: ${name}`,
    );
    expect(
      boxes[name].height,
      `${name}: reachable touch target`,
    ).toBeGreaterThanOrEqual(43);
    expect(
      boxes[name].y + boxes[name].height,
      `${name}: not hidden under the footer`,
    ).toBeLessThanOrEqual(boxes.footer.y + 1);
  }
  if (index === 0)
    boxes.search = await fullyInView(
      page,
      page.getByRole("textbox", { name: "Search a place", exact: true }),
      "Place search",
    );
  if (index === 5 || index === 7) {
    const label =
      index === 5 ? "Custom budget per person" : "Custom duration in minutes";
    boxes.custom = await fullyInView(
      page,
      page.getByRole("textbox", { name: label, exact: true }),
      label,
    );
    expect(
      boxes.custom.y + boxes.custom.height,
      `${label}: not hidden under the footer`,
    ).toBeLessThanOrEqual(boxes.footer.y + 1);
  }
  if (index === 6) {
    boxes.calendar = await fullyInView(
      page,
      page.getByRole("button", { name: /^(?:\d{4}-\d{2}-\d{2}|Pick a date)$/ }),
      "Custom date picker",
    );
    expect(boxes.calendar.y + boxes.calendar.height).toBeLessThanOrEqual(
      boxes.footer.y + 1,
    );
  }
  if (index !== 0) {
    await fullyInView(page, button(page, "Skip for now"), "Skip for now");
    await fullyInView(page, button(page, "Make my day"), "Make my day");
  }
  // Check before clicking choices: Playwright's click must not hide a bad
  // layout by scrolling an off-screen choice into view automatically.
  const scroll = await question.evaluate((element) => {
    const nodes = new Set<HTMLElement>([
      element as HTMLElement,
      ...element.querySelectorAll<HTMLElement>("*"),
    ]);
    for (
      let parent = element.parentElement;
      parent;
      parent = parent.parentElement
    )
      nodes.add(parent);
    return [...nodes]
      .filter(
        (node) =>
          node.clientHeight > 0 &&
          /auto|scroll/.test(getComputedStyle(node).overflowY),
      )
      .map((node) => ({
        top: node.scrollTop,
        excess: node.scrollHeight - node.clientHeight,
      }));
  });
  expect(
    scroll.every((node) => Math.abs(node.top) <= 1),
    "The core question must not need a scroll reset to expose choices",
  ).toBe(true);
  expect(
    scroll.every((node) => node.excess <= 1),
    "All normal-size core content fits without scrolling",
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "No horizontal document overflow",
  ).toBe(true);
  samples.push({
    heading: questions[index],
    viewport: page.viewportSize()!,
    boxes,
    scroll,
  });
}

async function exerciseChoices(page: Page, names: string[], multiple = false) {
  for (const name of names) {
    const choice = button(page, name);
    await choice.click();
    await expect(choice).toHaveAttribute("aria-pressed", "true");
    if (multiple) {
      await choice.click();
      await expect(choice).toHaveAttribute("aria-pressed", "false");
    }
  }
}

async function allQuestions(page: Page, info: TestInfo) {
  const samples: GeometrySample[] = [];
  const captured = new Set<number>();
  async function checkQuestion(index: number, names: string[]) {
    await geometry(page, index, names, samples);
    if (!captured.has(index)) {
      captured.add(index);
      const path = info.outputPath(`browser-planner-question-${index + 1}.png`);
      await page.screenshot({ path });
      await info.attach(`RN Web question ${index + 1}: ${questions[index]}`, {
        path,
        contentType: "image/png",
      });
    }
  }
  await beginWithoutLocation(page);
  await checkQuestion(0, ["Near me"]);
  const search = page.getByRole("textbox", {
    name: "Search a place",
    exact: true,
  });
  await search.fill("Toronto");
  await fullyInView(
    page,
    button(page, "CF Toronto Eaton Centre"),
    "Provider search result",
  );
  await button(page, "CF Toronto Eaton Centre").click();
  await expect(button(page, "That’s the place")).toBeEnabled();
  await button(page, "That’s the place").click();

  await checkQuestion(1, choices.interests);
  await exerciseChoices(page, choices.interests, true);
  await button(page, "Food & drinks").click();
  await button(page, "Next").click();

  await checkQuestion(2, choices.companion);
  await exerciseChoices(page, choices.companion);
  await button(page, "A date").click();
  await checkQuestion(2, choices.companion);
  await button(page, "Next").click();
  await checkQuestion(3, choices.energy);
  await button(page, "Back").click();
  await expect(button(page, "A date")).toHaveAttribute("aria-pressed", "true");
  await checkQuestion(2, choices.companion);
  await button(page, "Next").click();
  await exerciseChoices(page, choices.energy);
  await button(page, "A little of both").click();
  await button(page, "Next").click();

  await checkQuestion(4, choices.vibes);
  await exerciseChoices(page, choices.vibes, true);
  await button(page, "Cozy").click();
  await button(page, "Next").click();
  await checkQuestion(5, choices.budget);
  await exerciseChoices(page, choices.budget);
  await button(page, "Moderate").click();
  await button(page, "Next").click();
  await checkQuestion(6, choices.date);
  await exerciseChoices(page, choices.date);
  await button(page, "Tomorrow").click();
  await button(page, "Next").click();
  await checkQuestion(7, choices.duration);
  await exerciseChoices(page, choices.duration);
  await button(page, "A few hours").click();
  await button(page, "Next").click();

  await expect(
    page.getByText("Your day,\nyour way.", { exact: true }),
  ).toBeVisible();
  await fullyInView(page, button(page, "Back"), "Ready Back");
  await fullyInView(page, button(page, "Make my day"), "Ready Make my day");
  const submitted = page.waitForRequest((request) =>
    request.url().endsWith("/api/generate"),
  );
  await button(page, "Make my day").click();
  expect((await submitted).postDataJSON()).toMatchObject({
    demo: true,
    request: {
      interests: ["Food & drinks"],
      companion: "date",
      participants: 2,
      energy: "balanced",
      vibes: ["cozy"],
      budget: 60,
      duration: 240,
    },
  });
  await expect(page).toHaveURL(/\/plan\/[a-f\d-]+/);
  await mkdir(info.outputDir, { recursive: true });
  const path = info.outputPath("browser-portrait-question-geometry.json");
  await writeFile(path, JSON.stringify(samples, null, 2));
  await info.attach("browser-portrait-question-geometry", {
    path,
    contentType: "application/json",
  });
}

for (const [width, height] of [
  [360, 800],
  [390, 844],
  [430, 932],
]) {
  test(`RN Web portrait ${width}×${height}: every core question and choice fits with reachable Back and footer`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height });
    await allQuestions(page, info);
  });
}
test("RN Web reduced content space: 360×722 leaves an illustrative 78px reserve from an 800px screen", async ({
  page,
}, info) => {
  // This models less available layout space; it does not inject or verify
  // Android/iOS safe-area insets, browser chrome or system navigation bars.
  await page.setViewportSize({ width: 360, height: 722 });
  await allQuestions(page, info);
});

for (const [width, height] of [
  [360, 800],
  [390, 844],
  [430, 932],
]) {
  test(`RN Web input focus and reduced keyboard space at ${width}×${height} keep footer and optional details reachable`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await beginWithoutLocation(page);
    await page
      .getByRole("textbox", { name: "Search a place", exact: true })
      .fill("Toronto");
    await button(page, "CF Toronto Eaton Centre").click();
    await button(page, "That’s the place").click();
    for (let step = 1; step < 5; step++) {
      await expect(
        page.getByText(questions[step], { exact: true }),
      ).toBeVisible();
      await button(page, "Skip for now").click();
    }
    const budget = page.getByRole("textbox", {
      name: "Custom budget per person",
      exact: true,
    });
    await budget.fill("72.5");
    await expect(budget).toBeFocused();
    // Shrinking the browser's content viewport is deliberately only a layout
    // stress sample. RN Web does not open or validate an OS software keyboard.
    await page.setViewportSize({ width, height: height - 320 });
    await fullyInView(
      page,
      button(page, "Back"),
      "Back with reduced input space",
    );
    await fullyInView(
      page,
      button(page, "Next"),
      "Next with reduced input space",
    );
    await budget.scrollIntoViewIfNeeded();
    await fullyInView(page, budget, "Custom budget with reduced input space");
    await button(page, "Next").click();
    await expect(page.getByText(questions[6], { exact: true })).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () => document.activeElement?.matches("input,textarea") ?? false,
        ),
      )
      .toBe(false);
    await page.setViewportSize({ width, height });
    await button(page, "Back").click();
    await expect(budget).toHaveValue("72.5");
    await button(page, "Next").click();
    await button(page, "Tomorrow").click();
    await button(page, "Next").click();
    const duration = page.getByRole("textbox", {
      name: "Custom duration in minutes",
      exact: true,
    });
    await duration.fill("240");
    await expect(duration).toBeFocused();
    await page.setViewportSize({ width, height: height - 320 });
    await fullyInView(
      page,
      button(page, "Back"),
      "Duration Back with reduced input space",
    );
    await fullyInView(
      page,
      button(page, "Next"),
      "Duration Next with reduced input space",
    );
    await button(page, "Next").click();
    await expect(
      page.getByText("Your day,\nyour way.", { exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () => document.activeElement?.matches("input,textarea") ?? false,
        ),
      )
      .toBe(false);
    await page.setViewportSize({ width, height });

    await button(page, "Review day details").click();
    const details = page.getByRole("dialog", {
      name: "The little details",
      exact: true,
    });
    await expect(details).toBeVisible();
    const startTime = details.getByRole("textbox", {
      name: "Start time HH:mm",
      exact: true,
    });
    await startTime.fill("12:30");
    await expect(startTime).toBeFocused();
    await page.setViewportSize({ width, height: height - 320 });
    const done = details.getByRole("button", { name: "All set", exact: true });
    await done.scrollIntoViewIfNeeded();
    await fullyInView(
      page,
      done,
      "Dismiss optional details with reduced input space",
    );
    await done.click();
    await expect(details).not.toBeVisible();
    await page.setViewportSize({ width, height });
    await fullyInView(
      page,
      button(page, "Make my day"),
      "Make my day after dismissing inputs",
    );
    const submitted = page.waitForRequest((request) =>
      request.url().endsWith("/api/generate"),
    );
    await button(page, "Make my day").click();
    expect((await submitted).postDataJSON().request).toMatchObject({
      budget: 72.5,
      duration: 240,
      startTime: "12:30",
    });
    await expect(page).toHaveURL(/\/plan\/[a-f\d-]+/);
  });
}
