import { test, expect, type Page, type Route } from "@playwright/test";
import { spec } from "../tests/helpers";
import { fixtureLocations, fixturePlaces } from "../lib/providers/fixtures";
import { referenceOnlyPlan } from "../apps/mobile/src/services/storage-core";

// All account and venue responses here are isolated fixtures. These tests never
// sign in or send a deletion to a real account.
const plansKey = "whimway:native:plans:v1";
const favoritesKey = "whimway:native:favorite-places:v1";
const plan = referenceOnlyPlan({
  ...spec(),
  demo: false,
  title: "Cloud deletion fixture",
});
const status = (accountId: string | null) => ({
  places: true,
  maps: true,
  ai: false,
  cloud: !!accountId,
  demo: false,
  user: accountId ? { id: accountId } : null,
});
async function json(route: Route, body: unknown, statusCode = 200) {
  await route.fulfill({ status: statusCode, json: body });
}
async function seed(page: Page, values: Record<string, unknown>) {
  await page.addInitScript((entries) => {
    for (const [key, value] of Object.entries(entries))
      localStorage.setItem(key, JSON.stringify(value));
  }, values);
}
async function devicePlans(page: Page) {
  return page.evaluate((key) => localStorage.getItem(key), plansKey);
}

test("a failed refresh retains synced deletion provenance and a failed DELETE keeps the device copy", async ({
  page,
}) => {
  let failRefresh = false,
    failDelete = true,
    deletes = 0;
  const unexpected: string[] = [];
  await seed(page, { [plansKey]: [plan] });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/status") return json(route, status("account-a"));
    if (url.pathname === "/api/plans" && route.request().method() === "GET")
      return failRefresh
        ? json(
            route,
            {
              error: "Fixture cloud refresh unavailable.",
              code: "CLOUD_UNAVAILABLE",
            },
            503,
          )
        : json(route, [
            { id: plan.id, spec: plan, updated_at: new Date().toISOString() },
          ]);
    if (
      url.pathname === `/api/plans/${plan.id}` &&
      route.request().method() === "DELETE"
    ) {
      deletes++;
      return failDelete
        ? json(
            route,
            {
              error: "Fixture cloud deletion unavailable.",
              code: "CLOUD_UNAVAILABLE",
            },
            503,
          )
        : json(route, { deleted: true });
    }
    unexpected.push(`${route.request().method()} ${url.pathname}`);
    await route.abort();
  });
  await page.goto("/saved", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByText("ACCOUNT + DEVICE", { exact: true }),
  ).toBeVisible();
  const original = await devicePlans(page);
  failRefresh = true;
  await page.getByRole("tab", { name: "Explore", exact: true }).click();
  await page.getByRole("tab", { name: "Saved", exact: true }).click();
  await expect(
    page.getByText("Fixture cloud refresh unavailable.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("ACCOUNT + DEVICE", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: `Delete ${plan.title}`, exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Let this plan go?",
    exact: true,
  });
  await expect(
    dialog.getByText(/A failed cloud deletion keeps this device copy/),
  ).toBeVisible();
  await dialog
    .getByRole("button", {
      name: "Delete account and device copies",
      exact: true,
    })
    .click();
  await expect(
    dialog.getByText("Fixture cloud deletion unavailable.", { exact: true }),
  ).toBeVisible();
  expect(deletes).toBe(1);
  expect(await devicePlans(page)).toBe(original);
  await expect(
    dialog.getByRole("button", {
      name: "Delete account and device copies",
      exact: true,
    }),
  ).toBeEnabled();
  failDelete = false;
  await dialog
    .getByRole("button", {
      name: "Delete account and device copies",
      exact: true,
    })
    .click();
  await expect(dialog).not.toBeVisible();
  expect(deletes).toBe(2);
  expect(JSON.parse((await devicePlans(page)) ?? "[]")).toEqual([]);
  await expect(
    page.getByText(
      "Device and account copies deleted, including that account’s share links.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(unexpected).toEqual([]);
});

test("guest device removal makes no cloud request and discloses that cloud copies and shares remain", async ({
  page,
}) => {
  const unexpected: string[] = [];
  await seed(page, { [plansKey]: [plan] });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/status") return json(route, status(null));
    unexpected.push(`${route.request().method()} ${url.pathname}`);
    await route.abort();
  });
  await page.goto("/saved", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(plan.title, { exact: true })).toBeVisible();
  await expect(
    page.getByText("Opening your collection…", { exact: true }),
  ).not.toBeVisible();
  await page
    .getByRole("button", { name: `Delete ${plan.title}`, exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Let this plan go?",
    exact: true,
  });
  await expect(
    dialog.getByText(/Cloud copies and share links stay unchanged/),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", {
      name: "Delete account and device copies",
      exact: true,
    }),
  ).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Remove device copy", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  expect(JSON.parse((await devicePlans(page)) ?? "[]")).toEqual([]);
  await expect(
    page.getByText(
      "Device copy removed. Cloud copies and share links are unchanged.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(unexpected).toEqual([]);
});

test("an account change during deletion verification cannot delete either account or the device copy", async ({
  page,
}) => {
  let accountId = "account-a";
  const unexpected: string[] = [];
  await seed(page, { [plansKey]: [plan] });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/status") return json(route, status(accountId));
    if (url.pathname === "/api/plans" && route.request().method() === "GET")
      return json(route, [
        { id: plan.id, spec: plan, updated_at: new Date().toISOString() },
      ]);
    unexpected.push(`${route.request().method()} ${url.pathname}`);
    await route.abort();
  });
  await page.goto("/saved", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByText("ACCOUNT + DEVICE", { exact: true }),
  ).toBeVisible();
  const original = await devicePlans(page);
  await page
    .getByRole("button", { name: `Delete ${plan.title}`, exact: true })
    .click();
  accountId = "account-b";
  await page
    .getByRole("dialog", { name: "Let this plan go?", exact: true })
    .getByRole("button", {
      name: "Delete account and device copies",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Let this plan go?", exact: true }),
  ).not.toBeVisible();
  expect(await devicePlans(page)).toBe(original);
  await page
    .getByRole("button", { name: `Delete ${plan.title}`, exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog", { name: "Let this plan go?", exact: true })
      .getByRole("button", { name: "Remove device copy", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("dialog", { name: "Let this plan go?", exact: true })
      .getByText(/Cloud copies and share links stay unchanged/),
  ).toBeVisible();
  expect(unexpected).toEqual([]);
});

test("leaving Saved cancels planning around a favorite without replacing the draft or navigating later", async ({
  page,
}) => {
  const location = fixtureLocations[0],
    place = fixturePlaces(spec().request)[0];
  let releaseLocation!: () => void,
    locationRequested = false,
    locationAborted = false;
  const locationGate = new Promise<void>((resolve) => {
    releaseLocation = resolve;
  });
  const unexpected: string[] = [];
  await seed(page, {
    [favoritesKey]: [
      {
        placeId: place.id,
        currency: location.currency,
        timezone: location.timezone,
        demo: true,
        sourceLocationId: location.placeId,
      },
    ],
  });
  page.on("requestfailed", (request) => {
    if (new URL(request.url()).pathname === "/api/location")
      locationAborted = true;
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/status") return json(route, status(null));
    if (url.pathname === "/api/place") return json(route, place);
    if (url.pathname === "/api/location") {
      locationRequested = true;
      await locationGate;
      // Aborting the app request may already have closed this intercepted route.
      await json(route, location).catch(() => {});
      return;
    }
    unexpected.push(`${route.request().method()} ${url.pathname}`);
    await route.abort();
  });
  try {
    await page.goto("/saved", { waitUntil: "domcontentloaded" });
    await page
      .getByRole("button", { name: "Favorite places · 1", exact: true })
      .click();
    await page.getByRole("button", { name: "View place", exact: true }).click();
    await page
      .getByRole("dialog", { name: place.name, exact: true })
      .getByRole("button", { name: "Plan around this place", exact: true })
      .click();
    await expect.poll(() => locationRequested).toBe(true);
    await page.getByRole("tab", { name: "Explore", exact: true }).click();
    await expect(
      page.getByText("Where are we heading?", { exact: true }),
    ).toBeVisible();
    releaseLocation();
    await expect.poll(() => locationAborted).toBe(true);
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByText(
        "Your previous answers stay in the planner until you start a new outing.",
        { exact: true },
      ),
    ).toHaveCount(0);
    expect(unexpected).toEqual([]);
  } finally {
    releaseLocation();
  }
});
