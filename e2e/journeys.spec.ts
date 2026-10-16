import { test, expect, type Page } from "@playwright/test";
import { publicSpec } from "../lib/storage";
import { PlanSpec } from "../lib/schema";
const browserErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
});
test.afterEach(async ({ page }) => {
  expect(
    browserErrors.get(page) ?? [],
    "Unexpected browser exceptions",
  ).toEqual([]);
  browserErrors.delete(page);
});
async function generate(page: Page, city = "Toronto") {
  await page.goto("/create");
  await page
    .getByLabel("Development preview: synthetic places, prices, hours and map")
    .check();
  await page
    .getByRole("combobox", { name: "Search for an area", exact: true })
    .first()
    .fill(city);
  await page.getByRole("option").first().getByRole("button").click();
  await page.getByLabel("People", { exact: true }).fill("3");
  if (city === "Shibuya")
    await page.getByLabel("Budget / person (JPY)").fill("12000");
  await page.getByRole("button", { name: "Make my day", exact: true }).click();
  await expect(page).toHaveURL(/\/plan\//);
  await expect(page.locator(".stop-card")).toHaveCount(4);
  await expect(page.locator(".notice.error")).toHaveCount(0);
}
test("A fast create click waits for the selected place and its destination date", async ({
  page,
}) => {
  await page.goto("/create");
  await page
    .getByLabel("Development preview: synthetic places, prices, hours and map")
    .check();
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/api\/location\?/, async (route) => {
    await gate;
    await route.continue();
  });
  let generated = false;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/generate")) generated = true;
  });
  await page
    .getByRole("combobox", { name: "Search for an area", exact: true })
    .first()
    .fill("Remote");
  await page.getByRole("option").first().getByRole("button").click();
  const make = page.getByRole("button", { name: "Make my day", exact: true });
  await expect(make).toBeDisabled();
  // A real rapid click is queued while lookup remains unresolved; the control
  // must become usable only after onChange has initialized the destination date.
  const click = make.click();
  expect(generated).toBe(false);
  release();
  await click;
  await expect(page.getByLabel("Outing date")).not.toHaveValue("");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "No suitable destinations",
  );
  expect(generated).toBe(true);
  await expect(page).toHaveURL(/\/create/);
});

test("Home keeps a fast start and Enter from dropping an unresolved selected location", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Development preview · synthetic test data").check();
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/api\/location\?/, async (route) => {
    await gate;
    await route.continue();
  });
  await page
    .getByRole("combobox", { name: "Search for an area", exact: true })
    .fill("Toronto");
  await page.getByRole("option").first().getByRole("button").click();
  const start = page.getByRole("button", { name: "Find my kind of day" });
  await expect(start).toBeDisabled();
  await page.getByLabel("Describe your outing").fill("An art afternoon");
  await page.getByLabel("Describe your outing").press("Enter");
  await expect(page).toHaveURL(/\/$/);
  expect(
    await page.evaluate(() => sessionStorage.getItem("whimway:entry")),
  ).toBeNull();
  const click = start.click();
  release();
  await click;
  await expect(page).toHaveURL(/\/create/);
  await expect(
    page
      .getByRole("combobox", { name: "Search for an area", exact: true })
      .first(),
  ).toHaveValue("CF Toronto Eaton Centre");
  await expect(page.getByLabel("Outing date")).not.toHaveValue("");
  await expect(page.getByLabel("Describe your plan")).toHaveValue(
    "An art afternoon",
  );
});
test("Toronto: boundary, diverse fixture IDs, timing, budget, map sync and reload", async ({
  page,
}) => {
  await generate(page);
  await expect(page.locator(".plan-summary")).toContainText("3 people");
  await expect(page.locator(".map-footer")).toContainText(
    "Area Lock on · 2 km",
  );
  const cards = page.locator(".stop-card");
  expect(await cards.locator(".stop-category").allTextContents()).toHaveLength(
    4,
  );
  await page.getByRole("button", { name: /Map stop 2/ }).click();
  await expect(cards.nth(1)).toHaveClass(/selected/);
  await page.reload();
  await expect(page.locator(".stop-card")).toHaveCount(4);
  const persisted = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("whimway:plans")!),
  );
  const plan = Object.values(persisted)[0] as {
    stops: { placeId: string; place?: unknown }[];
  };
  expect(
    plan.stops.every((s) => s.placeId.startsWith("fixture-") && !s.place),
  ).toBe(true);
});
test("Shibuya: local timezone, currency and radius", async ({ page }) => {
  await generate(page, "Shibuya");
  await expect(page.locator(".plan-summary")).toContainText("¥");
  await expect(page.locator(".stop-time").first()).toContainText("12:00");
  await expect(page.locator(".map-footer")).toContainText("2 km");
  const data = (await page.evaluate(
    () => Object.values(JSON.parse(localStorage.getItem("whimway:plans")!))[0],
  )) as { request: { location: { timezone: string; currency: string } } };
  expect(data.request.location.timezone).toBe("Asia/Tokyo");
  expect(data.request.location.currency).toBe("JPY");
});
test("Sparse area returns a recovery message and never invents stops", async ({
  page,
}) => {
  await page.goto("/create");
  await page
    .getByLabel("Development preview: synthetic places, prices, hours and map")
    .check();
  await page
    .getByRole("combobox", { name: "Search for an area", exact: true })
    .first()
    .fill("Remote");
  await page.getByRole("option").first().getByRole("button").click();
  await page.getByRole("button", { name: "Make my day", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "No suitable destinations",
  );
  await expect(page).toHaveURL(/\/create/);
});
test("Editing: lock, replace, remove, remix, undo and constraint recomputation", async ({
  page,
}) => {
  await generate(page);
  const firstName = await page.locator(".stop-heading h3").first().innerText();
  await page
    .getByRole("button", { name: `Lock ${firstName}`, exact: true })
    .click();
  const secondName = await page.locator(".stop-heading h3").nth(1).innerText();
  await page
    .getByRole("button", { name: `Replace ${secondName}`, exact: true })
    .click();
  await page
    .getByRole("button", { name: "Replace", exact: true })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const thirdName = await page.locator(".stop-heading h3").nth(2).innerText();
  await page
    .getByRole("button", { name: `Remove ${thirdName}`, exact: true })
    .click();
  await expect(page.locator(".stop-card")).toHaveCount(3);
  await page
    .getByRole("button", { name: "More relaxing", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: `Unlock ${firstName}`, exact: true }),
  ).toBeVisible();
  await expect(page.locator(".editing-progress")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo last change" }).click();
  await expect(page.locator(".stop-card")).toHaveCount(3);
  await page.getByRole("button", { name: "Adjust plan constraints" }).click();
  await page
    .getByRole("combobox", { name: "Transport", exact: true })
    .selectOption("DRIVE");
  await page.getByRole("button", { name: "Update my day" }).click();
  await expect(page.locator(".plan-summary")).toContainText("driving");
});
test("Shared plan: guest read-only viewing and duplication using mocked persistence", async ({
  page,
  context,
}) => {
  await generate(page);
  const spec = (await page.evaluate(
    () => Object.values(JSON.parse(localStorage.getItem("whimway:plans")!))[0],
  )) as {
    request: {
      prompt: string;
      dietary: string;
      accessibility: string;
      start?: unknown;
      end?: unknown;
    };
  };
  spec.request.prompt = "";
  spec.request.dietary = "";
  spec.request.accessibility = "";
  delete spec.request.start;
  delete spec.request.end;
  await context.clearCookies();
  await page.evaluate(() => localStorage.clear());
  const publicCopy = publicSpec(PlanSpec.parse(spec));
  const shareId = "fb0483c1-8075-438b-8a8c-d15a290b7e9f";
  await page.route(`**/api/shared/${shareId}`, (route) =>
    route.fulfill({ json: publicCopy }),
  );
  await page.goto(`/s/${shareId}`);
  await expect(page.locator(".stop-card")).toHaveCount(4);
  await expect(page.getByRole("button", { name: /Replace / })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Share", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Make it yours" }).click();
  await expect(page).toHaveURL(/\/plan\//);
  await expect(page.locator(".stop-card")).toHaveCount(4);
  await expect(
    page.getByRole("button", { name: /Lock / }).first(),
  ).toBeVisible();
});
test("Mobile and tablet: navigation, forms, bottom sheet and no overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await expect(page.locator("h1")).toContainText("favourite day");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/home-mobile.png",
    fullPage: true,
    caret: "initial",
  });
  await generate(page);
  await page.getByRole("button", { name: "Map", exact: true }).click();
  await expect(
    page.getByRole("slider", { name: "Itinerary sheet height" }),
  ).toBeVisible();
  await page
    .getByRole("slider", { name: "Itinerary sheet height" })
    .press("ArrowUp");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/plan-mobile.png",
    fullPage: true,
    caret: "initial",
  });
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/profile");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/profile-tablet.png",
    fullPage: true,
    caret: "initial",
  });
});
test("Missing services are explicit, optional accounts do not block navigation", async ({
  page,
}) => {
  await page.goto("/");
  await page.screenshot({
    path: "test-results/home-desktop.png",
    fullPage: true,
    caret: "initial",
  });
  await page.goto("/create");
  await expect(page.getByRole("status")).toContainText("Live planning needs");
  await page.goto("/profile");
  await expect(
    page.getByRole("button", { name: "Email me a sign-in link" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Save my preferences" }).click();
  await expect(page.getByRole("status")).toContainText("saved on this device");
  await page.goto("/saved");
  await expect(
    page.getByRole("heading", { name: "Your good days will live here." }),
  ).toBeVisible();
});

test("Changing a form while generating cancels the stale request without saving a plan", async ({
  page,
}) => {
  await page.goto("/create");
  await page
    .getByLabel("Development preview: synthetic places, prices, hours and map")
    .check();
  await page
    .getByRole("combobox", { name: "Search for an area", exact: true })
    .first()
    .fill("Toronto");
  await page.getByRole("option").first().getByRole("button").click();
  let submitted = false;
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/generate", async (route) => {
    submitted = true;
    await gate;
    await route
      .fulfill({ status: 500, json: { error: "Stale response" } })
      .catch(() => {});
  });
  await page.getByRole("button", { name: "Make my day", exact: true }).click();
  await expect.poll(() => submitted).toBe(true);
  await page.getByLabel("Budget / person (CAD)").fill("20");
  await expect(page.locator(".notice.error")).toContainText(
    "Your choices changed",
  );
  release();
  await expect(page).toHaveURL(/\/create/);
  expect(
    await page.evaluate(() => localStorage.getItem("whimway:plans")),
  ).toBeNull();
});

test("Accessibility: discovery, forms, collection, profile and itinerary at phone and desktop widths", async ({
  page,
}) => {
  const { default: AxeBuilder } = await import("@axe-core/playwright");
  for (const path of [
    "/",
    "/create",
    "/saved",
    "/profile",
    "/privacy",
    "/terms",
  ]) {
    await page.goto(path);
    await page.locator("h1").waitFor();
    if (path === "/" || path === "/create")
      await page.locator(".demo-toggle").waitFor();
    await page.evaluate(() => document.fonts.ready);
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      result.violations.map((v) => ({
        id: v.id,
        help: v.help,
        nodes: v.nodes.map((n) => ({
          target: n.target,
          summary: n.failureSummary,
        })),
      })),
      path,
    ).toEqual([]);
  }
  await generate(page);
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 900 });
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      result.violations.map((v) => ({
        id: v.id,
        help: v.help,
        nodes: v.nodes.map((n) => ({
          target: n.target,
          summary: n.failureSummary,
        })),
      })),
      `itinerary ${width}`,
    ).toEqual([]);
  }
});

test("Manual Explore: category filtering, candidate map focus, details and adding a candidate-ID fixture", async ({
  page,
}) => {
  await generate(page);
  await page.getByRole("button", { name: "Adjust plan constraints" }).click();
  await page.getByLabel("Duration (minutes)").fill("480");
  await page.getByRole("button", { name: "Update my day" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Add a little something" }).click();
  const picker = page.getByRole("dialog");
  await expect(picker.locator(".alternative-card")).toHaveCount(2);
  await picker.getByRole("button", { name: "park", exact: true }).click();
  await expect(picker.locator(".alternative-card")).toHaveCount(1);
  await expect(picker.locator(".alternative-card")).toContainText(
    "Trinity Square",
  );
  await picker.getByRole("button", { name: /Map stop 1/ }).click();
  await expect(picker.locator(".alternative-card")).toHaveClass(/selected/);
  await picker
    .getByRole("button", { name: "Trinity Square", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Published hours");
  await page.getByRole("button", { name: "Add to my outing" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".stop-card")).toHaveCount(5);
  await expect(page.locator(".notice.error")).toHaveCount(0);
});

test("Explore entry: carry the selected area and prompt through planning and reopen from Saved", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Development preview · synthetic test data").check();
  await page
    .getByRole("combobox", { name: "Search for an area", exact: true })
    .fill("Toronto");
  await page.getByRole("option").first().getByRole("button").click();
  await page
    .getByLabel("Describe your outing")
    .fill("A relaxed coffee and art afternoon");
  await page.getByRole("button", { name: "Find my kind of day" }).click();
  await expect(page).toHaveURL(/\/create/);
  await expect(
    page
      .getByRole("combobox", { name: "Search for an area", exact: true })
      .first(),
  ).toHaveValue(/Toronto/);
  await expect(page.getByLabel("Describe your plan")).toHaveValue(
    "A relaxed coffee and art afternoon",
  );
  await page.getByRole("button", { name: "Make my day", exact: true }).click();
  await expect(page).toHaveURL(/\/plan\//);
  await expect(page.locator(".stop-card")).toHaveCount(4);
  await page.getByRole("link", { name: "Your outings", exact: true }).click();
  await expect(page).toHaveURL(/\/saved/);
  await page.locator(".saved-card").first().getByRole("link").first().click();
  await expect(page.locator(".stop-card")).toHaveCount(4);
});

test("Failed alternative edits report their error inside the visible picker", async ({
  page,
}) => {
  await generate(page);
  await page.route("**/api/edit", (route) =>
    route.fulfill({
      status: 422,
      json: { error: "This stop does not fit your time window." },
    }),
  );
  await page.getByRole("button", { name: "Add a little something" }).click();
  const picker = page.getByRole("dialog");
  await picker
    .getByRole("button", { name: "Add", exact: true })
    .first()
    .click();
  await expect(picker.getByRole("alert")).toContainText(
    "does not fit your time window",
  );
  await expect(page.locator(".stop-card")).toHaveCount(4);
});

test("Impossible constraint changes are visible in the dialog and do not overwrite the saved plan", async ({
  page,
}) => {
  await generate(page);
  await page.getByRole("button", { name: "Adjust plan constraints" }).click();
  await page.getByLabel("Duration (minutes)").fill("60");
  await page.getByRole("button", { name: "Update my day" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "time window",
  );
  const stored = (await page.evaluate(
    () => Object.values(JSON.parse(localStorage.getItem("whimway:plans")!))[0],
  )) as { request: { duration: number } };
  expect(stored.request.duration).toBe(240);
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(page.locator(".stop-card")).toHaveCount(4);
});

test("Profile sync preserves unsynced skipped places and existing account preferences", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem(
      "whimway:preferences",
      JSON.stringify({ enabled: true, disliked: ["device-place"] }),
    );
    localStorage.setItem("whimway:preferences:dirty", "skips");
  });
  await page.route("**/api/status", (route) =>
    route.fulfill({
      json: {
        places: false,
        maps: false,
        ai: false,
        cloud: true,
        demo: true,
        user: { id: "fixture-owner", email: "fixture@example.com" },
      },
    }),
  );
  let uploaded: { disliked: string[]; budget: number } | undefined;
  await page.route("**/api/profile", (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({
        json: {
          enabled: true,
          interests: ["Outdoors"],
          dietary: "vegetarian",
          accessibility: "",
          mode: "DRIVE",
          budget: 100,
          cuisines: "",
          atmosphere: "",
          disliked: ["cloud-place"],
        },
      });
    uploaded = route.request().postDataJSON();
    return route.fulfill({ json: { saved: true } });
  });
  await page.goto("/profile");
  await expect(page.getByLabel("Usual budget / person")).toHaveValue("100");
  await expect(page.getByLabel("Dietary needs")).toHaveValue("vegetarian");
  await expect(page.locator(".preference-panel")).toContainText(
    "2 deliberately skipped places remembered",
  );
  await page.getByRole("button", { name: "Save my preferences" }).click();
  await expect(page.getByRole("status")).toContainText("account and device");
  expect(uploaded?.disliked).toEqual(["cloud-place", "device-place"]);
  expect(uploaded?.budget).toBe(100);
  expect(
    await page.evaluate(() =>
      localStorage.getItem("whimway:preferences:dirty"),
    ),
  ).toBeNull();
});
