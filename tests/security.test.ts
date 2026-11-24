import { afterEach, describe, expect, it, vi } from "vitest";
import { clientIp } from "../lib/server/security";

const req = (headers: Record<string, string>) => new Request("https://api.example/api/status", { headers });

describe("client address", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("uses the platform's forwarded address by default", () => {
    expect(clientIp(req({ "x-vercel-forwarded-for": "1.2.3.4" }))).toBe("1.2.3.4");
    expect(clientIp(req({ "x-forwarded-for": "5.6.7.8, 10.0.0.1" }))).toBe("5.6.7.8");
    expect(clientIp(req({}))).toBe("local");
  });
  it("trusts the app site's forwarded visitor address only with the shared secret", () => {
    vi.stubEnv("WHIMWAY_PROXY_SECRET", "a-long-shared-secret-123");
    const base = { "x-vercel-forwarded-for": "9.9.9.9", "x-whimway-client-ip": "1.2.3.4" };
    expect(clientIp(req({ ...base, "x-whimway-proxy-secret": "a-long-shared-secret-123" }))).toBe("1.2.3.4");
    expect(clientIp(req({ ...base, "x-whimway-proxy-secret": "wrong" }))).toBe("9.9.9.9");
    expect(clientIp(req(base))).toBe("9.9.9.9");
  });
  it("ignores the forwarded header when no secret is configured", () => {
    expect(clientIp(req({ "x-vercel-forwarded-for": "9.9.9.9", "x-whimway-client-ip": "1.2.3.4", "x-whimway-proxy-secret": "" }))).toBe("9.9.9.9");
  });
});
