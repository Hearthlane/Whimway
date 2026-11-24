// Sign-in journeys against a simulated Supabase (no live project needed).
// Needs a web build that has accounts switched on, served next to the demo API:
//   (cd mobile && EXPO_PUBLIC_SUPABASE_URL=https://auth.whimway.test EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=test \
//      npx expo export --platform web --output-dir dist-auth)
//   WHIMWAY_WEB_DIST=dist-auth node mobile/scripts/serve-web.mjs 8091 http://127.0.0.1:3000
//   node mobile/scripts/auth-journey.cjs [http://localhost:8091] [auth-shots]
// Supabase's auth endpoints and the account endpoints of the Whimway API (/api/taste,
// /api/plans, /api/entitlement) are answered by this script; everything else is the real demo API.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const base = process.argv[2] ?? "http://localhost:8091";
const out = process.argv[3] ?? "auth-shots";
fs.mkdirSync(out, { recursive: true });
const CODE = "424242";
const EMAIL = "ana@example.com";

/** One fake account: what the server would hold for this email. */
function account() {
  return { taste: null, plans: [], otps: 0, verifies: 0, tastePosts: 0, planPosts: 0 };
}
const session = (email) => ({
  access_token: "test-access-token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: "test-refresh-token",
  user: { id: "7f1c2a9e-1111-4c4c-8888-000000000001", aud: "authenticated", role: "authenticated", email, app_metadata: { provider: "email" }, user_metadata: {}, created_at: new Date().toISOString() },
});

async function wire(page, acct, errors) {
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/status of (403|401)/.test(m.text()) && errors.push(m.text().slice(0, 200)));
  const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("https://auth.whimway.test/**", async (route) => {
    const url = new URL(route.request().url());
    const body = route.request().postDataJSON?.() ?? {};
    if (url.pathname.endsWith("/otp")) {
      acct.otps++;
      return json(route, 200, {});
    }
    if (url.pathname.endsWith("/verify")) {
      acct.verifies++;
      if (body.token !== CODE) return json(route, 403, { code: 403, error_code: "otp_expired", msg: "Token has expired or is invalid" });
      return json(route, 200, session(body.email));
    }
    if (url.pathname.endsWith("/user")) return json(route, 200, session(EMAIL).user);
    if (url.pathname.endsWith("/logout")) return route.fulfill({ status: 204 });
    return json(route, 404, {});
  });
  const authed = (route) => /Bearer test-access-token/.test(route.request().headers()["authorization"] ?? "");
  await page.route(/\/api\/(taste|plans|entitlement)(\?|$)/, async (route) => {
    if (!authed(route)) return json(route, 401, { error: "Sign in first.", code: "UNAUTHORIZED" });
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (path.endsWith("/entitlement")) return json(route, 200, { plus: false, source: "none" });
    if (path.endsWith("/taste")) {
      if (req.method() === "GET") return json(route, 200, acct.taste);
      acct.taste = req.postDataJSON();
      acct.tastePosts++;
      return json(route, 200, { saved: true });
    }
    if (req.method() === "GET") return json(route, 200, acct.plans);
    const spec = req.postDataJSON();
    acct.planPosts++;
    acct.plans = [{ id: spec.id, spec, updated_at: new Date().toISOString() }, ...acct.plans.filter((p) => p.id !== spec.id)];
    return json(route, 200, { id: spec.id });
  });
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/opt/pw-browsers/chromium" });
  const acct = account();
  const errors = [];
  const shot = (p, n) => p.screenshot({ path: `${out}/${n}.png` });
  const result = {};
  try {
    // 1) New person: onboarding → reveal → "Save your profile?" → sign in → home.
    const ctxA = await b.newContext({ viewport: { width: 390, height: 844 } });
    const a = await ctxA.newPage();
    await wire(a, acct, errors);
    await a.goto(`${base}/`, { waitUntil: "networkidle" });
    await a.getByTestId("onboarding-signin").waitFor({ timeout: 20000 });
    await shot(a, "01-welcome");
    await a.getByTestId("onboarding-next").click();
    await a.getByTestId("who-friends").click();
    await a.getByTestId("vibe-lively").click();
    await a.getByTestId("vibe-playful").click();
    for (let i = 0; i < 3; i++) {
      await a.getByTestId("onboarding-next").click();
      await a.waitForTimeout(250);
    }
    await a.getByLabel("What should we call you?").fill("Ana");
    await a.getByTestId("onboarding-next").click();
    await a.getByTestId("persona").waitFor({ timeout: 10000 });
    result.persona = await a.getByTestId("persona").innerText();
    await a.getByTestId("onboarding-next").click();
    await a.getByTestId("onboarding-account").waitFor();
    await shot(a, "02-save-profile");
    // Typo first: the address is flagged and the button stays off.
    await a.getByTestId("signin-email").fill("ana@example");
    await a.getByTestId("signin-email").blur();
    result.typoFlagged = await a.getByText("Check the email address").isVisible();
    result.sendDisabledOnTypo = await a.getByTestId("signin-send").isDisabled().catch(() => null);
    await a.getByTestId("signin-email").fill(EMAIL);
    await a.getByTestId("signin-send").click();
    await a.getByTestId("signin-code").waitFor();
    result.resendWaits = /Resend in \d+s/.test(await a.getByTestId("signin-resend").innerText());
    await shot(a, "03-code");
    // Wrong code: explained, nothing signed in.
    await a.getByTestId("signin-code").fill("111111");
    await a.getByText("That code didn’t work").waitFor();
    result.wrongCodeExplained = true;
    await shot(a, "04-wrong-code");
    await a.getByTestId("signin-code").fill(CODE);
    await a.waitForURL((u) => !u.pathname.startsWith("/onboarding"), { timeout: 20000 });
    await a.getByTestId("home-start").waitFor({ timeout: 20000 });
    await shot(a, "05-home-signed-in");
    result.tasteUploaded = acct.taste && acct.taste.onboarded === true && acct.taste.name === "Ana";
    // Add someone and make a plan, so there is something for another device to restore.
    await a.goto(`${base}/profile`, { waitUntil: "networkidle" });
    result.syncedLabel = await a.getByTestId("profile-synced").innerText();
    await a.getByRole("button", { name: "Add person" }).click();
    await a.getByTestId("person-name").fill("Sam");
    await a.getByTestId("person-like-games").click();
    await a.getByTestId("person-save").click();
    await a.waitForTimeout(600);
    result.personSynced = (acct.taste?.people ?? []).some((p) => p.name === "Sam");
    await shot(a, "06-profile-synced");
    await a.goto(`${base}/create`, { waitUntil: "networkidle" });
    await a.getByRole("button", { name: "Surprise me", exact: true }).click();
    await a.getByTestId("plan-title").waitFor({ timeout: 60000 });
    await a.waitForTimeout(800);
    const stored = await a.evaluate(() => JSON.parse(localStorage.getItem("whimway:plans:v1") ?? "{}"));
    const [planId, entry] = Object.entries(stored)[0];
    // Demo plans stay on the device; put this one in the fake account as a real saved plan.
    acct.plans = [{ id: planId, spec: { ...entry.spec, demo: false }, updated_at: new Date().toISOString() }];
    result.planTitle = entry.meta.title;

    // 2) Settings: sign out keeps everything on the device.
    await a.goto(`${base}/settings`, { waitUntil: "networkidle" });
    await a.getByRole("button", { name: "Sign out" }).click();
    await a.getByTestId("settings-signin").waitFor({ timeout: 10000 });
    await a.goto(`${base}/profile`, { waitUntil: "networkidle" });
    result.keptAfterSignOut = (await a.getByText("Ana").first().isVisible()) && (await a.getByTestId("profile-save-account").isVisible());
    await shot(a, "07-signed-out");
    await ctxA.close();

    // 3) Returning on a new device: "I already have an account" restores everything.
    const ctxB = await b.newContext({ viewport: { width: 390, height: 844 } });
    const c = await ctxB.newPage();
    await wire(c, acct, errors);
    await c.goto(`${base}/`, { waitUntil: "networkidle" });
    await c.getByTestId("onboarding-signin").click();
    await shot(c, "08-welcome-back");
    await c.getByTestId("signin-email").fill(EMAIL);
    await c.getByTestId("signin-send").click();
    await c.getByTestId("signin-code").fill(CODE);
    await c.getByTestId("welcome-back").waitFor({ timeout: 20000 });
    result.welcomeBack = await c.getByTestId("welcome-back").innerText();
    await shot(c, "09-home-restored");
    await c.goto(`${base}/profile`, { waitUntil: "networkidle" });
    await c.getByTestId("profile-tab-people").click();
    result.restoredPeople = await c.locator('[data-testid^="people-row-"]').allInnerTexts();
    await c.goto(`${base}/saved`, { waitUntil: "networkidle" });
    await c.waitForTimeout(600);
    result.restoredPlanVisible = await c.getByText(result.planTitle).first().isVisible();
    await shot(c, "10-saved-restored");
    await ctxB.close();

    // 4) Account with no profile yet: signing in from the welcome screen carries on with the questions.
    const fresh = account();
    const ctxD = await b.newContext({ viewport: { width: 390, height: 844 } });
    const d = await ctxD.newPage();
    await wire(d, fresh, errors);
    await d.goto(`${base}/`, { waitUntil: "networkidle" });
    await d.getByTestId("onboarding-signin").click();
    await d.getByTestId("signin-email").fill("new@example.com");
    await d.getByTestId("signin-send").click();
    await d.getByTestId("signin-code").fill(CODE);
    await d.getByTestId("onboarding-signed-in").waitFor({ timeout: 20000 });
    result.newAccountContinues = await d.getByTestId("who-friends").isVisible();
    await shot(d, "11-new-account-continues");
    await d.getByTestId("who-friends").click();
    for (let i = 0; i < 4; i++) {
      await d.getByTestId("onboarding-next").click();
      await d.waitForTimeout(300);
    }
    await d.getByTestId("persona").waitFor({ timeout: 10000 }).catch(() => undefined);
    await d.getByTestId("onboarding-next").click();
    await d.waitForURL((u) => !u.pathname.startsWith("/onboarding"), { timeout: 20000 });
    result.noAccountStepWhenSignedIn = !(await d.getByTestId("onboarding-account").isVisible().catch(() => false));
    result.freshAccountSaved = fresh.taste?.onboarded === true;
    await ctxD.close();

    assert.ok(result.typoFlagged, "typo flagged");
    assert.ok(result.resendWaits, "resend has a cooldown");
    assert.ok(result.wrongCodeExplained, "wrong code explained");
    assert.ok(result.tasteUploaded, "profile saved to the account after onboarding");
    assert.match(result.syncedLabel, /Synced to ana@example.com/);
    assert.ok(result.personSynced, "people sync to the account");
    assert.ok(result.keptAfterSignOut, "sign out keeps the device's data");
    assert.match(result.welcomeBack, /Welcome back, Ana.*1 saved plan/);
    assert.ok(result.restoredPeople.some((t) => t.includes("Sam")), "people restored");
    assert.ok(result.restoredPlanVisible, "saved plan restored");
    assert.ok(result.newAccountContinues, "new account continues onboarding");
    assert.ok(result.freshAccountSaved, "new account's profile saved after onboarding");
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ...result, otps: acct.otps, verifies: acct.verifies, tastePosts: acct.tastePosts, errors }, null, 2));
    console.log("AUTH JOURNEY PASSED");
  } catch (e) {
    console.log(JSON.stringify({ ...result, errors }, null, 2));
    console.log("AUTH JOURNEY FAILED", e.message.split("\n").slice(0, 4).join(" // "));
    process.exitCode = 1;
  } finally {
    await b.close();
  }
})();
