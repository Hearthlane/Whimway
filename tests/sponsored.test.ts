import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET, POST } from "@/app/api/[...path]/route";
import { choose, type Campaign } from "@/lib/sponsored";
import { invalidateServable, memorySponsored } from "@/lib/server/sponsored";

vi.mock("@/lib/server/supabase", () => ({
  currentUser: async () => null,
  requireUser: async () => {
    throw new Error("no user");
  },
  supabase: async () => ({ rpc: vi.fn(async () => ({ error: null })) }),
}));
const ctx = (path: string) => ({ params: Promise.resolve({ path: path.split("/") }) });
const app = { "X-Whimway-Client": "app", "Content-Type": "application/json" };
const get = (path: string, headers: Record<string, string> = {}) =>
  GET(new Request(`http://localhost:3000/api/${path}`, { headers: { ...app, ...headers } }), ctx(path.split("?")[0]));
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  POST(new Request(`http://localhost:3000/api/${path}`, { method: "POST", headers: { ...app, ...headers }, body: JSON.stringify(body) }), ctx(path));

const downtown = { lat: 43.651, lng: -79.3815 };
const day = 24 * 3600e3;
const campaign = (over: Partial<Campaign> = {}) => ({
  business: { name: "Test Tacos", category: "mexican restaurant" },
  headline: "Two-for-one tacos on Tuesdays",
  body: "A test campaign.",
  cta: "See the menu",
  url: "https://example.com/tacos",
  area: { center: downtown, radius: 3000 },
  categories: ["mexican"],
  surfaces: ["home", "discover"] as Campaign["surfaces"],
  startsAt: new Date(Date.now() - day).toISOString(),
  endsAt: new Date(Date.now() + day).toISOString(),
  active: true,
  impressionCap: 0,
  ...over,
});

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("WHIMWAY_DEMO_MODE", "true");
  memorySponsored.campaigns.clear();
  memorySponsored.events.clear();
  invalidateServable();
});

describe("Choosing a sponsored placement", () => {
  const c = { ...campaign(), id: "00000000-0000-4000-8000-000000000001" } as Campaign;
  it("shows only running, in-range, relevant campaigns on their surfaces", () => {
    expect(choose([c], { surface: "home", point: downtown })).toBe(c);
    expect(choose([c], { surface: "options", point: downtown })).toBeUndefined();
    expect(choose([c], { surface: "home", point: { lat: 43.85, lng: -79.35 } })).toBeUndefined();
    expect(choose([c], { surface: "discover", point: downtown, category: "games" })).toBeUndefined();
    expect(choose([c], { surface: "discover", point: downtown, category: "mexican" })).toBe(c);
    expect(choose([{ ...c, active: false }], { surface: "home", point: downtown })).toBeUndefined();
    expect(choose([{ ...c, endsAt: new Date(Date.now() - 1000).toISOString() }], { surface: "home", point: downtown })).toBeUndefined();
    expect(choose([{ ...c, impressionCap: 10 }], { surface: "home", point: downtown }, { [c.id]: 10 })).toBeUndefined();
  });
  it("rotates fairly: the campaign shown least goes first", () => {
    const d = { ...c, id: "00000000-0000-4000-8000-000000000002" };
    expect(choose([c, d], { surface: "home", point: downtown }, { [c.id]: 5, [d.id]: 1 })).toBe(d);
  });
});

describe("Sponsored API", () => {
  it("serves nothing when there are no campaigns: no built-in advertisers", async () => {
    const r = await get(`sponsored?surface=home&lat=${downtown.lat}&lng=${downtown.lng}`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual([]);
  });
  it("needs the admin key to manage campaigns once one is set", async () => {
    vi.stubEnv("ADMIN_KEY", "secret-admin");
    // The key is accepted only in the header, never in the URL.
    expect((await get("admin/campaigns?key=secret-admin")).status).toBe(403);
    expect((await post("admin/campaigns", campaign())).status).toBe(403);
    expect((await get("admin/campaigns")).status).toBe(403);
    const created = await post("admin/campaigns", campaign(), { "x-admin-key": "secret-admin" });
    expect(created.status).toBe(200);
  });
  it("rejects unsafe or invalid campaigns", async () => {
    expect((await post("admin/campaigns", campaign({ url: "http://example.com" }))).status).toBe(400);
    expect((await post("admin/campaigns", campaign({ headline: "" }))).status).toBe(400);
  });
  it("serves a labelled placement, counts each person once a day, and reports stats", async () => {
    const created = await (await post("admin/campaigns", campaign())).json();
    const served = await (await get(`sponsored?surface=discover&lat=${downtown.lat}&lng=${downtown.lng}&category=mexican`)).json();
    expect(served).toHaveLength(1);
    expect(served[0]).toMatchObject({ label: "Sponsored", campaignId: created.id, headline: "Two-for-one tacos on Tuesdays" });
    expect(served[0]).not.toHaveProperty("area");
    // Counted once per network per day: a client cannot inflate counts by rotating its
    // install id.
    const event = (kind: string, installId: string, ip: string) =>
      post("sponsored/event", { placementId: served[0].id, campaignId: created.id, kind, installId }, { "x-forwarded-for": ip });
    expect((await event("impression", "install-aaaa1111", "203.0.113.1")).status).toBe(200);
    await event("impression", "install-aaaa1111", "203.0.113.1");
    await event("impression", "install-cccc3333", "203.0.113.1");
    await event("impression", "install-bbbb2222", "203.0.113.2");
    await event("click", "install-aaaa1111", "203.0.113.1");
    expect((await event("view", "install-aaaa1111", "203.0.113.1")).status).toBe(400);
    const list = await (await get("admin/campaigns")).json();
    expect(list[0].stats).toEqual({ impressions: 2, clicks: 1 });
  });
  it("can pause and delete a campaign; an update changes only the fields sent", async () => {
    const created = await (await post("admin/campaigns", campaign({ impressionCap: 500, categories: ["mexican", "games"] }))).json();
    const paused = await (await post("admin/campaigns", { id: created.id, active: false })).json();
    expect(paused).toMatchObject({ active: false, impressionCap: 500, categories: ["mexican", "games"], cta: "See the menu" });
    // A paused campaign is still listed for the admin, and can be resumed.
    expect((await (await get("admin/campaigns")).json())[0].active).toBe(false);
    expect((await post("admin/campaigns", { id: "00000000-0000-4000-8000-00000000dead", active: true })).status).toBe(404);
    expect(await (await get(`sponsored?surface=home&lat=${downtown.lat}&lng=${downtown.lng}`)).json()).toEqual([]);
    const del = await DELETE(new Request(`http://localhost:3000/api/admin/campaigns/${created.id}`, { method: "DELETE", headers: app }), ctx(`admin/campaigns/${created.id}`));
    expect(del.status).toBe(200);
    expect(await (await get("admin/campaigns")).json()).toEqual([]);
  });
});
