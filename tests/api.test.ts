import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AppError } from "@/lib/errors";
import { spec, request } from "./helpers";
import { POST, GET, DELETE } from "@/app/api/[...path]/route";
const state = vi.hoisted(() => ({
  user: null as null | { id: string; email: string },
  saved: null as unknown,
  shared: null as unknown,
  writes: [] as unknown[],
  db: { from: vi.fn(), rpc: vi.fn(), auth: { signOut: vi.fn() } },
}));
vi.mock("@/lib/server/supabase", () => ({
  currentUser: async () => state.user,
  requireUser: async () => {
    if (!state.user)
      throw new AppError(
        "SIGN_IN_REQUIRED",
        "Sign in to save or share plans across devices.",
        401,
      );
    return { db: state.db, user: state.user };
  },
  supabase: async () => state.db,
}));
function ctx(path: string) {
  return { params: Promise.resolve({ path: path.split("/") }) };
}
function post(path: string, input: unknown, origin = "http://localhost:3000") {
  return POST(
    new Request(`http://localhost:3000/api/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify(input),
    }),
    ctx(path),
  );
}
beforeEach(() => {
  vi.stubEnv("WHIMWAY_DEMO_MODE", "true");
  vi.stubEnv("DAILY_GUEST_GENERATIONS", "100");
  vi.stubEnv("DAILY_REMIX_LIMIT", "100");
  state.user = null;
  state.saved = null;
  state.shared = null;
  state.writes = [];
  state.db.from.mockImplementation((table: string) => {
    const chain: { [key: string]: unknown } = {};
    for (const method of ["select", "eq", "order", "limit"])
      chain[method] = vi.fn(() => chain);
    chain.upsert = vi.fn(async (data: unknown) => {
      state.saved = data;
      state.writes.push(data);
      return { error: null };
    });
    chain.insert = vi.fn((data: unknown) => {
      state.shared = data;
      state.writes.push(data);
      return chain;
    });
    chain.single = vi.fn(async () =>
      table === "shares"
        ? { data: { id: "02a4cc14-503a-4978-a655-244d1c565a67" }, error: null }
        : { data: state.saved, error: null },
    );
    chain.delete = vi.fn(() => chain);
    return chain;
  });
  state.db.rpc.mockImplementation(async () => ({
    data: state.shared,
    error: null,
  }));
});
afterEach(() => vi.unstubAllEnvs());
describe("Application endpoints", () => {
  it("runs the complete fixture generation, hydrate and editing pipeline", async () => {
    const r = await post("generate", { request: request(), demo: true });
    expect(r.status).toBe(200);
    const p = await r.json();
    const h = await post("hydrate", p);
    expect(h.status).toBe(200);
    const edit = await post("edit", { spec: p, stops: p.stops.slice(0, 2) });
    expect(edit.status).toBe(200);
    expect((await edit.json()).stops).toHaveLength(2);
  });
  it("rejects cross-site generation and oversized bodies", async () => {
    expect(
      (await post("generate", { request: request() }, "https://evil.example"))
        .status,
    ).toBe(403);
    expect((await post("generate", { text: "a".repeat(33000) })).status).toBe(
      413,
    );
  });
  it("does not allow removal or duration changes to locked stops", async () => {
    const s = spec();
    s.stops[0].locked = true;
    const r = await post("edit", { spec: s, stops: s.stops.slice(1) });
    expect(r.status).toBe(422);
    expect((await r.json()).code).toBe("LOCK_CONFLICT");
  });
  it("requires an authenticated user for cloud saving", async () => {
    const s = spec();
    s.demo = false;
    expect((await post("plans", s)).status).toBe(401);
    expect(state.writes).toHaveLength(0);
  });
  it("preserves optional budget currency while rejecting invalid profile currency codes", async () => {
    state.user = { id: "owner", email: "test@example.com" };
    const preferences = { enabled: true, interests: ["Outdoors"], dietary: "", accessibility: "", mode: "WALK", budget: 6000, cuisines: "", atmosphere: "", disliked: [], budgetCurrency: "JPY" };
    expect((await post("profile", preferences)).status).toBe(200);
    expect(state.saved).toMatchObject({ preferences: { budgetCurrency: "JPY", budget: 6000 } });
    expect((await post("profile", { ...preferences, budgetCurrency: "yen" })).status).toBe(400);
  });
  it("strips provider content before saving and assigns ownership on the server", async () => {
    state.user = { id: "owner", email: "test@example.com" };
    const s = spec();
    s.demo = false;
    const r = await post("plans", {
      ...s,
      user_id: "attacker",
      legs: [{ secret: "restricted" }],
      stops: s.stops.map((x) => ({
        ...x,
        place: { name: "restricted content" },
      })),
    });
    expect(r.status).toBe(200);
    expect(state.saved).toMatchObject({ user_id: "owner" });
    expect((state.saved as { spec: unknown }).spec).not.toHaveProperty("legs");
    expect(
      (state.saved as { spec: { stops: unknown[] } }).spec.stops[0],
    ).not.toHaveProperty("place");
  });
  it("publishes a scrubbed public copy and guest access stays read-only", async () => {
    state.user = { id: "owner", email: "test@example.com" };
    const s = spec();
    s.demo = false;
    s.request.prompt = "Private details";
    s.request.dietary = "Private";
    s.request.start = { lat: 43.655, lng: -79.381 };
    state.saved = { spec: s };
    const r = await post("share", { id: s.id });
    expect(r.status).toBe(200);
    const shared = state.shared as {
      spec: { request: { prompt: string; start?: unknown; dietary: string } };
    };
    expect(shared.spec.request).toMatchObject({ prompt: "", dietary: "" });
    expect(shared.spec.request.start).toBeUndefined();
    state.shared = shared.spec;
    state.user = null;
    const read = await GET(
      new Request(
        "http://localhost:3000/api/shared/02a4cc14-503a-4978-a655-244d1c565a67",
      ),
      ctx("shared/02a4cc14-503a-4978-a655-244d1c565a67"),
    );
    expect(read.status).toBe(200);
    const del = await DELETE(
      new Request(`http://localhost:3000/api/plans/${s.id}`, {
        method: "DELETE",
        headers: { Origin: "http://localhost:3000" },
      }),
      ctx(`plans/${s.id}`),
    );
    expect(del.status).toBe(401);
  });
  it("refuses cloud publication of demo fixtures", async () => {
    state.user = { id: "owner", email: "test@example.com" };
    expect((await post("plans", spec())).status).toBe(400);
    expect(state.writes).toHaveLength(0);
  });
  it("returns explicit missing-provider configuration errors", async () => {
    vi.stubEnv("GOOGLE_MAPS_SERVER_KEY", "");
    const r = await post("generate", { request: request(), demo: false });
    expect(r.status).toBe(503);
    expect((await r.json()).code).toBe("NOT_CONFIGURED");
  });
});
