const { chromium } = require("playwright");
(async () => {
  // Walks the guided planner end to end against a running preview (npm run preview) and saves screenshots.
  // Usage: node scripts/guide-journey.cjs <output-dir>
  const out = process.argv[2] ?? "guide-shots";
  require("node:fs").mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }).catch(() => chromium.launch());
  const p = await b.newPage({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2 });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => m.type() === "error" && !/status of 422/.test(m.text()) && errs.push(m.text().slice(0, 200))); // a 422 is an edit the server explains it cannot fit
  await p.addInitScript(() => { try { if (!sessionStorage.getItem("c")) { localStorage.clear(); sessionStorage.setItem("c", "1"); } } catch {} });
  await p.goto("http://localhost:8090", { waitUntil: "networkidle", timeout: 90000 });
  await p.waitForTimeout(2500);
  const shot = async (n) => { await p.waitForTimeout(900); await p.screenshot({ path: `${out}/${n}.png` }); };
  await shot("00-first");
  // skip onboarding if present
  for (const t of ["Look around first", "Skip", "Skip for now", "Maybe later"]) { const el = p.getByText(t, { exact: true }).first(); if (await el.isVisible().catch(() => false)) { await el.click(); await p.waitForTimeout(800); } }
  await p.goto("http://localhost:8090/create", { waitUntil: "networkidle" }).catch(() => {});
  await p.waitForTimeout(1500);
  await shot("01-home");
  const start = p.getByTestId("guide-start");
  if (!(await start.isVisible().catch(() => false))) { console.log("no guide-start; url", p.url()); await p.goto("http://localhost:8090/guide"); } else await start.click();
  await shot("02-who");
  await p.getByTestId("guide-who-friends").click();
  await shot("03-when");
  await p.getByTestId("guide-day-1").click().catch(() => {});
  await p.getByTestId("guide-time-18:30").click();
  await shot("04-food");
  await p.getByTestId("guide-food-meal").click();
  await shot("05-cuisine");
  await p.getByTestId("guide-cuisine-text").fill("tacos");
  await p.getByTestId("guide-cuisine-find").click();
  await p.waitForSelector('[data-testid="guide-food-place-0"]', { timeout: 15000 });
  await shot("06-food-place");
  await p.getByTestId("guide-food-place-0").click();
  await shot("07-fun");
  await p.getByTestId("guide-fun-yes").click();
  await shot("08-kind");
  await p.getByTestId("guide-kind-games").click();
  await p.waitForSelector('[data-testid="guide-fun-place-0"]', { timeout: 15000 });
  await shot("09-fun-place");
  await p.getByTestId("guide-fun-place-0").click();
  await shot("10-travel");
  await p.getByTestId("guide-mode-TRANSIT").click();
  await p.getByTestId("guide-mood-lively").click();
  await p.getByTestId("guide-budget-50").click();
  await p.getByTestId("guide-note").fill("It's Sam's birthday, somewhere loud is fine");
  await shot("11-extras");
  await p.getByTestId("guide-extras-next").click();
  await shot("12-review");
  await p.getByTestId("guide-build").click();
  await p.waitForSelector('[data-testid="option-0"]', { timeout: 30000 });
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${out}/12b-options.png` });
  const counts = [];
  for (let i = 0; i < 3; i++) counts.push((await p.getByTestId(`option-${i}`).innerText().catch(() => "")).split("\n").length);
  console.log("options:", counts.length, counts);
  await p.getByTestId("refine-text").scrollIntoViewIfNeeded();
  await p.getByTestId("refine-text").fill("We haven't seen each other in ages, something more fun and lively");
  await p.screenshot({ path: `${out}/12c-refine.png` });
  await p.getByTestId("refine-go").click();
  await p.waitForSelector('[data-testid="option-0"]', { timeout: 30000 });
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${out}/12d-refined.png` });
  await p.getByTestId("option-1").click();
  await p.waitForSelector('[data-testid="timetable"]', { timeout: 30000 });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${out}/13-plan.png`, fullPage: false });
  await p.mouse.wheel(0, 330); await p.waitForTimeout(600);
  await p.screenshot({ path: `${out}/14-timetable.png`, fullPage: false });
  // Direct edits: move the second stop earlier, then give it 15 more minutes.
  const names = async () => (await p.locator('[data-testid^="timetable-row-"]').allInnerTexts()).map((t) => t.split("\n").slice(-2)[0]);
  const before = await names();
  await p.getByTestId("stop-2").click();
  await p.getByText("Earlier", { exact: true }).click();
  await p.getByText("Order changed. Times and travel updated.").waitFor({ timeout: 20000 });
  const after = await names();
  console.log("reorder:", JSON.stringify(before), "->", JSON.stringify(after), after[0] === before[1] && after[1] === before[0] ? "OK" : "FAILED");
  await p.screenshot({ path: `${out}/16-reordered.png` });
  // Adding a stop either adds one, or (late in the evening, when nothing else is open)
  // says so on screen. A silent no-op is a failure.
  await p.getByTestId("add-stop").click();
  const added = await Promise.race([
    p.waitForFunction((n) => document.querySelectorAll('[data-testid^="timetable-row-"]').length > n, before.length, { timeout: 30000 }).then(() => "added"),
    p.getByText(/so your plan is unchanged/).first().waitFor({ timeout: 30000 }).then(() => "explained"),
  ]).catch(() => "silent");
  await p.screenshot({ path: `${out}/17-add-stop.png` });
  console.log("add stop:", added, before.length, "->", (await names()).length);
  if (added === "silent") throw new Error("Add a stop did nothing and said nothing");
  await p.goto("http://localhost:8090/", { waitUntil: "networkidle" });
  await p.waitForTimeout(1500);
  await p.getByText("Coming up", { exact: true }).scrollIntoViewIfNeeded().catch(() => {});
  await p.screenshot({ path: `${out}/15-home-lists.png` });
  console.log("home lists:", await p.getByText("Upcoming", { exact: true }).isVisible().catch(() => false), await p.getByText("Recently created", { exact: true }).isVisible().catch(() => false));
  console.log("errors:", errs);
  await b.close();
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
