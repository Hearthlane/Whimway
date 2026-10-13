import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentUser, requireUser } from "@/lib/server/supabase";
import { POST } from "@/app/api/[...path]/route";

vi.mock("next/headers", () => ({ cookies: vi.fn(() => { throw new Error("Native auth must not read browser cookies"); }) }));
const sessionRequest = (token = "synthetic-access-token") => new Request("https://api.whimway.example/api/plans", { headers: { Authorization: `Bearer ${token}` } });
const user = {
  id: "a8447c4c-529f-4436-85bc-fbb378fc8e7a", aud: "authenticated",
  role: "authenticated", email: "test@example.com", created_at: "2026-01-01T00:00:00Z",
  app_metadata: {}, user_metadata: {}, identities: [],
};
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test-project.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "synthetic-publishable-key");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Verified Supabase bearer sessions", () => {
  it("verifies the token remotely and uses that same identity for RLS queries", async () => {
    const send = vi.fn().mockImplementation(async (input: RequestInfo | URL, init: RequestInit) => {
      const url = input.toString();
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer synthetic-access-token");
      if (url.endsWith("/auth/v1/user")) return new Response(JSON.stringify(user), { headers: { "Content-Type": "application/json" } });
      return new Response("[]", { headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", send);
    const request = sessionRequest();
    expect(await currentUser(request)).toMatchObject({ id: user.id });
    const { db, user: verified } = await requireUser(request);
    expect(verified.id).toBe(user.id);
    await db.from("plans").select("id");
    expect(send).toHaveBeenCalledTimes(2); // Auth verification is reused within this request.
    for (const [, init] of send.mock.calls)
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer synthetic-access-token");
    expect(send.mock.calls[0][0]).toContain("/auth/v1/user");
    expect(send.mock.calls[1][0]).toContain("/rest/v1/plans");
  });
  it("rejects expired bearer sessions instead of silently becoming a guest", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: "bad_jwt", msg: "invalid JWT" }), { status: 401, headers: { "Content-Type": "application/json" } })));
    await expect(currentUser(sessionRequest("expired"))).rejects.toMatchObject({ code: "INVALID_AUTH", status: 401 });
  });
  it("preserves a session when verification is temporarily unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Service unavailable", { status: 503 })));
    await expect(currentUser(sessionRequest())).rejects.toMatchObject({ code: "AUTH_UNAVAILABLE", status: 503 });
  });
  it("revokes the actual bearer on server logout rather than clearing an empty SDK session", async () => {
    const send = vi.fn().mockImplementation(async (input: RequestInfo | URL, init: RequestInit) => {
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer synthetic-access-token");
      return input.toString().endsWith("/auth/v1/user")
        ? new Response(JSON.stringify(user), { headers: { "Content-Type": "application/json" } })
        : new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", send);
    const result = await POST(new Request("https://api.whimway.example/api/auth/signout", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer synthetic-access-token" }, body: "{}",
    }), { params: Promise.resolve({ path: ["auth", "signout"] }) });
    expect(result.status).toBe(200);
    expect(send.mock.calls[1][0]).toContain("/auth/v1/logout?scope=global");
  });
  it("denies cookie-less native guests access to private resources", async () => {
    const send = vi.fn();
    vi.stubGlobal("fetch", send);
    const request = new Request("https://api.whimway.example/api/plans");
    expect(await currentUser(request)).toBeNull();
    await expect(requireUser(request)).rejects.toMatchObject({ code: "SIGN_IN_REQUIRED", status: 401 });
    expect(send).not.toHaveBeenCalled();
  });
  it("does not accept an account claim embedded in an unverified token", async () => {
    const claimed = "eyJhbGciOiJub25lIn0.eyJzdWIiOiJvd25lciJ9.";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ msg: "invalid token" }), { status: 401, headers: { "Content-Type": "application/json" } })));
    await expect(requireUser(sessionRequest(claimed))).rejects.toMatchObject({ code: "INVALID_AUTH", status: 401 });
  });
});
