import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import observations from "./fixtures/ios-38664294144-viewport.json";
import switchObservations from "./fixtures/ios-38668397703-switch.json";
import searchObservations from "./fixtures/ios-38670492664-search.json";
import visibleSwitch from "./fixtures/ios-38742724011-switch.json";
import { IOS_SCOPES } from "../scripts/run-ios-native-qa.mjs";

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
  it("uses the inset gutter before attempting to enable the actual OFF switch retained near the bottom edge", () => {
    const observed = switchObservations.largeText.attributes;
    expect(observed.checked).toBe("false");
    expect(observed.value).toBe("0");
    const box = bounds(observed.bounds);
    const screen = bounds(switchObservations.screenBounds);
    expect((box.top + box.bottom) / 2).toBe(749);
    expect(box.top).toBeGreaterThan(screen.bottom * 0.7);
    const flow = commands("e2e-native/helpers/create-fixture-plan.yaml");
    const ios = branch(flow, "iOS");
    expect(ios).toContainEqual({
      swipe: {
        start: "96%, 75%",
        end: "96%, 25%",
        duration: 700,
      },
    });
    const conditionalTapIndex = flow.findIndex((entry) => {
      const nested = entry.runFlow as {
        when?: { visible?: { text?: string } };
      };
      return nested?.when?.visible?.text === observed.accessibilityText;
    });
    expect(conditionalTapIndex).toBeGreaterThan(0);
    expect(flow.slice(0, conditionalTapIndex)).toContainEqual({
      runFlow: { when: { platform: "iOS" }, commands: ios },
    });
  });
  it("does not time out centering an already fully visible OFF switch, while preserving the safe gutter and ON gate", () => {
    const box = bounds(visibleSwitch.switch.bounds);
    const viewport = bounds(visibleSwitch.scrollViewBounds);
    const screen = bounds(visibleSwitch.screenBounds);
    expect(box.top).toBeGreaterThan(viewport.top);
    expect(box.bottom).toBeLessThan(viewport.bottom);
    expect(visibleSwitch.switch.checked).toBe("false");
    expect(visibleSwitch.centering.status).toBe("FAILED");
    expect(visibleSwitch.centering.duration).toBeGreaterThanOrEqual(
      visibleSwitch.centering.timeout,
    );
    expect(visibleSwitch.centering.tapReached).toBe(false);
    expect(visibleSwitch.centering.attempts).toHaveLength(5);
    for (const attempt of visibleSwitch.centering.attempts) {
      expect(attempt.bounds).toBe(visibleSwitch.switch.bounds);
      expect(attempt.visibility).toBe(1);
    }
    const ios = branch(
      commands("e2e-native/helpers/create-fixture-plan.yaml"),
      "iOS",
    );
    expect(ios.some((entry) => entry.scrollUntilVisible)).toBe(false);
    const settle = ios.at(-2)?.swipe as {
      start: string;
      end: string;
      duration: number;
    };
    expect(settle).toEqual({
      start: visibleSwitch.discovery.start,
      end: visibleSwitch.discovery.end,
      duration: visibleSwitch.discovery.duration,
    });
    for (const value of [settle.start, settle.end]) {
      const [x, y] = value.split(",").map((item) => parseFloat(item) / 100);
      expect(
        inside({ x: screen.right * x, y: screen.bottom * y }, viewport),
      ).toBe(true);
    }
    expect(ios.at(-1)).toEqual({
      assertVisible: visibleSwitch.switch.accessibilityText,
    });
  });
  it.each([
    [false, true, 1],
    [true, true, 0],
  ])(
    "sets the real fixture switch ON without inverting retained state: checked=%s",
    (initial, tapWorks, expectedTaps) => {
      const label = "Use synthetic development fixtures";
      const flow = commands("e2e-native/helpers/create-fixture-plan.yaml");
      const conditional = flow.find((entry) => {
        const nested = entry.runFlow as {
          when?: { visible?: { text?: string } };
        };
        return nested?.when?.visible?.text === label;
      })?.runFlow as {
        when: { visible: { text: string; checked: boolean } };
        commands: { tapOn: { text: string; checked: boolean } }[];
      };
      expect(conditional.when.visible).toEqual({ text: label, checked: false });
      expect(conditional.commands).toEqual([
        { tapOn: { text: label, checked: false } },
      ]);
      // Apply the parsed flow's selector/tap semantics to both real Switch
      // states. The retained hierarchy already proves ON is a possible input.
      expect(
        observations.reminders.nodes.find(
          (node) => node.accessibilityText === label,
        )?.checked,
      ).toBe("true");
      let checked = initial,
        taps = 0;
      if (checked === conditional.when.visible.checked) {
        for (const command of conditional.commands) {
          if (command.tapOn.checked === checked) {
            taps += 1;
            if (tapWorks) checked = !checked;
          }
        }
      }
      expect(taps).toBe(expectedTaps);
      expect(checked).toBe(true);
      expect(flow).not.toContainEqual({ tapOn: label });
    },
  );
  it("requires checked:true before search and retains a screenshot rather than continuing from unknown or OFF state", () => {
    const flow = commands("e2e-native/helpers/create-fixture-plan.yaml");
    const assertion = flow.findIndex(
      (entry) =>
        (entry.assertVisible as { text?: string })?.text ===
        "Use synthetic development fixtures",
    );
    const search = flow.findIndex((entry) => entry.tapOn === "Search a place");
    expect(assertion).toBeGreaterThan(0);
    expect(assertion).toBeLessThan(search);
    const selector = flow[assertion].assertVisible as {
      text: string;
      checked: boolean;
    };
    expect(selector).toEqual({
      text: "Use synthetic development fixtures",
      checked: true,
    });
    expect(flow[assertion + 1]).toEqual({
      takeScreenshot: "native-fixtures-enabled",
    });
    for (const checked of [undefined, false])
      expect(checked === selector.checked).toBe(false);
  });
  it("wires cold-start readiness and the fresh main journey through the owned runner while retaining both boot gates", () => {
    const workflow = read(".github/workflows/native.yml");
    expect(workflow).toContain("node scripts/run-ios-native-qa.mjs");
    expect(IOS_SCOPES.slice(0, 2)).toEqual([
      {
        name: "ready",
        port: 7001,
        output: "ios-ready",
        flow: "ios-ready.yaml",
      },
      { name: "main", port: 7002, output: "ios", flow: "smoke.yaml" },
    ]);
    // Stateful lifecycle cases exercise success/failure/probe ordering in the
    // extracted runner; these assertions retain the actual YAML boot contract.
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
  it("centers Search in both directions and requires native keyboard UI before typing instead of trusting the contradicted iOS focus flag", () => {
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
    expect(center).toContainEqual({
      scrollUntilVisible: {
        element: "Search a place",
        direction: "DOWN",
        centerElement: true,
        timeout: 15000,
      },
    });
    expect(branch(fixture.slice(tap + 1, typing), "iOS")).toEqual([
      {
        extendedWaitUntil: {
          visible: { id: "^delete$" },
          timeout: 10000,
        },
      },
      { assertVisible: "Done editing, dismiss keyboard" },
    ]);
    expect(branch(fixture.slice(typing), "iOS")).toEqual([
      {
        assertVisible: {
          text: "^Toronto$",
          above: { text: "Done editing, dismiss keyboard" },
        },
      },
      { takeScreenshot: "native-search-query-entered" },
    ]);
    expect(fixture.slice(typing)).toContainEqual({
      extendedWaitUntil: { visible: "CF Toronto Eaton Centre", timeout: 15000 },
    });
  });
  it("distinguishes the actual focused keyboard from a genuinely clipped/missed large-text tap", () => {
    const label = "Search a place";
    const focusedField = searchObservations.reminders.nodes.find(
      (node) => node.accessibilityText === label,
    )!;
    expect(focusedField.focused).toBe("false");
    expect(
      searchObservations.reminders.nodes.some(
        (node) => node["resource-id"] === "delete",
      ),
    ).toBe(true);
    expect(
      searchObservations.reminders.nodes.some(
        (node) => node.accessibilityText === "Done editing, dismiss keyboard",
      ),
    ).toBe(true);
    const focusedBounds = bounds(focusedField.bounds);
    const focusedClip = bounds(searchObservations.reminders.ancestorBounds[0]);
    expect(focusedBounds.bottom).toBeLessThan(focusedClip.bottom);
    const missedField = searchObservations.largeText.nodes.find(
      (node) => node.accessibilityText === label,
    )!;
    const missedBounds = bounds(missedField.bounds);
    const missedClip = bounds(searchObservations.largeText.ancestorBounds[0]);
    expect((missedBounds.top + missedBounds.bottom) / 2).toBeGreaterThan(
      missedClip.bottom,
    );
    expect(
      searchObservations.largeText.nodes.some(
        (node) => node.accessibilityText === "Done editing, dismiss keyboard",
      ),
    ).toBe(false);
    expect(
      searchObservations.largeText.nodes.some(
        (node) => "resource-id" in node && node["resource-id"] === "delete",
      ),
    ).toBe(false);
  });
  it("matches the actual entered native query above the keyboard instead of accepting a prediction or untyped placeholder", () => {
    const label = "Search a place";
    const typed = searchObservations.enteredQuery.nodes.find(
      (node) => node.accessibilityText === label,
    )!;
    const done = searchObservations.enteredQuery.nodes.find(
      (node) => node.accessibilityText === "Done editing, dismiss keyboard",
    )!;
    expect(typed.text).toBe("Toronto");
    expect(typed.value).toBe("Toronto");
    expect(bounds(typed.bounds).bottom).toBeLessThan(bounds(done.bounds).top);
    const untyped = searchObservations.reminders.nodes.find(
      (node) => node.accessibilityText === label,
    )!;
    expect("text" in untyped ? untyped.text : undefined).not.toBe("Toronto");
  });
});
