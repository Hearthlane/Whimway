import {
  test,
  expect,
  type Page,
  type Route,
  type TestInfo,
} from "@playwright/test";
import type { Itinerary } from "../lib/schema";

// Real RN Web Saved screens and device storage with only the cloud status
// response held. This models stalled connectivity; it is not an iOS replay.
const unavailable =
  "Cloud refresh is unavailable. Your device collection is still available.";
const plansKey = "whimway:native:plans:v1";
const favoritesKey = "whimway:native:favorite-places:v1";

async function holdStatus(page: Page) {
  const pending: Route[] = [];
  await page.route("**/api/status", (route) => {
    pending.push(route);
  });
  return {
    pending,
    async fail(index = 0) {
      await pending[index].fulfill({
        status: 503,
        json: { error: unavailable, code: "CLOUD_UNAVAILABLE" },
      });
    },
    async succeed(index: number) {
      await pending[index].fulfill({
        status: 200,
        json: {
          places: false,
          maps: false,
          ai: false,
          cloud: false,
          demo: true,
          user: null,
        },
      });
    },
  };
}

async function shot(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: false });
  await info.attach(name, { path, contentType: "image/png" });
}

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

test("An empty device collection is ready while cloud status stalls, then reports failure and recovers on refocus", async ({
  page,
}, info) => {
  const status = await holdStatus(page);
  await page.goto("/saved", { waitUntil: "domcontentloaded" });
  await expect.poll(() => status.pending.length).toBe(1);
  const opening = page.getByText("Opening your collection…", { exact: true });
  await expect(
    page.getByText("Your next good day lives here.", { exact: true }),
  ).toBeVisible({ timeout: 3000 });
  await expect(opening).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Find my kind of day", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Favorite places · 0", exact: true })
    .click();
  await expect(
    page.getByText("Keep the places that click.", { exact: true }),
  ).toBeVisible();
  await shot(page, info, "rn-web-saved-empty-local-ready-status-held");

  await status.fail();
  await expect(page.getByRole("alert")).toContainText(unavailable);
  await expect(opening).not.toBeVisible();
  await expect(
    page.getByText("Keep the places that click.", { exact: true }),
  ).toBeVisible();
  await shot(page, info, "rn-web-saved-empty-cloud-failure-local-available");
  await page.getByRole("tab", { name: "Explore", exact: true }).click();
  await page.getByRole("tab", { name: "Saved", exact: true }).click();
  await expect.poll(() => status.pending.length).toBe(2);
  await expect(opening).not.toBeVisible({ timeout: 3000 });
  await status.succeed(1);
  await expect(page.getByRole("alert")).not.toBeVisible();
  await expect(
    page.getByText("Keep the places that click.", { exact: true }),
  ).toBeVisible();
});

test("A real saved plan and favorite stay usable during stalled or failed cloud status", async ({
  page,
}, info) => {
  const plan = await generateFixture(page);
  await page
    .getByRole("button", { name: /^Customize / })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Save to favourite places", exact: true })
    .click();
  await expect(
    page.getByText("Added to your favourite places.", { exact: true }),
  ).toBeVisible();
  const saved = await page.evaluate(
    ([plans, favorites]) => ({
      plans: localStorage.getItem(plans),
      favorites: localStorage.getItem(favorites),
    }),
    [plansKey, favoritesKey],
  );
  expect(JSON.parse(saved.plans!)[0].id).toBe(plan.id);
  expect(JSON.parse(saved.favorites!)[0].placeId).toBe(plan.stops[0].placeId);
  const status = await holdStatus(page);
  await page.goto("/saved", { waitUntil: "domcontentloaded" });
  await expect.poll(() => status.pending.length).toBe(1);
  const planButton = page.getByRole("button", {
    name: new RegExp(`^${plan.title}`),
  });
  await expect(planButton).toBeEnabled();
  await expect(
    page.getByText("Opening your collection…", { exact: true }),
  ).not.toBeVisible({ timeout: 3000 });
  await expect(
    page.getByRole("button", { name: "Plans · 1", exact: true }),
  ).toBeVisible();
  await shot(page, info, "rn-web-saved-plan-local-ready-status-held");
  await page
    .getByRole("button", { name: "Favorite places · 1", exact: true })
    .click();
  const favorite = page.getByRole("button", {
    name: `Remove favorite ${plan.stops[0].place.name}`,
    exact: true,
  });
  await expect(favorite).toBeVisible();
  await expect(
    page.getByRole("button", { name: "View place", exact: true }),
  ).toBeEnabled();
  await status.fail();
  await expect(page.getByRole("alert")).toContainText(unavailable);
  await expect(favorite).toBeVisible();
  await shot(page, info, "rn-web-saved-favorite-cloud-failure-local-available");
  await page.getByRole("button", { name: "Plans · 1", exact: true }).click();
  await planButton.click();
  await expect(page).toHaveURL(new RegExp(`/plan/${plan.id}$`));
  await expect(page.getByRole("button", { name: /^Customize / })).toHaveCount(
    plan.stops.length,
  );
  expect(
    await page.evaluate(
      ([plans, favorites]) => ({
        plans: localStorage.getItem(plans),
        favorites: localStorage.getItem(favorites),
      }),
      [plansKey, favoritesKey],
    ),
  ).toEqual(saved);
});
