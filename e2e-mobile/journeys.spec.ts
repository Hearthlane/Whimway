import { test, expect, type Page } from "@playwright/test";
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
async function start(page: Page, prompt = "") {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByText("Where are we heading?", { exact: true }),
  ).toBeVisible();
  await page.getByRole("switch").first().check();
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
  if (prompt)
    await page
      .getByRole("textbox", { name: "Describe your ideal outing" })
      .fill(prompt);
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

test("Guided planning skips, preserves Back state, generates early and reopens from Saved", async ({
  page,
}) => {
  await start(page);
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
  await shot(page, "planner-energy-390");
  const submitted = page.waitForRequest((request) =>
    request.url().endsWith("/api/generate"),
  );
  await page.getByRole("button", { name: "Make my day", exact: true }).click();
  expect((await submitted).postDataJSON().request.interests).toContain(
    "Food & drinks",
  );
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
    const text = [
      ...document.querySelectorAll<HTMLElement>(
        "div,span,input,textarea,button",
      ),
    ].filter(
      (element) =>
        element.matches("input,textarea") ||
        [...element.childNodes].some(
          (node) =>
            node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
        ),
    );
    const values = text.map((element) => ({
      element,
      font: getComputedStyle(element).fontSize,
      line: getComputedStyle(element).lineHeight,
    }));
    for (const { element, font, line } of values) {
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
        vibes: ["exciting"],
        interests: ["Food & drinks", "Shopping", "Interactive fun"],
        warnings: [],
      },
    }),
  );
  await start(
    page,
    "Plan a fun date around Toronto tomorrow. We have $70 each, four hours and want food, shopping and something exciting.",
  );
  await expect(
    page.getByText("CAD 70 / person · Walking", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("What’s your budget?", { exact: true }),
  ).not.toBeVisible();
  await shot(page, "planner-prompt-prefill-390");
  const request = page.waitForRequest((request) =>
    request.url().endsWith("/api/generate"),
  );
  await page.getByRole("button", { name: "Make my day", exact: true }).click();
  const body = (await request).postDataJSON();
  expect(body.request.budget).toBe(70);
  expect(body.request.participants).toBe(2);
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
  const transport = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/edit") && response.status() === 200,
  );
  await page.getByRole("button", { name: "Driving", exact: true }).click();
  expect((await (await transport).json()).request.mode).toBe("DRIVE");
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
