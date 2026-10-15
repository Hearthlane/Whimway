import { test, expect, type Page, type Route } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";

// These journeys execute the actual React Native screen source via RN Web.
// They exercise fixture APIs, persistence and layout; they are not OS/device tests.
const screenshots = "docs/screenshots/mobile-preview";
const errors = new WeakMap<Page, string[]>();
const network = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  errors.set(page, []);
  network.set(page, []);
  page.on("pageerror", (error) => errors.get(page)?.push(error.message));
  page.on("requestfailed", (request) =>
    network
      .get(page)
      ?.push(
        `${request.method()} ${request.url()} ${request.failure()?.errorText}`,
      ),
  );
  page.on("response", (response) => {
    if (response.status() >= 400)
      network.get(page)?.push(`${response.status()} ${response.url()}`);
  });
});
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus)
    await info.attach("preview-network-failures", {
      body: (network.get(page) ?? []).join("\n"),
      contentType: "text/plain",
    });
  expect(errors.get(page), "Uncaught preview exceptions").toEqual([]);
});

async function shot(page: Page, name: string) {
  await mkdir(screenshots, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${screenshots}/${name}.png`, fullPage: true });
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
async function auditAccessibility(page: Page, label: string) {
  await page.evaluate(() => document.fonts.ready);
  const report = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    report.violations.map((v) => ({
      id: v.id,
      targets: v.nodes.map((n) => n.target),
    })),
    label,
  ).toEqual([]);
}

async function start(page: Page, prompt = "") {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByText("Where are we heading?", { exact: true }),
  ).toBeVisible();
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
  if (prompt) {
    await page
      .getByRole("button", { name: "Describe a day", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Describe your ideal outing" })
      .fill(prompt);
  }
  await page
    .getByRole("button", {
      name: prompt ? "Make it my kind of day" : "Let’s find something good",
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(/\/planner/);
}
async function generate(page: Page) {
  await start(page);
  await page
    .getByRole("button", { name: "Food & drinks", exact: true })
    .click();
  await page.getByRole("button", { name: "Make my day", exact: true }).click();
  await expect(page).toHaveURL(/\/plan\/[a-f\d-]+/);
  await expect(page.getByRole("button", { name: /^Customize / })).toHaveCount(
    4,
  );
}

test("Explore, Saved and Profile render at representative portrait widths", async ({
  page,
}) => {
  for (const [width, height] of [
    [375, 667],
    [360, 800],
    [390, 844],
    [430, 932],
    [412, 915],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByText("Where are we heading?", { exact: true }),
    ).toBeVisible();
    const action = await page
      .getByRole("button", {
        name: "Let’s find something good",
        exact: true,
      })
      .boundingBox();
    const navigation = await page
      .getByRole("tab", { name: "Explore", exact: true })
      .boundingBox();
    expect(action).not.toBeNull();
    expect(navigation).not.toBeNull();
    expect(action!.y + action!.height).toBeLessThan(navigation!.y);
    if (width === 375) {
      const search = page.getByRole("textbox", {
        name: "Search a place",
        exact: true,
      });
      await search.focus();
      await expect(search).toBeFocused();
      await shot(page, "explore-search-focused-375");
      await page.getByText("Where are we heading?", { exact: true }).click();
      await expect(search).not.toBeFocused();
    }
    await noOverflow(page);
    await shot(page, `explore-${width}`);
  }
  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto("/saved", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByText("Your next good day lives here.", { exact: true }),
  ).toBeVisible();
  await noOverflow(page);
  await shot(page, "saved-empty-430");
  await page.goto("/profile", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByText("Guest, with all the good stuff.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Usual budget", exact: true })
    .fill("80");
  await page
    .getByRole("button", { name: "Save my preferences", exact: true })
    .click();
  await expect(
    page.getByText("Preferences saved on this device.", { exact: true }),
  ).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("textbox", { name: "Usual budget", exact: true }),
  ).toHaveValue("80");
  await noOverflow(page);
  await shot(page, "profile-430");
});

test("Wide preview keeps a portrait canvas and Explore preserves both entry choices", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const search = page.getByRole("textbox", {
    name: "Search a place",
    exact: true,
  });
  const idea = page.getByRole("textbox", {
    name: "Describe your ideal outing",
    exact: true,
  });
  const explore = page.getByRole("tab", { name: "Explore", exact: true });
  const pick = page.getByRole("button", { name: "Pick a place", exact: true });
  const describe = page.getByRole("button", {
    name: "Describe a day",
    exact: true,
  });
  const tabs = await page.getByRole("tablist").boundingBox();
  expect(tabs).not.toBeNull();
  expect(tabs!.width).toBe(430);
  expect(tabs!.x).toBe((1280 - 430) / 2);
  await expect(pick).toHaveAttribute("aria-pressed", "true");
  await expect(idea).not.toBeVisible();
  await search.fill("My unfinished search");
  await describe.click();
  await expect(search).not.toBeVisible();
  await expect(describe).toHaveAttribute("aria-pressed", "true");
  await idea.fill("A quiet afternoon with coffee");
  await pick.click();
  await expect(search).toHaveValue("My unfinished search");
  await describe.click();
  await expect(idea).toHaveValue("A quiet afternoon with coffee");
  await noOverflow(page);
  await shot(page, "explore-portrait-canvas-1280");
  await auditAccessibility(page, "portrait Explore entry choices");
  await explore.click();
  await page.goto("/profile", { waitUntil: "domcontentloaded" });
  await page
    .getByRole("button", { name: "More personal preferences", exact: true })
    .click();
  const sheet = await page
    .getByRole("dialog", { name: "A little more you", exact: true })
    .boundingBox();
  expect(sheet).not.toBeNull();
  expect(sheet!.width).toBe(430);
  expect(sheet!.x).toBe(tabs!.x);
  await shot(page, "profile-portrait-sheet-1280");
});

test("Guided planning skips, preserves Back state, generates early and reopens from Saved", async ({
  page,
}) => {
  await start(page);
  const details = page.getByRole("button", {
    name: "Review day details",
    exact: true,
  });
  const defaults = page.getByText(
    "Unchosen details use these starting choices. Adjust them anytime.",
    { exact: true },
  );
  await expect(details).toHaveAttribute("aria-expanded", "false");
  await expect(defaults).not.toBeVisible();
  await details.click();
  await expect(defaults).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "The little details" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(details).toHaveAttribute("aria-expanded", "false");
  await expect(defaults).not.toBeVisible();
  await page
    .getByRole("button", { name: "Food & drinks", exact: true })
    .click();
  await shot(page, "planner-interests-390");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("Who’s joining?", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "A date", exact: true }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(
    page.getByText("What sounds fun?", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Skip for now", exact: true }).click();
  await expect(
    page.getByText("What’s your energy today?", { exact: true }),
  ).toBeVisible();
  const balanced = page.getByRole("button", {
    name: "A little of both",
    exact: true,
  });
  await balanced.click();
  await expect(balanced).toHaveAttribute("aria-pressed", "true");
  await auditAccessibility(page, "selected energy choices and planner details");
  await shot(page, "planner-energy-390");
  const submitted = page.waitForRequest((request) =>
    request.url().endsWith("/api/generate"),
  );
  await page.getByRole("button", { name: "Make my day", exact: true }).click();
  const requested = (await submitted).postDataJSON().request;
  expect(requested.interests).toContain("Food & drinks");
  expect(requested.energy).toBe("balanced");
  await expect(page).toHaveURL(/\/plan\/[a-f\d-]+/);
  await expect(page.getByRole("button", { name: /^Customize / })).toHaveCount(
    4,
  );
  const url = page.url();
  await noOverflow(page);
  await shot(page, "plan-390");
  await page
    .getByRole("button", { name: /^Show .* on map$/ })
    .first()
    .scrollIntoViewIfNeeded();
  await shot(page, "itinerary-stops-390");
  await page.getByRole("button", { name: "Map", exact: true }).click();
  await expect(
    page.getByText(/Interactive maps and location following are available/),
  ).toBeVisible();
  await shot(page, "plan-map-preview-390");
  await page.goto("/saved", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("button", { name: /^A day with a little more whim/ }),
  ).toBeVisible();
  await expect(
    page.getByText("Opening your collection…", { exact: true }),
  ).not.toBeVisible();
  await shot(page, "saved-plan-390");
  await page
    .getByRole("button", { name: /^A day with a little more whim/ })
    .click();
  await expect(page).toHaveURL(url);
  await expect(page.getByRole("button", { name: /^Customize / })).toHaveCount(
    4,
  );
});

test("Small-phone planner remains reachable with a 200 percent browser text sample", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await start(page);
  // A browser approximation of enlarged text, not an Android/iOS fontScale test.
  await page.evaluate(() => {
    const enlarged = new WeakSet<HTMLElement>();
    function enlargeText() {
      const text = [
        ...document.querySelectorAll<HTMLElement>(
          "div,span,input,textarea,button",
        ),
      ].filter(
        (element) =>
          !enlarged.has(element) &&
          (element.matches("input,textarea") ||
            [...element.childNodes].some(
              (node) =>
                node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
            )),
      );
      const values = text.map((element) => ({
        element,
        font: getComputedStyle(element).fontSize,
        line: getComputedStyle(element).lineHeight,
      }));
      for (const { element, font, line } of values) {
        enlarged.add(element);
        element.style.setProperty(
          "font-size",
          `${parseFloat(font) * 2}px`,
          "important",
        );
        if (line !== "normal")
          element.style.setProperty(
            "line-height",
            `${parseFloat(line) * 2}px`,
            "important",
          );
      }
    }
    enlargeText();
    new MutationObserver(enlargeText).observe(document.body, {
      childList: true,
      subtree: true,
    });
  });
  await noOverflow(page);
  await shot(page, "planner-large-text-top-preview-375");
  const longChoice = page.getByRole("button", {
    name: "Games & entertainment",
    exact: true,
  });
  const choiceBounds = await longChoice.boundingBox();
  expect(choiceBounds).not.toBeNull();
  expect(choiceBounds!.x + choiceBounds!.width).toBeLessThanOrEqual(375);
  expect(
    await longChoice.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  const make = page.getByRole("button", { name: "Make my day", exact: true });
  await make.scrollIntoViewIfNeeded();
  await expect(make).toBeVisible();
  const bounds = await make.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(375);
  await shot(page, "planner-large-text-preview-375");
  const next = page.getByRole("button", { name: "Next", exact: true });
  await next.scrollIntoViewIfNeeded();
  await next.click();
  await expect(
    page.getByText("Who’s joining?", { exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(
    page.getByText("What sounds fun?", { exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await make.scrollIntoViewIfNeeded();
  await make.click();
  await expect(page).toHaveURL(/\/plan\/[a-f\d-]+/);
});

test("Complete prompt prefills supplied constraints without repeat questions", async ({
  page,
}) => {
  // OpenAI credentials are absent. Mock its validated intent response only;
  // discovery/generation still execute the backend's explicit fixture adapter.
  await page.route("**/api/intent", (route) =>
    route.fulfill({
      json: {
        locationQuery: "Toronto",
        dateChoice: "tomorrow",
        budget: 70,
        duration: 240,
        participants: 2,
        companion: "date",
        energy: "balanced",
        vibes: ["exciting"],
        interests: ["Food & drinks", "Shopping", "Interactive fun"],
        warnings: [],
      },
    }),
  );
  await start(
    page,
    "Plan a fun date around Toronto tomorrow at a balanced pace. We have $70 each, four hours and want food, shopping and something exciting.",
  );
  await expect(page.getByText("Ready", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Review day details", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog", { name: "The little details", exact: true })
      .getByText("4 hours · CAD 70 / person", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/ · Walking$/)).toBeVisible();
  await expect(
    page.getByText("What’s your budget?", { exact: true }),
  ).not.toBeVisible();
  await shot(page, "planner-prompt-prefill-390");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  const request = page.waitForRequest((request) =>
    request.url().endsWith("/api/generate"),
  );
  await page.getByRole("button", { name: "Make my day", exact: true }).click();
  const body = (await request).postDataJSON();
  expect(body.request.budget).toBe(70);
  expect(body.request.participants).toBe(2);
  expect(body.request.energy).toBe("balanced");
  expect(body.request.duration).toBe(240);
  expect(body.request.interests).toEqual(
    expect.arrayContaining(["Food & drinks", "Shopping"]),
  );
  await expect(page).toHaveURL(/\/plan\/[a-f\d-]+/);
});

test("Editing preserves locks and updates itinerary revision; live progress persists", async ({
  page,
}) => {
  await generate(page);
  const controls = page.getByRole("button", { name: /^Customize / });
  const firstLabel = await controls.first().getAttribute("aria-label");
  await controls.first().click();
  await page
    .getByRole("button", { name: "Lock this stop", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Lock this stop", exact: true }),
  ).not.toBeVisible();
  await controls.nth(1).click();
  await page.getByRole("button", { name: "Remove stop", exact: true }).click();
  await expect(controls).toHaveCount(3);
  await page.getByRole("button", { name: "Day Remix ✦", exact: true }).click();
  await page
    .getByRole("button", { name: "More relaxing", exact: true })
    .click();
  await expect(
    page.getByText("Your route, timing and estimates are updated.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: firstLabel!, exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Unlock stop", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Start my day", exact: true }).click();
  await expect(page).toHaveURL(/\/day\//);
  await expect(
    page.getByText("0 DONE · 0 SKIPPED", { exact: true }),
  ).toBeVisible();
  await auditAccessibility(page, "Day progress and guidance layout");
  await shot(page, "day-390");
  await page
    .getByRole("button", { name: "I’m done here ✓", exact: true })
    .click();
  await expect(
    page.getByText("1 DONE · 0 SKIPPED", { exact: true }),
  ).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByText("1 DONE · 0 SKIPPED", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Skip this stop", exact: true })
    .click();
  await expect(
    page.getByText("1 DONE · 1 SKIPPED", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/Turn-by-turn voice navigation is unavailable/),
  ).toBeVisible();
});

test("Reminders opt-in is honest on preview; generation failures retry without fake plans", async ({
  page,
}) => {
  await generate(page);
  await page
    .getByRole("button", { name: "Want reminders for your day?", exact: true })
    .click();
  await shot(page, "reminders-390");
  await page
    .getByRole("button", { name: "Yes, remind me", exact: true })
    .click();
  await expect(
    page.getByText(
      "Reminders are available in the native iOS or Android app.",
      { exact: true },
    ),
  ).toBeVisible();
  await start(page);
  await page.route("**/api/generate", (route) =>
    route.fulfill({
      status: 503,
      json: {
        error: "Provider configuration is missing.",
        code: "NOT_CONFIGURED",
      },
    }),
  );
  await page.getByRole("button", { name: "Make my day", exact: true }).click();
  await expect(
    page.getByText("Provider configuration is missing.", { exact: true }),
  ).toBeVisible();
  await shot(page, "generation-error-390");
  await page.unroute("**/api/generate");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page).toHaveURL(/\/plan\/[a-f\d-]+/);
});

test("Preview text contrast and controls meet automated accessibility checks", async ({
  page,
}) => {
  async function audit(label: string) {
    await auditAccessibility(page, label);
  }
  for (const route of ["/", "/saved", "/profile"]) {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await expect(
      page.getByText(
        route === "/"
          ? "Where are we heading?"
          : route === "/saved"
            ? "Your next good day lives here."
            : "Guest, with all the good stuff.",
        { exact: true },
      ),
    ).toBeVisible();
    await audit(route);
  }
  await start(page);
  await expect(
    page.getByText("What sounds fun?", { exact: true }),
  ).toBeVisible();
  await audit("adaptive planner");
  await page.getByRole("button", { name: "Make my day", exact: true }).click();
  await expect(page).toHaveURL(/\/plan\/[a-f\d-]+/);
  await expect(page.getByRole("button", { name: /^Customize / })).toHaveCount(
    4,
  );
  await audit("itinerary");
  await page
    .getByRole("button", { name: /^Show .* on map$/ })
    .first()
    .click();
  await shot(page, "plan-map-selected-390");
  await page
    .getByRole("button", { name: "See this stop", exact: true })
    .click();
  await shot(page, "itinerary-selected-stop-390");
  await audit("selected itinerary marker");
  await page.getByRole("button", { name: "Start my day", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "I’m done here ✓", exact: true }),
  ).toBeVisible();
  await audit("active day");
});

test("Replacement, add, reorder, duration, budget, transport and favorite places use real fixture operations", async ({
  page,
}) => {
  await generate(page);
  const controls = page.getByRole("button", { name: /^Customize / });
  const firstLabel = await controls.first().getAttribute("aria-label");
  await page.getByRole("button", { name: "Adjust plan", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Plan duration", exact: true })
    .fill("480");
  await page
    .getByRole("textbox", { name: "Plan budget", exact: true })
    .fill("50");
  const constraints = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/edit") && response.status() === 200,
  );
  await page
    .getByRole("button", { name: "Update my plan", exact: true })
    .click();
  const changed = await (await constraints).json();
  expect(changed.request.duration).toBe(480);
  expect(changed.request.budget).toBe(50);
  await expect(
    page.getByRole("button", { name: "Update my plan", exact: true }),
  ).not.toBeVisible();

  await controls.nth(1).click();
  await page
    .getByRole("button", { name: "Find a replacement", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Trinity Square", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Customize Trinity Square", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add a stop +", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Search for an activity", exact: true })
    .fill("St. Lawrence");
  await page
    .getByRole("button", { name: "Find real places", exact: true })
    .click();
  await page
    .getByRole("button", { name: "St. Lawrence Market", exact: true })
    .click();
  await expect(controls).toHaveCount(5);
  await page
    .getByRole("button", { name: "Customize St. Lawrence Market", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Visit duration in minutes", exact: true })
    .fill("55");
  const visit = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/edit") && response.status() === 200,
  );
  await page
    .getByRole("button", { name: "Update visit duration", exact: true })
    .click();
  const updated = await (await visit).json();
  expect(
    updated.stops.find(
      (s: { place: { name: string } }) =>
        s.place.name === "St. Lawrence Market",
    ).minutes,
  ).toBe(55);
  const beforeOrder = updated.stops.map((s: { placeId: string }) => s.placeId);
  await page
    .getByRole("button", { name: "Customize St. Lawrence Market", exact: true })
    .click();
  const reordered = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/edit") && response.status() === 200,
  );
  await page.getByRole("button", { name: "Move earlier", exact: true }).click();
  const afterOrder = await (await reordered).json();
  expect(
    afterOrder.stops.map((s: { placeId: string }) => s.placeId),
  ).not.toEqual(beforeOrder);
  expect(afterOrder.revision).toBeGreaterThan(updated.revision);
  expect(afterOrder.legs.length).toBe(4);

  await page.getByRole("button", { name: "Adjust plan", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Plan budget", exact: true })
    .fill("95");
  await page
    .getByRole("textbox", { name: "Plan duration", exact: true })
    .fill("270");
  await page.getByRole("button", { name: "Driving", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Driving", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("textbox", { name: "Plan budget", exact: true }),
  ).toHaveValue("95");
  await expect(
    page.getByRole("textbox", { name: "Plan duration", exact: true }),
  ).toHaveValue("270");
  await shot(page, "plan-settings-combined-390");
  const transport = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/edit") && response.status() === 200,
  );
  await page
    .getByRole("button", { name: "Update my plan", exact: true })
    .click();
  const combinedSettings = await (await transport).json();
  expect(combinedSettings.request).toMatchObject({
    mode: "DRIVE",
    budget: 95,
    duration: 270,
  });
  await expect(
    page.getByRole("button", { name: "Update my plan", exact: true }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: firstLabel!, exact: true }).click();
  await page
    .getByRole("button", { name: "Save to favourite places", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save to favourite places", exact: true }),
  ).not.toBeVisible();
  await page.goto("/saved", { waitUntil: "domcontentloaded" });
  await page
    .getByRole("button", { name: "Favorite places · 1", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "View place", exact: true }),
  ).toBeVisible();
  await shot(page, "favorite-places-390");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page
    .getByRole("button", { name: "Favorite places · 1", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "View place", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Remove favorite / }).click();
  await expect(
    page.getByText("Keep the places that click.", { exact: true }),
  ).toBeVisible();
});

test("Missing live intent and denied browser location preserve guided access", async ({
  page,
  context,
}) => {
  await start(page, "A relaxed coffee and art afternoon.");
  await expect(
    page.getByText(/You can still choose your preferences below/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Food & drinks", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Make my day", exact: true }).click();
  await expect(page).toHaveURL(/\/plan\/[a-f\d-]+/);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await context.clearPermissions();
  await page.getByRole("button", { name: "Near me", exact: true }).click();
  await expect(
    page.getByText(
      /Location is off|User denied Geolocation|Location permission/,
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Search a place", exact: true }),
  ).toBeEditable();
  await shot(page, "location-denied-preview-390");
});

test("Cancelling pending generation preserves choices and never saves a cancelled plan", async ({
  page,
}) => {
  await start(page);
  await page
    .getByRole("button", { name: "Food & drinks", exact: true })
    .click();
  let release: (route: Route) => void = () => {};
  const intercepted = new Promise<Route>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/generate", (route) => {
    release(route);
  });
  await page.getByRole("button", { name: "Make my day", exact: true }).click();
  const pending = await intercepted;
  await expect(
    page.getByText("Preparing your outing", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page).toHaveURL(/\/planner/);
  await expect(
    page.getByText("What sounds fun?", { exact: true }),
  ).toBeVisible();
  // The network gate exercises cancellation, not a successful simulated plan.
  await pending.abort("aborted").catch(() => {});
  await page.unroute("**/api/generate");
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("whimway:native:plans:v1") ?? "[]"),
    ),
  ).toEqual([]);
  const generated = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/generate") && response.status() === 200,
  );
  await page.getByRole("button", { name: "Make my day", exact: true }).click();
  expect((await (await generated).json()).request.interests).toContain(
    "Food & drinks",
  );
  await expect(page).toHaveURL(/\/plan\/[a-f\d-]+/);
});

test("Offline and failed edits preserve the original plan; Saved hydration can recover", async ({
  page,
  context,
}) => {
  const generated = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/generate") && response.status() === 200,
  );
  await generate(page);
  const original = await (await generated).json();
  const labels = await page
    .getByRole("button", { name: /^Customize / })
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("aria-label")),
    );
  await page
    .getByRole("button", { name: /^Customize / })
    .nth(1)
    .click();
  await context.setOffline(true);
  await page.getByRole("button", { name: "Remove stop", exact: true }).click();
  await expect(page.getByText(/Could not reach Whimway/).last()).toBeVisible();
  await context.setOffline(false);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  expect(
    await page
      .getByRole("button", { name: /^Customize / })
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("aria-label")),
      ),
  ).toEqual(labels);
  const reopened = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/hydrate") && response.status() === 200,
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  const restored = await (await reopened).json();
  expect(restored.revision).toBe(original.revision);
  expect(
    restored.stops.map((stop: { placeId: string }) => stop.placeId),
  ).toEqual(original.stops.map((stop: { placeId: string }) => stop.placeId));
  await expect(page.getByRole("button", { name: /^Customize / })).toHaveCount(
    original.stops.length,
  );
  await page.route("**/api/hydrate", (route) =>
    route.abort("internetdisconnected"),
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText(/Could not reach Whimway/)).toBeVisible();
  await shot(page, "saved-reopen-network-error-390");
  await page.unroute("**/api/hydrate");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Customize / })).toHaveCount(
    original.stops.length,
  );
});

test.describe("Question motion", () => {
  test.use({ reducedMotion: "no-preference" });
  test("Forward and Back keep visible question state and accessible progress synchronized", async ({
    page,
  }) => {
    await start(page);
    const progress = page.getByRole("progressbar", {
      name: "Planning progress",
      exact: true,
    });
    await expect(progress).toHaveAttribute("aria-valuenow", "1");
    await page
      .getByRole("button", { name: "Food & drinks", exact: true })
      .click();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(
      page.getByText("Who’s joining?", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("What sounds fun?", { exact: true }),
    ).not.toBeVisible();
    await expect(progress).toHaveAttribute("aria-valuenow", "2");
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(
      page.getByText("What sounds fun?", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Who’s joining?", { exact: true }),
    ).not.toBeVisible();
    await expect(progress).toHaveAttribute("aria-valuenow", "1");
    const request = page.waitForRequest((request) =>
      request.url().endsWith("/api/generate"),
    );
    await page
      .getByRole("button", { name: "Make my day", exact: true })
      .click();
    expect((await request).postDataJSON().request.interests).toContain(
      "Food & drinks",
    );
    await expect(page).toHaveURL(/\/plan\/[a-f\d-]+/);
  });
});

test("Optional personal preferences and avoided places feed the next real fixture request", async ({
  page,
}) => {
  await page.goto("/profile", { waitUntil: "domcontentloaded" });
  await page
    .getByRole("switch", {
      name: "Use saved preferences when planning",
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "More personal preferences", exact: true })
    .click();
  const preferences = page.getByRole("dialog", {
    name: "A little more you",
    exact: true,
  });
  await preferences
    .getByRole("textbox", { name: "Favourite cuisines", exact: true })
    .fill("Italian");
  await preferences
    .getByRole("textbox", { name: "Preferred atmosphere", exact: true })
    .fill("quiet");
  await preferences
    .getByRole("button", { name: "Save my preferences", exact: true })
    .click();
  await expect(preferences).not.toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page
    .getByRole("button", { name: "More personal preferences", exact: true })
    .click();
  await expect(
    preferences.getByRole("textbox", {
      name: "Favourite cuisines",
      exact: true,
    }),
  ).toHaveValue("Italian");
  await expect(
    preferences.getByRole("textbox", {
      name: "Preferred atmosphere",
      exact: true,
    }),
  ).toHaveValue("quiet");
  await shot(page, "profile-personal-preferences-390");
  await auditAccessibility(page, "personal preferences sheet");
  await preferences.getByRole("button", { name: "Close", exact: true }).click();
  await start(page);
  const first = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/generate") && response.status() === 200,
  );
  await page.getByRole("button", { name: "Make my day", exact: true }).click();
  const plan = await (await first).json();
  expect(plan.request.prompt).toContain("Italian");
  expect(plan.request.prompt).toContain("quiet");
  await page
    .getByRole("button", { name: /^Customize / })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Avoid this place in future", exact: true })
    .click();
  await expect(
    page.getByText(/Future plans on this device will avoid this place/),
  ).toBeVisible();
  await start(page);
  const next = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/generate") && response.status() === 200,
  );
  await page.getByRole("button", { name: "Make my day", exact: true }).click();
  const changed = await (await next).json();
  expect(changed.request.excludedPlaceIds).toContain(plan.stops[0].placeId);
  expect(
    changed.stops.map((stop: { placeId: string }) => stop.placeId),
  ).not.toContain(plan.stops[0].placeId);
});

test("Local diagnostics report failure codes without private input and can be cleared", async ({
  page,
}) => {
  const privateText =
    "PRIVATE-PROMPT user@example.com near 43.6532,-79.3832 token-secret-example";
  await start(page, privateText);
  await expect(
    page.getByText(/You can still choose your preferences below/),
  ).toBeVisible();
  await page.goto("/profile", { waitUntil: "domcontentloaded" });
  await page
    .getByRole("button", { name: "Open diagnostic report", exact: true })
    .click();
  const report = page.getByRole("dialog", {
    name: "Your diagnostic report",
    exact: true,
  });
  await expect(report).toContainText("Whimway diagnostic report");
  await expect(report).toContainText("HTTP 503");
  const text = await report.innerText();
  for (const value of [
    "PRIVATE-PROMPT",
    "user@example.com",
    "43.6532",
    "token-secret-example",
  ])
    expect(text).not.toContain(value);
  await shot(page, "diagnostics-privacy-390");
  await auditAccessibility(page, "diagnostic report sheet");
  await report.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByRole("button", { name: "Clear local diagnostics", exact: true })
    .click();
  await expect(
    page.getByText("Local diagnostic history cleared.", { exact: true }),
  ).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page
    .getByRole("button", { name: "Open diagnostic report", exact: true })
    .click();
  await expect(report).toContainText("No recent errors recorded.");
});

test("Shared sheet supports drag, keyboard focus and field-specific edit recovery", async ({
  page,
}) => {
  const generation = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/generate") && response.status() === 200,
  );
  await generate(page);
  const original = await (await generation).json();
  const savedBefore = await page.evaluate(() =>
    localStorage.getItem("whimway:native:plans:v1"),
  );
  const edits: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/edit"))
      edits.push(request.postData() ?? "");
  });
  await page.getByRole("button", { name: "Adjust plan", exact: true }).click();
  const sheet = page.getByRole("dialog", {
    name: "Make room for your day",
    exact: true,
  });
  await expect(
    sheet.getByRole("button", { name: "Close", exact: true }),
  ).toBeFocused();
  await auditAccessibility(page, "editing sheet");
  await sheet
    .getByRole("textbox", { name: "Plan budget", exact: true })
    .focus();
  await expect(
    sheet.getByRole("textbox", { name: "Plan budget", exact: true }),
  ).toBeFocused();
  const heading = await sheet
    .getByRole("heading", { name: "Make room for your day", exact: true })
    .boundingBox();
  expect(heading).not.toBeNull();
  const x = heading!.x + heading!.width / 2,
    y = heading!.y + heading!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 190, { steps: 12 });
  await page.mouse.up();
  await expect(sheet).not.toBeVisible();
  await expect(page.getByRole("button", { name: /^Customize / })).toHaveCount(
    4,
  );
  await page.getByRole("button", { name: "Adjust plan", exact: true }).click();
  const duration = sheet.getByRole("textbox", {
    name: "Plan duration",
    exact: true,
  });
  const budget = sheet.getByRole("textbox", {
    name: "Plan budget",
    exact: true,
  });
  await duration.fill("0");
  await sheet
    .getByRole("button", { name: "Update my plan", exact: true })
    .click();
  await expect(
    sheet.getByText("Enter a whole number from 60 to 720 minutes.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(edits).toHaveLength(0);
  await duration.fill(String(original.request.duration));
  await budget.fill("-1");
  await sheet
    .getByRole("button", { name: "Update my plan", exact: true })
    .click();
  await expect(
    sheet.getByText(
      `Enter a budget from 0 to 1,000,000 ${original.cost.currency} per person.`,
      { exact: true },
    ),
  ).toBeVisible();
  expect(edits).toHaveLength(0);
  expect(
    await page.evaluate(() => localStorage.getItem("whimway:native:plans:v1")),
  ).toBe(savedBefore);
  await auditAccessibility(page, "field-specific editing error");
  await shot(page, "editing-field-error-390");
  await budget.fill(String(original.request.budget));
  const retry = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/edit") && response.status() === 200,
  );
  await sheet
    .getByRole("button", { name: "Update my plan", exact: true })
    .click();
  const updated = await (await retry).json();
  expect(updated.revision).toBeGreaterThan(original.revision);
  expect(edits).toHaveLength(1);
  await expect(sheet).not.toBeVisible();
  await page
    .getByRole("button", { name: /^Customize / })
    .first()
    .click();
  const stopSheet = page.getByRole("dialog");
  await stopSheet
    .getByRole("textbox", { name: "Visit duration in minutes", exact: true })
    .fill("0");
  await stopSheet
    .getByRole("button", { name: "Update visit duration", exact: true })
    .click();
  await expect(
    stopSheet.getByText("Enter a whole number from 15 to 240 minutes.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(edits).toHaveLength(1);
});

test("Free planning enforces zero estimated activity cost rather than a soft zero budget", async ({
  page,
}) => {
  await start(page);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  for (let i = 0; i < 3; i++)
    await page
      .getByRole("button", { name: "Skip for now", exact: true })
      .click();
  await expect(
    page.getByText("What’s your budget?", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Free", exact: true }).click();
  const generated = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/generate") && response.status() === 200,
  );
  await page.getByRole("button", { name: "Make my day", exact: true }).click();
  const free = await (await generated).json();
  expect(free.request.budget).toBe(0);
  expect(free.request.hardBudget).toBe(true);
  expect(free.cost.high).toBe(0);
  expect(free.cost.unknown).toBe(0);
  expect(free.stops.length).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: /^Customize / })).toHaveCount(
    free.stops.length,
  );
  await shot(page, "free-plan-390");
});

test("Editing between Free and numeric budgets recomputes the hard-budget policy", async ({
  page,
}) => {
  await generate(page);
  const savedBefore = await page.evaluate(() =>
    localStorage.getItem("whimway:native:plans:v1"),
  );
  await page.getByRole("button", { name: "Adjust plan", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Plan budget", exact: true })
    .fill("0");
  const rejectedResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/edit"),
  );
  await page
    .getByRole("button", { name: "Update my plan", exact: true })
    .click();
  const rejected = await rejectedResponse;
  expect(rejected.status()).toBe(422);
  expect(rejected.request().postDataJSON().request).toMatchObject({
    budget: 0,
    hardBudget: true,
  });
  await expect(
    page
      .getByRole("dialog", { name: "Make room for your day", exact: true })
      .getByText((await rejected.json()).error, { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("whimway:native:plans:v1")),
  ).toBe(savedBefore);
  await page
    .getByRole("dialog", { name: "Make room for your day", exact: true })
    .getByRole("button", { name: "Close", exact: true })
    .click();
  // The editor preserves chosen stops rather than silently discarding a paid
  // venue. Remove it explicitly, then Free can be accepted for the remaining day.
  await page
    .getByRole("button", {
      name: "Customize Art Gallery of Ontario",
      exact: true,
    })
    .click();
  const removedResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/edit"),
  );
  await page.getByRole("button", { name: "Remove stop", exact: true }).click();
  expect((await removedResponse).status()).toBe(200);
  await page.getByRole("button", { name: "Adjust plan", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Plan budget", exact: true })
    .fill("0");
  const freeResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/edit"),
  );
  await page
    .getByRole("button", { name: "Update my plan", exact: true })
    .click();
  const freeResult = await freeResponse;
  expect(freeResult.status()).toBe(200);
  const free = await freeResult.json();
  expect(free.request).toMatchObject({ budget: 0, hardBudget: true });
  expect(free.cost.high).toBe(0);
  expect(free.cost.unknown).toBe(0);
  await page.getByRole("button", { name: "Adjust plan", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Plan budget", exact: true })
    .fill("75");
  const paidResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/edit"),
  );
  await page
    .getByRole("button", { name: "Update my plan", exact: true })
    .click();
  const paidResult = await paidResponse;
  expect(paidResult.status()).toBe(200);
  const paid = await paidResult.json();
  expect(paid.request).toMatchObject({ budget: 75, hardBudget: false });
  expect(paid.revision).toBeGreaterThan(free.revision);
});

test("Saved lock conflict requires explicit unlock and preserves the original on cancelled or failed recovery", async ({
  page,
}) => {
  await generate(page);
  await page
    .getByRole("button", { name: /^Customize / })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Lock this stop", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Lock this stop", exact: true }),
  ).not.toBeVisible();
  const readSaved = () =>
    page.evaluate(() =>
      JSON.parse(localStorage.getItem("whimway:native:plans:v1") ?? "[]"),
    );
  const original = await readSaved();
  expect(
    original[0].stops.some((stop: { locked: boolean }) => stop.locked),
  ).toBe(true);
  let recovery: "hold" | "fail" | "success" = "hold";
  let release: (route: Route) => void = () => {};
  const held = new Promise<Route>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/hydrate", async (route) => {
    const request = route.request().postDataJSON();
    if (request.stops.some((stop: { locked: boolean }) => stop.locked)) {
      await route.fulfill({
        status: 422,
        json: {
          error:
            "A saved locked venue is unavailable. Unlock its stop only if you want to retry.",
          code: "LOCK_CONFLICT",
        },
      });
    } else if (recovery === "hold") release(route);
    else if (recovery === "fail")
      await route.fulfill({
        status: 503,
        json: {
          error:
            "Recovery is temporarily unavailable. Your original saved outing remains intact.",
          code: "PROVIDER_TIMEOUT",
        },
      });
    else await route.continue();
  });
  async function openSaved() {
    await page.goto("/saved", { waitUntil: "domcontentloaded" });
    await page
      .getByRole("button", { name: /^A day with a little more whim/ })
      .click();
    await expect(
      page.getByText(/A saved locked venue is unavailable/),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Unlock saved stops and retry",
        exact: true,
      }),
    ).toBeVisible();
  }
  await openSaved();
  await shot(page, "saved-lock-conflict-390");
  await auditAccessibility(page, "saved locked-stop recovery");
  await page
    .getByRole("button", { name: "Unlock saved stops and retry", exact: true })
    .click();
  const pending = await held;
  expect(
    pending
      .request()
      .postDataJSON()
      .stops.every((stop: { locked: boolean }) => !stop.locked),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Cancel opening", exact: true })
    .click();
  await pending.abort("aborted").catch(() => {});
  await expect(
    page.getByRole("button", { name: "Cancel opening", exact: true }),
  ).not.toBeVisible();
  expect(await readSaved()).toEqual(original);
  recovery = "fail";
  await openSaved();
  await page
    .getByRole("button", { name: "Unlock saved stops and retry", exact: true })
    .click();
  await expect(
    page.getByText(/Recovery is temporarily unavailable/),
  ).toBeVisible();
  expect(await readSaved()).toEqual(original);
  recovery = "success";
  const successful = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/hydrate") && response.status() === 200,
  );
  await page
    .getByRole("button", { name: "Unlock saved stops and retry", exact: true })
    .click();
  const repaired = await (await successful).json();
  expect(
    repaired.stops.every((stop: { locked: boolean }) => !stop.locked),
  ).toBe(true);
  await expect(page).toHaveURL(/\/plan\/[a-f\d-]+/);
  await expect
    .poll(async () =>
      (await readSaved())[0].stops.every(
        (stop: { locked: boolean }) => !stop.locked,
      ),
    )
    .toBe(true);
});
