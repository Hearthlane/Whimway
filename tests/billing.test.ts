import { beforeEach, describe, expect, it, vi } from "vitest";
import { DateTime } from "luxon";
import { GET, POST } from "@/app/api/[...path]/route";
import { buildRequest, interpret } from "@/lib/intent";
import { FREE } from "@/lib/plus";
import { emptyProfile } from "@/lib/profile";
import {
  entitlementChange,
  entitlementFor,
  resetEntitlements,
} from "@/lib/server/entitlements";

const state = vi.hoisted(() => ({ user: null as null | { id: string } }));
vi.mock("@/lib/server/supabase", () => ({
  currentUser: async () => state.user,
  requireUser: async () => {
    throw new Error("no user");
  },
  supabase: async () => ({}),
}));
const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ctx = (path: string) => ({
  params: Promise.resolve({ path: path.split("/") }),
});
const base = { "Content-Type": "application/json", "X-Whimway-Client": "app" };
const post = (
  path: string,
  input: unknown,
  headers: Record<string, string> = {},
) =>
  POST(
    new Request(`http://localhost:3000/api/${path}`, {
      method: "POST",
      headers: { ...base, ...headers },
      body: JSON.stringify(input),
    }),
    ctx(path),
  );
const get = (path: string, headers: Record<string, string> = {}) =>
  GET(
    new Request(`http://localhost:3000/api/${path}`, {
      headers: { ...base, ...headers },
    }),
    ctx(path),
  );
const future = DateTime.now().setZone("America/Toronto").plus({ days: 2 });
const plan = (headers: Record<string, string>) =>
  post(
    "generate",
    {
      demo: true,
      request: {
        ...buildRequest(
          "date night",
          interpret("date night", future),
          emptyProfile(),
          future,
        ),
        date: future.toISODate()!,
        startTime: "18:30",
      },
    },
    headers,
  );
const webhook = (event: object, secret = "whsec-test") =>
  POST(
    new Request("http://localhost:3000/api/webhooks/billing", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ event }),
    }),
    ctx("webhooks/billing"),
  );

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("WHIMWAY_EVENT_LOG", "off");
  vi.stubEnv("WHIMWAY_DEMO_MODE", "true");
  vi.stubEnv("DAILY_GUEST_GENERATIONS", "1000");
  vi.stubEnv("DAILY_MEMBER_GENERATIONS", "1000");
  vi.stubEnv("BILLING_WEBHOOK_SECRET", "whsec-test");
  state.user = null;
  resetEntitlements();
});

describe("Free allowance is enforced on the server", () => {
  it("stops a guest install after the monthly free plans and reports usage", async () => {
    const who = { "X-Whimway-Install": "install-limit-1" };
    for (let i = 0; i < FREE.plansPerMonth; i++)
      expect((await plan(who)).status).toBe(200);
    const blocked = await plan(who);
    expect(blocked.status).toBe(402);
    expect((await blocked.json()).code).toBe("PLAN_LIMIT");
    expect(await (await get("entitlement", who)).json()).toMatchObject({
      plus: false,
      plansUsed: FREE.plansPerMonth,
      plansLimit: FREE.plansPerMonth,
    });
    // Another install is unaffected.
    expect(
      (await plan({ "X-Whimway-Install": "install-limit-2" })).status,
    ).toBe(200);
  });
  it("honours a demo purchase only where demo mode is allowed", async () => {
    const who = {
      "X-Whimway-Install": "install-demo-1",
      "X-Whimway-Demo-Plus": "1",
    };
    for (let i = 0; i < FREE.plansPerMonth + 2; i++)
      expect((await plan(who)).status).toBe(200);
    vi.stubEnv("NODE_ENV", "production");
    const request = new Request("http://x/api/entitlement", { headers: who });
    expect((await entitlementFor(request)).plus).toBe(false);
  });
});

describe("Billing webhook", () => {
  it("rejects wrong credentials and is off without a secret", async () => {
    expect(
      (await webhook({ type: "INITIAL_PURCHASE", app_user_id: USER }, "wrong"))
        .status,
    ).toBe(401);
    vi.stubEnv("BILLING_WEBHOOK_SECRET", "");
    expect(
      (await webhook({ type: "INITIAL_PURCHASE", app_user_id: USER })).status,
    ).toBe(503);
  });
  it("grants Plus on purchase, keeps it through cancellation, removes it on expiry", async () => {
    state.user = { id: USER };
    const who = { "X-Whimway-Install": "install-paid-1" };
    const inAMonth = Date.now() + 30 * 86400000;
    expect(
      await (
        await webhook({
          type: "INITIAL_PURCHASE",
          app_user_id: USER,
          product_id: "plus_yearly",
          expiration_at_ms: inAMonth,
        })
      ).json(),
    ).toEqual({ applied: true });
    const ent = await (await get("entitlement", who)).json();
    expect(ent).toMatchObject({
      plus: true,
      plan: "yearly",
      source: "store",
      plansLimit: null,
    });
    for (let i = 0; i < FREE.plansPerMonth + 1; i++)
      expect((await plan(who)).status).toBe(200);

    expect(
      await (await webhook({ type: "CANCELLATION", app_user_id: USER })).json(),
    ).toEqual({ applied: false });
    expect((await (await get("entitlement", who)).json()).plus).toBe(true);

    await webhook({
      type: "EXPIRATION",
      app_user_id: USER,
      product_id: "plus_yearly",
    });
    expect((await (await get("entitlement", who)).json()).plus).toBe(false);
    expect((await plan(who)).status).toBe(402);
  });
  it("treats a lapsed expiry date as no entitlement and ignores malformed users", async () => {
    state.user = { id: USER };
    await webhook({
      type: "RENEWAL",
      app_user_id: USER,
      product_id: "plus_monthly",
      expiration_at_ms: Date.now() - 1000,
    });
    expect((await (await get("entitlement")).json()).plus).toBe(false);
    expect(
      entitlementChange({
        type: "INITIAL_PURCHASE",
        app_user_id: "$RCAnonymousID:abc",
      }),
    ).toBeNull();
    expect(
      entitlementChange({ type: "BILLING_ISSUE", app_user_id: USER }),
    ).toBeNull();
  });
});

describe("Magic Edit allowance is enforced on the server", () => {
  it("allows the free edits per plan, then asks for Plus; failed edits are not counted", async () => {
    const who = { "X-Whimway-Install": "install-edits-1" };
    let current = await (await plan(who)).json();
    const locked = {
      ...current,
      stops: current.stops.map((s: object) => ({ ...s, locked: true })),
    };
    expect(
      (
        await post(
          "magic-edit",
          { spec: locked, instruction: "make it more romantic" },
          who,
        )
      ).status,
    ).toBe(422);
    for (let i = 0; i < FREE.magicEditsPerPlan; i++) {
      const r = await post(
        "magic-edit",
        { spec: current, instruction: "Change the last stop" },
        who,
      );
      expect(r.status).toBe(200);
      current = (await r.json()).plan;
    }
    const blocked = await post(
      "magic-edit",
      { spec: current, instruction: "Change the last stop" },
      who,
    );
    expect(blocked.status).toBe(402);
    expect((await blocked.json()).code).toBe("EDIT_LIMIT");
    // Plus (demo) is not limited, and a different plan starts fresh.
    expect(
      (
        await post(
          "magic-edit",
          { spec: current, instruction: "Change the last stop" },
          { ...who, "X-Whimway-Demo-Plus": "1" },
        )
      ).status,
    ).toBe(200);
    const other = await (await plan(who)).json();
    expect(
      (
        await post(
          "magic-edit",
          { spec: other, instruction: "Change the last stop" },
          who,
        )
      ).status,
    ).toBe(200);
  });
});
