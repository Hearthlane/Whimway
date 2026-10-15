import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import observations from "./fixtures/ios-38664294144-viewport.json";

type Command = Record<string, unknown>;
const require = createRequire(import.meta.url);
const { loadAll } = require("js-yaml") as {
  loadAll: (source: string) => unknown[];
};
function read(relative: string) {
  return readFileSync(
    fileURLToPath(new URL("../" + relative, import.meta.url)),
    "utf8",
  );
}
function commands(relative: string) {
  return loadAll(read(relative))[1] as Command[];
}
function branch(flow: Command[], platform: string): Command[] {
  const found = flow.find((entry) => {
    const nested = entry.runFlow as { when?: { platform?: string } };
    return nested?.when?.platform === platform;
  })?.runFlow as { commands: Command[] } | undefined;
  if (!found) throw new Error("Missing platform-specific harness branch.");
  return found.commands;
}
function bounds(value: string) {
  const values = value.match(/\d+/g)?.map(Number);
  if (!values || values.length !== 4)
    throw new Error("Invalid retained bounds.");
  const [left, top, right, bottom] = values;
  return { left, top, right, bottom };
}
function inside(
  point: { x: number; y: number },
  box: ReturnType<typeof bounds>,
) {
  return (
    point.x >= box.left &&
    point.x <= box.right &&
    point.y >= box.top &&
    point.y <= box.bottom
  );
}

describe("iOS native harness readiness and retained viewport regression", () => {
  it("gates the native probe on actual cold-start UI readiness before the fresh main journey, retaining either failure", () => {
    const workflow = read(".github/workflows/native.yml");
    const gate = workflow.indexOf(
      "if maestro test --test-output-dir native-results/ios-ready",
    );
    const probe = workflow.indexOf(
      "node scripts/check-ios-simulator-keychain.mjs",
    );
    const journey = workflow.indexOf(
      "maestro test --test-output-dir native-results/ios -e",
    );
    expect(gate).toBeGreaterThan(0);
    expect(probe).toBeGreaterThan(gate);
    expect(journey).toBeGreaterThan(probe);
    expect(workflow.slice(gate, journey)).toContain(
      '"stage":"ui-readiness","reason":"app-not-ready"',
    );
    expect(workflow.slice(gate, journey)).toContain(
      "else\n            result=1".replaceAll(
        "\n",
        workflow.includes("\r\n") ? "\r\n" : "\n",
      ),
    );
    expect(workflow.slice(probe, journey)).toContain(
      "ios-keychain-diagnostics.json || result=1",
    );
    expect(commands("e2e-native/ios-ready.yaml")).toContainEqual({
      runFlow: "helpers/boot.yaml",
    });
    expect(commands("e2e-native/smoke.yaml")[0]).toEqual({
      runFlow: "helpers/boot.yaml",
    });
  });
  it("bounds only iOS heading readiness beyond the observed 132890ms cold bundle and preserves Android/error checks", () => {
    const boot = commands("e2e-native/helpers/boot.yaml");
    const heading = (platform: string) =>
      boot
        .flatMap((entry) => {
          const nested = entry.runFlow as {
            when?: { platform?: string };
            commands?: Command[];
          };
          return nested?.when?.platform === platform
            ? (nested.commands ?? [])
            : [];
        })
        .find(
          (entry) =>
            (entry.extendedWaitUntil as { visible?: string })?.visible ===
            "Where are we heading[?]",
        )?.extendedWaitUntil;
    expect(heading("iOS")).toEqual({
      visible: "Where are we heading[?]",
      timeout: 300000,
    });
    expect(heading("Android")).toEqual({
      visible: "Where are we heading[?]",
      timeout: 120000,
    });
    expect(boot).toContainEqual({
      assertNotVisible: "(?s).*ERR_NOTIFICATIONS_KEYCHAIN_ACCESS.*",
    });
  });
  it("uses a bounded iOS gutter swipe that avoids the retained large-text action and tab bar", () => {
    const fixture = commands("e2e-native/helpers/create-fixture-plan.yaml");
    const ios = branch(fixture, "iOS");
    const loop = ios.find((entry) => entry.repeat)?.repeat as {
      times: number;
      while: Command;
      commands: Command[];
    };
    expect(loop.times).toBe(12);
    expect(loop.while).toEqual({
      notVisible: "Use synthetic development fixtures",
    });
    expect(ios.at(-1)).toEqual({
      assertVisible: "Use synthetic development fixtures",
    });
    expect(branch(fixture, "Android")).toEqual([
      {
        scrollUntilVisible: {
          element: "Use synthetic development fixtures",
          direction: "DOWN",
        },
      },
    ]);
    const swipe = loop.commands[0].swipe as { start: string; end: string };
    const nodes = observations.largeText.nodes;
    const viewport = bounds(
      nodes.find((node) => node.accessibilityText === "Whimway")!.bounds,
    );
    const action = bounds(
      nodes.find(
        (node) => node.accessibilityText === "Let’s find something good",
      )!.bounds,
    );
    const tab = bounds(
      nodes.find((node) => node.accessibilityText === "Explore, tab, 1 of 3")!
        .bounds,
    );
    const point = (value: string) => {
      const [x, y] = value.split(",").map((item) => parseFloat(item) / 100);
      return { x: viewport.right * x, y: viewport.bottom * y };
    };
    expect(inside(point("50%, 50%"), action)).toBe(true);
    for (const value of [swipe.start, swipe.end]) {
      const p = point(value);
      expect(inside(p, viewport)).toBe(true);
      expect(inside(p, action)).toBe(false);
      expect(p.y).toBeLessThan(tab.top);
      expect(p.x).toBeGreaterThan(action.right);
    }
  });
  it("centers the field and requires real focus before typing instead of accepting the retained clipped/unfocused node", () => {
    const field = observations.reminders.nodes.find(
      (node) => node.accessibilityText === "Search a place",
    )!;
    const viewport = bounds(
      observations.reminders.nodes.find(
        (node) => node.accessibilityText === "Whimway",
      )!.bounds,
    );
    const box = bounds(field.bounds);
    expect((box.top + box.bottom) / 2).toBe(61);
    expect((box.top + box.bottom) / 2).toBeLessThan(viewport.bottom * 0.1);
    expect(field.focused).toBe("false");
    expect(
      observations.reminders.nodes.find(
        (node) =>
          node.accessibilityText === "Use synthetic development fixtures",
      )?.checked,
    ).toBe("true");
    const fixture = commands("e2e-native/helpers/create-fixture-plan.yaml");
    const tap = fixture.findIndex((entry) => entry.tapOn === "Search a place");
    const typing = fixture.findIndex((entry) => entry.inputText === "Toronto");
    const center = fixture.slice(0, tap).flatMap((entry) => {
      const nested = entry.runFlow as {
        when?: { platform?: string };
        commands?: Command[];
      };
      return nested?.when?.platform === "iOS" ? (nested.commands ?? []) : [];
    });
    expect(center).toContainEqual({
      scrollUntilVisible: {
        element: "Search a place",
        direction: "UP",
        centerElement: true,
        timeout: 30000,
      },
    });
    expect(branch(fixture.slice(tap + 1, typing), "iOS")).toEqual([
      {
        extendedWaitUntil: {
          visible: { text: "Search a place", focused: true },
          timeout: 10000,
        },
      },
    ]);
    expect(fixture.slice(typing)).toContainEqual({
      extendedWaitUntil: { visible: "CF Toronto Eaton Centre", timeout: 15000 },
    });
  });
});
