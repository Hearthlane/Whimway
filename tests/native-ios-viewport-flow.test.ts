import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const bridge = new Script(
  readFileSync(
    new URL("../e2e-native/helpers/observe-ios-plan.js", import.meta.url),
    "utf8",
  ),
);
const swipe = new Script(
  readFileSync(
    new URL("../e2e-native/helpers/swipe-ios-plan.js", import.meta.url),
    "utf8",
  ),
);
const { loadAll } = createRequire(import.meta.url)("js-yaml") as {
  loadAll: (source: string) => unknown[];
};

function observation(ready = true) {
  return {
    ok: true,
    ready,
    fullyVisible: ready,
    driverPort: 7004,
    sequence: 7,
    observedAt: new Date().toISOString(),
    targetKind: "control",
    screenBounds: "[0,0][402,874]",
    clipBounds: { left: 0, top: 472, right: 402, bottom: 840 },
    targetBounds: {
      left: 24,
      top: ready ? 600 : 827,
      right: 378,
      bottom: ready ? 682 : 909,
    },
    tapCenter: { x: 201, y: ready ? 641.3 : 868 },
    tapPoint: ready ? "50%,73.375286%" : null,
    direction: ready ? null : "DOWN",
    swipe: ready ? null : { start: "97%,78%", end: "97%,70%" },
  };
}

function observe(value: unknown) {
  const output = {
    whimwayPlanViewport: null as unknown,
    whimwayPlanValidatedSwipe: null as unknown,
  };
  bridge.runInNewContext({
    IOS_DRIVER_PORT: 7004,
    TARGET_TEXT: "Adjust plan",
    output,
    http: {
      get: () => ({ ok: true, status: 200, body: JSON.stringify(value) }),
    },
  });
  return output;
}

describe("Maestro native viewport observation bridge", () => {
  it("uses the explicitly selected driver and preserves the observed control result", () => {
    const requests: string[] = [];
    const observed = observation();
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
    expect(output.whimwayPlanViewport).toEqual({
      ...observed,
      tapPoint: "201,641",
    });
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

  it.each([
    { driverPort: 7003 },
    { sequence: 0 },
    { observedAt: new Date(Date.now() - 30000).toISOString() },
    { observedAt: "invalid" },
    { screenBounds: "[0,0][NaN,874]" },
    { targetBounds: { left: 24, top: 827, right: 378, bottom: 909 } },
    { tapCenter: { x: 201, y: 472.49 } },
  ])(
    "rejects stale, wrong-port or unsafe rounded-tap observation %j",
    (change) => {
      expect(() => observe({ ...observation(), ...change })).toThrow();
    },
  );

  it("dispatches precisely one real native gesture to the same selected driver and retains its empty200 response", () => {
    const output = observe(observation(false));
    const requests: {
      url: string;
      options: { body: string; headers: unknown };
    }[] = [];
    const logs: string[] = [];
    swipe.runInNewContext({
      IOS_DRIVER_PORT: 7004,
      output,
      http: {
        post: (url: string, options: { body: string; headers: unknown }) => {
          requests.push({ url, options });
          return { ok: true, status: 200, body: "" };
        },
      },
      console: { log: (value: string) => logs.push(value) },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("http://127.0.0.1:7004/swipeV2");
    expect(requests[0].options.headers).toEqual({
      "Content-Type": "application/json",
    });
    expect(JSON.parse(requests[0].options.body)).toEqual({
      startX: 389.94,
      startY: 681.72,
      endX: 389.94,
      endY: 611.8,
      duration: 0.6,
      appIds: ["com.example.whimway"],
    });
    expect(JSON.parse(logs[0])).toMatchObject({
      source: "maestro-xctest-native-swipe",
      sequence: 7,
      response: { ok: true, status: 200, body: "", bodyTruncated: false },
    });
    expect(output.whimwayPlanValidatedSwipe).toBeNull();
  });

  it.each([400, 408, 500])(
    "fails a native HTTP%s without replaying a possibly executed gesture",
    (status) => {
      const output = observe(observation(false));
      let calls = 0;
      const context = {
        IOS_DRIVER_PORT: 7004,
        output,
        http: {
          post: () => {
            calls++;
            return { ok: false, status, body: "native failure" };
          },
        },
        console: { log: () => {} },
      };
      expect(() => swipe.runInNewContext(context)).toThrow(
        "Native swipe failed",
      );
      expect(() => swipe.runInNewContext(context)).toThrow();
      expect(calls).toBe(1);
    },
  );

  it("consumes a native gesture proof even when the transport throws, preventing a retry after an unknown outcome", () => {
    const output = observe(observation(false));
    let calls = 0;
    const context = {
      IOS_DRIVER_PORT: 7004,
      output,
      http: {
        post: () => {
          calls++;
          throw new Error("request timed out");
        },
      },
    };
    expect(() => swipe.runInNewContext(context)).toThrow("request timed out");
    expect(() => swipe.runInNewContext(context)).toThrow();
    expect(calls).toBe(1);
    expect(output.whimwayPlanValidatedSwipe).toBeNull();
  });

  it.each(["stale", "port", "clip", "direction"])(
    "rejects %s gesture proof before a native request",
    (invalid) => {
      const output = observe(observation(false)) as {
        whimwayPlanViewport: ReturnType<typeof observation>;
        whimwayPlanValidatedSwipe: {
          observedAt: string;
          driverPort: number;
          payload: { startY: number };
        };
      };
      if (invalid === "stale")
        output.whimwayPlanValidatedSwipe.observedAt = new Date(
          Date.now() - 30000,
        ).toISOString();
      if (invalid === "port")
        output.whimwayPlanValidatedSwipe.driverPort = 7003;
      if (invalid === "clip")
        output.whimwayPlanValidatedSwipe.payload.startY = 850;
      if (invalid === "direction") output.whimwayPlanViewport.direction = "UP";
      let calls = 0;
      expect(() =>
        swipe.runInNewContext({
          IOS_DRIVER_PORT: 7004,
          output,
          http: {
            post: () => {
              calls++;
            },
          },
          console: { log: () => {} },
        }),
      ).toThrow();
      expect(calls).toBe(0);
    },
  );

  it("keeps a maximum20 live-observed gestures and strict final readiness while avoiding eagerly parsed dynamic YAML swipe fields", () => {
    const flow = loadAll(
      readFileSync(
        new URL("../e2e-native/helpers/scroll-ios-plan.yaml", import.meta.url),
        "utf8",
      ),
    )[1] as {
      repeat?: {
        times: number;
        while: unknown;
        commands: Record<string, unknown>[];
      };
      assertTrue?: string;
    }[];
    const loop = flow.find((x) => x.repeat)!.repeat!;
    expect(loop.times).toBe(20);
    expect(loop.while).toEqual({
      true: "${!output.whimwayPlanViewport.ready}",
    });
    expect(loop.commands.map((x) => x.runScript).filter(Boolean)).toEqual([
      "swipe-ios-plan.js",
      "observe-ios-plan.js",
    ]);
    expect(loop.commands.some((x) => x.swipe)).toBe(false);
    expect(flow.at(-1)).toEqual({
      assertTrue: "${output.whimwayPlanViewport.ready === true}",
    });
  });
});
