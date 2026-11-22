import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/[...path]/route";
import { providerCache, staticMapKey, staticMapUrl } from "@/lib/providers/google";

vi.mock("@/lib/server/supabase", () => ({
  currentUser: async () => null,
  requireUser: async () => {
    throw new Error("no user");
  },
  supabase: async () => ({}),
}));
const get = (path: string) =>
  GET(new Request(`http://localhost:3000/api/${path}`, { headers: { "X-Whimway-Client": "app" } }), {
    params: Promise.resolve({ path: [path.split("?")[0]] }),
  });

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  providerCache.clear();
});

describe("Real map images", () => {
  it("never uses the proxy placeholder as a key", () => {
    vi.stubEnv("GOOGLE_MAPS_SERVER_KEY", "proxy-injected");
    expect(staticMapKey()).toBe("");
    vi.stubEnv("GOOGLE_MAPS_STATIC_KEY", "static-key");
    expect(staticMapKey()).toBe("static-key");
  });
  it("draws numbered stops and the real route where there is one", () => {
    const url = new URL(
      staticMapUrl({ stops: [{ lat: 43.65, lng: -79.38 }, { lat: 43.66, lng: -79.39 }, { lat: 43.67, lng: -79.4 }], paths: ["abc", ""], width: 600, height: 260 }, "k"),
    );
    expect(url.hostname).toBe("maps.googleapis.com");
    expect(url.searchParams.getAll("markers").map((m) => m.split("|")[1])).toEqual(["label:1", "label:2", "label:3"]);
    const paths = url.searchParams.getAll("path");
    expect(paths[0]).toContain("enc:abc");
    expect(paths[1]).toContain("43.660000,-79.390000|43.670000,-79.400000");
    expect(url.searchParams.get("key")).toBe("k");
  });
  it("serves the image with the key kept on the server, and reports availability", async () => {
    expect((await (await get("status")).json()).staticMap).toBe(false);
    expect((await get("staticmap?stops=43.65,-79.38")).status).toBe(503);
    vi.stubEnv("GOOGLE_MAPS_STATIC_KEY", "secret-static");
    const fetcher = vi.fn().mockResolvedValue(new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } }));
    vi.stubGlobal("fetch", fetcher);
    expect((await (await get("status")).json()).staticMap).toBe(true);
    const r = await get("staticmap?stops=43.65,-79.38;43.66,-79.39&w=600&h=260");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(fetcher.mock.calls[0][0]).toContain("key=secret-static");
    expect(await r.text()).not.toContain("secret-static");
    expect((await get("staticmap?stops=999,0")).status).toBe(400);
    expect((await get("staticmap?stops=43.65,-79.38&paths=%3Cscript%3E")).status).toBe(400);
  });
});
