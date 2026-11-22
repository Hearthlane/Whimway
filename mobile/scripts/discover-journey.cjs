// Walks the Discover tab against a running preview (npm run preview) and saves screenshots.
// Usage: node scripts/discover-journey.cjs <output-dir> [admin-key]
const { chromium } = require("playwright");
const fs = require("node:fs");

(async () => {
  const out = process.argv[2] ?? "discover-shots";
  const adminKey = process.argv[3];
  fs.mkdirSync(out, { recursive: true });
  const base = "http://localhost:8090";
  const errors = [];
  const b = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
  const p = await b.newPage({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2 });
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => m.type() === "error" && !/ERR_TUNNEL|Failed to load resource/.test(m.text()) && errors.push(m.text().slice(0, 200)));
  const shot = async (n) => {
    await p.waitForTimeout(900);
    await p.screenshot({ path: `${out}/${n}.png` });
  };

  // A test campaign so the sponsored slot can be checked; removed at the end.
  let campaignId;
  if (adminKey !== "none") {
    const r = await fetch(`${base}/api/admin/campaigns`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: base, ...(adminKey ? { "x-admin-key": adminKey } : {}) },
      body: JSON.stringify({
        business: { name: "Test campaign (QA)", category: "arcade" },
        headline: "QA check: sponsored slot",
        body: "Shown only during automated testing.",
        cta: "Open",
        url: "https://example.com",
        area: { center: { lat: 43.651, lng: -79.3815 }, radius: 20000 },
        categories: [],
        surfaces: ["home", "discover"],
        startsAt: new Date(Date.now() - 3600e3).toISOString(),
        endsAt: new Date(Date.now() + 3600e3).toISOString(),
      }),
    });
    campaignId = r.ok ? (await r.json()).id : undefined;
    console.log("test campaign:", r.status);
  }

  await p.addInitScript(() => {
    try {
      if (!sessionStorage.getItem("c")) {
        localStorage.clear();
        sessionStorage.setItem("c", "1");
      }
    } catch {}
  });
  await p.goto(base, { waitUntil: "networkidle", timeout: 90000 });
  for (const t of ["Skip", "Skip for now", "Maybe later"]) {
    const el = p.getByText(t, { exact: true }).first();
    if (await el.isVisible().catch(() => false)) {
      await el.click();
      await p.waitForTimeout(800);
    }
  }
  await p.goto(`${base}/discover`, { waitUntil: "networkidle" });
  await p.waitForSelector('[data-testid="discover-place-0"]', { timeout: 30000 });
  await shot("01-discover");
  const count = await p.locator('[data-testid^="discover-place-"]').count();
  const sponsored = await p.getByTestId("sponsored-discover").isVisible().catch(() => false);
  await p.getByTestId("discover-cat-japanese").click();
  await p.waitForTimeout(400);
  await p.waitForSelector('[data-testid="discover-place-0"]', { timeout: 30000 });
  await p.getByTestId("discover-sort-rated").click();
  await shot("02-japanese-rated");
  await p.getByTestId("discover-search").fill("bubble tea");
  await p.getByTestId("discover-search").press("Enter");
  await p.waitForTimeout(500);
  await p.locator('[data-testid="discover-place-0"]').or(p.getByText('Nothing like that is open then')).first().waitFor({ timeout: 30000 });
  await shot("03-search");
  const first = (await p.getByTestId("discover-place-0").innerText().catch(() => "")).split("\n")[0];
  await p.getByTestId("discover-place-0").click();
  await shot("04-sheet");
  await p.getByTestId("discover-plan-around").click();
  await p.waitForSelector('[data-testid="option-0"]', { timeout: 60000 });
  await shot("05-options");
  const anchored = await p.getByTestId("option-0").innerText();

  if (campaignId) {
    const list = await (await fetch(`${base}/api/admin/campaigns`, { headers: { Origin: base, ...(adminKey ? { "x-admin-key": adminKey } : {}) } })).json();
    console.log("campaign stats:", JSON.stringify(list.find((c) => c.id === campaignId)?.stats));
    await fetch(`${base}/api/admin/campaigns/${campaignId}`, { method: "DELETE", headers: { Origin: base, ...(adminKey ? { "x-admin-key": adminKey } : {}) } });
  }
  console.log(JSON.stringify({ results: count, sponsoredShown: sponsored, searchFirst: first, plannedAround: anchored.includes(first), errors }, null, 2));
  await b.close();
  if (errors.length || !count || !anchored.includes(first)) process.exit(1);
})().catch((e) => {
  console.error("FAIL", e.message);
  process.exit(1);
});
