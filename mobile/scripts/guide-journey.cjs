const { chromium } = require("playwright");
(async () => {
  // Walks the guided planner end to end against a running preview (npm run preview) and saves screenshots.
  // Usage: node scripts/guide-journey.cjs <output-dir>
  const out = process.argv[2] ?? "guide-shots";
  require("node:fs").mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }).catch(() => chromium.launch());
  const p = await b.newPage({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2 });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 200)));
  await p.addInitScript(() => { try { if (!sessionStorage.getItem("c")) { localStorage.clear(); sessionStorage.setItem("c", "1"); } } catch {} });
  await p.goto("http://localhost:8090", { waitUntil: "networkidle", timeout: 90000 });
  await p.waitForTimeout(2500);
  const shot = async (n) => { await p.waitForTimeout(900); await p.screenshot({ path: `${out}/${n}.png` }); };
  await shot("00-first");
  // skip onboarding if present
  for (const t of ["Skip", "Skip for now", "Maybe later"]) { const el = p.getByText(t, { exact: true }).first(); if (await el.isVisible().catch(() => false)) { await el.click(); await p.waitForTimeout(800); } }
  await p.goto("http://localhost:8090/", { waitUntil: "networkidle" }).catch(() => {});
  await p.waitForTimeout(1500);
  await shot("01-home");
  const start = p.getByTestId("guide-start");
  if (!(await start.isVisible().catch(() => false))) { console.log("no guide-start; url", p.url()); await p.goto("http://localhost:8090/guide"); } else await start.click();
  await shot("02-when");
  await p.getByTestId("guide-day-1").click().catch(() => {});
  await p.getByTestId("guide-time-18:30").click();
  await shot("03-food");
  await p.getByTestId("guide-food-meal").click();
  await shot("04-cuisine");
  await p.getByTestId("guide-cuisine-asian").click();
  await p.waitForSelector('[data-testid="guide-food-place-0"]', { timeout: 15000 });
  await shot("05-food-place");
  await p.getByTestId("guide-food-place-0").click();
  await shot("06-fun");
  await p.getByTestId("guide-fun-yes").click();
  await shot("07-kind");
  await p.getByTestId("guide-kind-games").click();
  await p.waitForSelector('[data-testid="guide-fun-place-0"]', { timeout: 15000 });
  await shot("08-fun-place");
  await p.getByTestId("guide-fun-place-0").click();
  await shot("09-travel");
  await p.getByTestId("guide-mode-TRANSIT").click();
  await shot("10-review");
  await p.getByTestId("guide-build").click();
  await p.waitForSelector('[data-testid="timetable"]', { timeout: 30000 });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${out}/11-plan.png`, fullPage: false });
  console.log("title:", await p.getByTestId("plan-title").textContent());
  console.log("errors:", errs);
  await b.close();
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
