import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { describe, expect, it } from "vitest";

const bridge = new Script(
  readFileSync(
    new URL("../e2e-native/helpers/observe-ios-plan.js", import.meta.url),
    "utf8",
  ),
);

describe("Maestro native viewport observation bridge", () => {
  it("uses the explicitly selected driver and preserves the observed control result", () => {
    const requests: string[] = [];
    const observed = {
      ok: true,
      ready: true,
      tapPoint: "50%,71.91%",
      sequence: 7,
    };
    const output = { whimwayPlanViewport: null as unknown };
    bridge.runInNewContext({
      IOS_DRIVER_PORT: 7004,
      TARGET_TEXT: "Adjust plan",
      output,
      http: {
        get: (url: string) => {
          requests.push(url);
          return { ok: true, status: 200, body: JSON.stringify(observed) };
        },
      },
    });
    const request = new URL(requests[0]);
    expect(request.origin).toBe("http://127.0.0.1:8766");
    expect(request.pathname).toBe("/plan-viewport");
    expect(Object.fromEntries(request.searchParams)).toEqual({
      driverPort: "7004",
      targetText: "Adjust plan",
      targetKind: "control",
    });
    expect(output.whimwayPlanViewport).toEqual(observed);
  });

  it.each([
    { ok: false, status: 503, body: "{}" },
    { ok: true, status: 200, body: "invalid JSON" },
    { ok: true, status: 200, body: '{"ready":true}' },
  ])("fails closed and clears a stale ready/tap result for %j", (response) => {
    const output = {
      whimwayPlanViewport: { ready: true, tapPoint: "50%,50%" },
    };
    expect(() =>
      bridge.runInNewContext({
        IOS_DRIVER_PORT: 7002,
        TARGET_TEXT: "Start my day",
        output,
        http: { get: () => response },
      }),
    ).toThrow();
    expect(output.whimwayPlanViewport).toEqual({
      ready: false,
      tapPoint: null,
    });
  });
});
