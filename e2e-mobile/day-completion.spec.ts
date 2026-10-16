import { test, expect, type Page, type TestInfo } from "@playwright/test";
import type { Itinerary } from "../lib/schema";

// RN Web exercises the real notification service's persisted metadata and Day
// screen recovery. It cannot demonstrate cancellation of OS notifications.
const reminderKey = "whimway:native:reminders:v1";
const otherPlanId = "82b15861-f038-4913-81b3-fb9b08008770";
const cancellationWarning =
  "Your day is complete. Remaining reminders could not be canceled. Try again below.";

type StorageFailure = {
  enabled: boolean;
  attempts: number;
  restore: () => void;
};
type FailureWindow = Window & {
  __whimwayReminderStorageFailure?: StorageFailure;
};

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
  expect(plan.stops).toHaveLength(4);
  await expect(page).toHaveURL(new RegExp(`/plan/${plan.id}$`));
  await expect(page.getByRole("button", { name: /^Customize / })).toHaveCount(
    4,
  );
  return plan;
}

async function capture(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: false });
  await info.attach(name, { path, contentType: "image/png" });
}

test("Completed Day retains progress through real reminder metadata failure and scoped retry", async ({
  page,
}, info) => {
  const uncaught: string[] = [];
  page.on("pageerror", (error) => uncaught.push(error.message));
  const plan = await generateFixture(page);
  expect(plan.id).not.toBe(otherPlanId);
  await page.getByRole("button", { name: "Start my day", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/day/${plan.id}$`));
  const done = page.getByRole("button", {
    name: "I’m done here ✓",
    exact: true,
  });
  await expect(done).toBeEnabled();

  const progressKey = `whimway:native:progress:${plan.id}`;
  const options = {
    beforeMinutes: 15,
    upcomingStops: false,
    stopBeforeMinutes: 5,
  };
  const currentSettings = {
    planId: plan.id,
    enabled: true,
    options,
    notificationIds: [],
  };
  const otherSettings = {
    planId: otherPlanId,
    enabled: true,
    options,
    notificationIds: [],
  };
  await page.evaluate(
    ({ key, current, other }) => {
      // Seed valid metadata only after Day has opened. Reject precisely the
      // real service's reminder write, leaving progress and diagnostics usable.
      localStorage.setItem(
        key,
        JSON.stringify({ [current.planId]: current, [other.planId]: other }),
      );
      const original = Storage.prototype.setItem;
      const state: StorageFailure = {
        enabled: true,
        attempts: 0,
        restore: () => {
          Storage.prototype.setItem = original;
        },
      };
      (window as FailureWindow).__whimwayReminderStorageFailure = state;
      Storage.prototype.setItem = function (name, value) {
        if (this === localStorage && name === key && state.enabled) {
          state.attempts += 1;
          throw new DOMException(
            "Reminder metadata storage is unavailable for this regression.",
            "QuotaExceededError",
          );
        }
        return original.call(this, name, value);
      };
    },
    { key: reminderKey, current: currentSettings, other: otherSettings },
  );

  const readProgress = () =>
    page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key) ?? "null"),
      progressKey,
    );
  const readSettings = () =>
    page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key) ?? "{}"),
      reminderKey,
    );
  try {
    // Bound the journey independently of a disappearing/replaced button so a
    // regression cannot turn into an unbounded loop or silently skip a stop.
    for (let attempt = 0; attempt < 8; attempt++) {
      const before = await readProgress();
      if (before.completed.length === plan.stops.length) break;
      await expect(done).toBeEnabled();
      await done.scrollIntoViewIfNeeded();
      await done.click();
      await expect
        .poll(async () => (await readProgress()).completed.length)
        .toBe(before.completed.length + 1);
    }
    const completed = await readProgress();
    expect(completed).toMatchObject({
      planId: plan.id,
      completed: plan.stops.map((stop) => stop.placeId),
      skipped: [],
    });
    await expect(
      page.getByText(/That’s a day\s+worth keeping\./),
    ).toBeVisible();
    const alert = page
      .getByRole("alert")
      .filter({ hasText: cancellationWarning });
    await expect(alert).toBeVisible();
    const retry = page.getByRole("button", {
      name: "Cancel remaining reminders",
      exact: true,
    });
    await expect(retry).toBeEnabled();
    await retry.scrollIntoViewIfNeeded();
    await expect(retry).toBeInViewport({ ratio: 1 });
    expect(await readSettings()).toEqual({
      [plan.id]: currentSettings,
      [otherPlanId]: otherSettings,
    });
    expect(
      await page.evaluate(
        () =>
          (window as FailureWindow).__whimwayReminderStorageFailure?.attempts,
      ),
    ).toBeGreaterThanOrEqual(1);
    const completedRaw = await page.evaluate(
      (key) => localStorage.getItem(key),
      progressKey,
    );
    await capture(page, info, "rn-web-day-complete-reminder-cancel-failure");

    await page.evaluate(() => {
      (window as FailureWindow).__whimwayReminderStorageFailure!.enabled =
        false;
    });
    await retry.click();
    await expect(alert).not.toBeVisible();
    await expect(retry).not.toBeVisible();
    const recovered = page.getByText(
      "Remaining reminders canceled. Your completed progress is saved.",
      { exact: true },
    );
    await expect(recovered).toBeVisible();
    await expect.poll(readSettings).toEqual({ [otherPlanId]: otherSettings });
    expect(await readProgress()).toEqual(completed);
    expect(
      await page.evaluate((key) => localStorage.getItem(key), progressKey),
    ).toBe(completedRaw);
    await recovered.scrollIntoViewIfNeeded();
    await capture(page, info, "rn-web-day-complete-reminder-cancel-recovered");
    expect(uncaught).toEqual([]);
  } finally {
    await page.evaluate(() => {
      const current = window as FailureWindow;
      current.__whimwayReminderStorageFailure?.restore();
      delete current.__whimwayReminderStorageFailure;
    });
  }
});
