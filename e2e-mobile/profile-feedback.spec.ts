import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";

const preferenceKey = "whimway:native:preferences:v1";
const budgetProblem = "Enter a usual budget from 0 to 1,000,000 per person.";
const currencyProblem =
  "Use a three-letter budget currency, such as CAD, USD or JPY.";

async function openGuestProfile(page: Page) {
  const unexpected: string[] = [];
  await page.route("**/api/**", async (route) => {
    if (new URL(route.request().url()).pathname === "/api/status") {
      await route.fulfill({
        json: {
          places: false,
          maps: false,
          ai: false,
          cloud: false,
          demo: true,
          user: null,
        },
      });
    } else {
      unexpected.push(
        `${route.request().method()} ${new URL(route.request().url()).pathname}`,
      );
      await route.abort();
    }
  });
  await page.goto("/profile", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByText("Guest, with all the good stuff.", { exact: true }),
  ).toBeVisible();
  return unexpected;
}

for (const { width, height } of [
  { width: 375, height: 667 },
  { width: 430, height: 932 },
]) {
  test(`Profile preference validation and save feedback stay beside the action at ${width}x${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    const unexpected = await openGuestProfile(page);
    const budget = page.getByRole("textbox", {
      name: "Usual budget",
      exact: true,
    });
    const currency = page.getByRole("textbox", {
      name: "Budget currency code",
      exact: true,
    });
    const feedback = page.getByTestId("preference-save-feedback");
    const save = feedback.getByRole("button", {
      name: "Save my preferences",
      exact: true,
    });
    const original = await page.evaluate(
      (key) => localStorage.getItem(key),
      preferenceKey,
    );

    await budget.fill("");
    await currency.fill("12");
    await save.scrollIntoViewIfNeeded();
    await save.click();
    const alert = feedback.getByRole("alert");
    await expect(alert).toHaveText(budgetProblem);
    await expect(page.getByRole("alert")).toHaveCount(1);
    await expect(alert).toBeInViewport({ ratio: 1 });
    await expect(save).toBeInViewport({ ratio: 1 });
    await expect(budget).toHaveAttribute("aria-invalid", "true");
    await expect(budget).toHaveAttribute(
      "aria-describedby",
      "profile-budget-error",
    );
    await expect(page.locator("#profile-budget-error")).toHaveText(
      budgetProblem,
    );
    await expect(currency).toHaveAttribute("aria-invalid", "true");
    await expect(currency).toHaveAttribute(
      "aria-describedby",
      "profile-currency-error",
    );
    await expect(page.locator("#profile-currency-error")).toHaveText(
      currencyProblem,
    );
    expect(
      await page.evaluate((key) => localStorage.getItem(key), preferenceKey),
    ).toBe(original);
    const accessibility = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(accessibility.violations).toEqual([]);
    await mkdir("docs/screenshots/mobile-preview", { recursive: true });
    await page.screenshot({
      path: `docs/screenshots/mobile-preview/profile-save-error-${width}.png`,
    });

    await budget.fill("85");
    await currency.fill("CAD");
    await save.scrollIntoViewIfNeeded();
    await save.click();
    const saved = feedback.getByText("Preferences saved on this device.", {
      exact: true,
    });
    await expect(saved).toBeInViewport({ ratio: 1 });
    await expect(save).toBeInViewport({ ratio: 1 });
    await expect(
      page.getByText("Preferences saved on this device.", { exact: true }),
    ).toHaveCount(1);
    await expect(page.getByRole("alert")).toHaveCount(0);
    const stored = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key) || "null"),
      preferenceKey,
    );
    expect(stored).toMatchObject({ budget: 85, budgetCurrency: "CAD" });
    await page.screenshot({
      path: `docs/screenshots/mobile-preview/profile-saved-${width}.png`,
    });
    expect(unexpected).toEqual([]);
  });
}

test("Profile advanced validation has one modal alert and reminder feedback keeps its own meaning", async ({
  page,
}) => {
  const unexpected = await openGuestProfile(page);
  await page
    .getByRole("textbox", { name: "Usual budget", exact: true })
    .fill("");
  await page
    .getByRole("button", { name: "More personal preferences", exact: true })
    .click();
  const sheet = page.getByRole("dialog", {
    name: "A little more you",
    exact: true,
  });
  await sheet
    .getByRole("button", { name: "Save my preferences", exact: true })
    .click();
  await expect(sheet.getByRole("alert")).toHaveText(budgetProblem);
  await expect(page.getByRole("alert")).toHaveCount(1);
  await sheet.getByRole("button", { name: "Close", exact: true }).click();
  const feedback = page.getByTestId("preference-save-feedback");
  await expect(feedback.getByRole("alert")).toBeInViewport({ ratio: 1 });
  await page
    .getByRole("button", { name: "Cancel all outing reminders", exact: true })
    .click();
  await expect(
    page.getByText("All outing reminders cancelled.", { exact: true }),
  ).toHaveCount(1);
  await expect(feedback).not.toContainText("All outing reminders cancelled.");
  await expect(feedback.getByRole("alert")).toHaveCount(0);
  expect(unexpected).toEqual([]);
});

test("a pending preference write keeps newer unsaved input while persisting the authorized snapshot", async ({
  page,
}) => {
  const unexpected = await openGuestProfile(page);
  const budget = page.getByRole("textbox", {
    name: "Usual budget",
    exact: true,
  });
  const currency = page.getByRole("textbox", {
    name: "Budget currency code",
    exact: true,
  });
  const feedback = page.getByTestId("preference-save-feedback");
  const save = feedback.getByRole("button", {
    name: "Save my preferences",
    exact: true,
  });
  await budget.fill("85");
  await currency.fill("CAD");
  // AsyncStorage's browser adapter awaits the Storage return value. Hold one
  // real preference write to expose an edit made while persistence is pending.
  await page.evaluate((key) => {
    const state = window as typeof window & {
      preferenceWriteHeld?: boolean;
      releasePreferenceWrite?: () => void;
    };
    const original = Storage.prototype.setItem;
    Object.defineProperty(Storage.prototype, "setItem", {
      configurable: true,
      writable: true,
      value: function (this: Storage, itemKey: string, value: string) {
        if (this === localStorage && itemKey === key) {
          state.preferenceWriteHeld = true;
          return new Promise<void>((resolve) => {
            state.releasePreferenceWrite = () => {
              Storage.prototype.setItem = original;
              original.call(this, itemKey, value);
              resolve();
            };
          });
        }
        return original.call(this, itemKey, value);
      },
    });
  }, preferenceKey);
  await save.click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "preferenceWriteHeld")))
    .toBe(true);
  await budget.fill("92");
  await page.evaluate(() => Reflect.get(window, "releasePreferenceWrite")());
  await expect(save).toBeEnabled();
  await expect(budget).toHaveValue("92");
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key) || "null"),
      preferenceKey,
    ),
  ).toMatchObject({ budget: 85, budgetCurrency: "CAD" });
  await expect(feedback).not.toContainText("Preferences saved");
  await save.click();
  await expect(
    feedback.getByText("Preferences saved on this device.", { exact: true }),
  ).toBeInViewport({ ratio: 1 });
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key) || "null"),
      preferenceKey,
    ),
  ).toMatchObject({ budget: 92, budgetCurrency: "CAD" });
  expect(unexpected).toEqual([]);
});
