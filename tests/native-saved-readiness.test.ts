import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const yaml = createRequire(import.meta.url)("js-yaml") as {
  load: (source: string) => Command[];
};
type Selector = string | { id: string };
type Command = {
  tapOn?: string;
  extendedWaitUntil?: { visible: Selector; timeout: number };
  assertVisible?: Selector;
  assertNotVisible?: Selector;
  runFlow?: {
    when: { platform: string };
    commands: {
      tapOn?: string;
      scrollUntilVisible?: { element: string; direction: string };
      runFlow?: { file: string; env: Record<string, string> };
    }[];
  };
};
const source = readFileSync(
  new URL("../e2e-native/smoke.yaml", import.meta.url),
  "utf8",
);
const flow = yaml.load(source.split(/\r?\n---\r?\n/)[1]);
const savedTap = flow.findIndex(
  (command) => command.tapOn === "A day with a little more whim.*",
);
const afterSaved = flow.slice(savedTap + 1);
const firstTapBranch = afterSaved.findIndex((command) => command.runFlow);
const gates = afterSaved.slice(0, firstTapBranch);

type Element = { accessibilityText?: string; id?: string; enabled?: boolean };
// Exact labels/state from original298 iOS run38805051576 artifact12009928737,
// step281 hierarchy SHA2564a376ba938c437aa1d21d92e655bbdbdf3c64ec179247997684d228f76e7b628.
// The busy saved row was [24,368][378,459], Cancel [24,471][378,528].
// No Plan heading, plan-timeline or Start node existed in the retained frame.
const pendingSaved: Element[] = [
  { accessibilityText: "GOOD DAYS, KEPT CLOSE" },
  {
    accessibilityText:
      "A day with a little more whim, 2026-10-16 · 4 stops, Refreshing your saved day…",
    enabled: false,
  },
  { accessibilityText: "Cancel opening", enabled: true },
];
const plan: Element[] = [
  { accessibilityText: "YOUR GOOD DAY" },
  { id: "plan-timeline" },
];
function present(selector: Selector, elements: Element[]) {
  const pattern = typeof selector === "string" ? selector : selector.id;
  const regex = new RegExp(`^(?:${pattern})$`);
  return elements.some((element) =>
    regex.test(
      (typeof selector === "string" ? element.accessibilityText : element.id) ??
        "",
    ),
  );
}
// Evaluate the actual parsed flow's readiness predicates against UI states.
// Waiting time/native visibility remain covered by the retained device run;
// these tests guard which states the harness is permitted to accept as ready.
function accepts(elements: Element[]) {
  return gates.every((command) => {
    if (command.extendedWaitUntil)
      return present(command.extendedWaitUntil.visible, elements);
    if (command.assertVisible) return present(command.assertVisible, elements);
    if (command.assertNotVisible)
      return !present(command.assertNotVisible, elements);
    throw Error("Unexpected saved readiness command.");
  });
}

describe("native Saved reopening readiness", () => {
  it("waits for the real Plan destination within the existing request deadline plus a ten-second UI margin", () => {
    expect(savedTap).toBeGreaterThan(-1);
    expect(firstTapBranch).toBeGreaterThan(0);
    const waits = gates.filter((command) => command.extendedWaitUntil);
    expect(waits).toHaveLength(1);
    const http = readFileSync(
      new URL("../apps/mobile/src/services/http.ts", import.meta.url),
      "utf8",
    );
    const requestDeadline = Number(
      http.match(/options\.timeoutMs \?\? (\d+)/)?.[1],
    );
    expect(requestDeadline).toBe(105000);
    expect(waits[0].extendedWaitUntil).toEqual({
      visible: "YOUR GOOD DAY",
      timeout: requestDeadline + 10000,
    });
    expect(gates).toContainEqual({ assertVisible: { id: "plan-timeline" } });
    expect(gates).toContainEqual({
      assertNotVisible: ".*Refreshing your saved day.*",
    });
    expect(gates).toContainEqual({ assertNotVisible: "Cancel opening" });
    expect(
      gates.some(
        (command) => command.extendedWaitUntil?.visible === "Start my day",
      ),
    ).toBe(false);
  });

  it("rejects the exact retained busy Saved state throughout hydration instead of treating a completed title tap as navigation", () => {
    expect(accepts(pendingSaved)).toBe(false);
    expect(
      accepts([...pendingSaved, { accessibilityText: "Start my day" }]),
    ).toBe(false);
  });

  it.each([
    [
      "cancelled opening",
      [
        { accessibilityText: "GOOD DAYS, KEPT CLOSE" },
        { accessibilityText: "Open my day" },
      ],
    ],
    [
      "failed hydration",
      [
        { accessibilityText: "GOOD DAYS, KEPT CLOSE" },
        {
          accessibilityText:
            "Could not reach Whimway. Check your connection and try again.",
        },
      ],
    ],
    [
      "heading without a real Plan pane",
      [{ accessibilityText: "YOUR GOOD DAY" }],
    ],
    ["pane without the Plan heading", [{ id: "plan-timeline" }]],
    ["busy opening beside a Plan label", [...plan, ...pendingSaved]],
  ] as const)("keeps %s a failure", (_label, elements) => {
    expect(accepts([...elements])).toBe(false);
  });

  it("accepts a completed Plan destination before any Start visibility assumption, then preserves both real tap paths and restored progress assertion", () => {
    // Start may initially be outside the clipped pane; positioning belongs to
    // the existing platform UI interaction, after navigation is established.
    expect(accepts(plan)).toBe(true);
    const android = afterSaved.find(
      (command) => command.runFlow?.when.platform === "Android",
    )?.runFlow;
    expect(android?.commands).toEqual([
      {
        scrollUntilVisible: {
          element: "Start my day",
          direction: "UP",
          timeout: 20000,
        },
      },
      { tapOn: "Start my day" },
    ]);
    const ios = afterSaved.find(
      (command) => command.runFlow?.when.platform === "iOS",
    )?.runFlow;
    expect(ios?.commands).toEqual([
      {
        runFlow: {
          file: "helpers/tap-ios-plan.yaml",
          env: {
            TARGET_TEXT: "Start my day",
            TAP_SCREENSHOT_NAME: "native-restored-day-start-before-tap",
          },
        },
      },
    ]);
    expect(afterSaved.at(-2)).toEqual({ assertVisible: "1 DONE.*0 SKIPPED" });
    expect(
      afterSaved.filter(
        (command) => command.tapOn === "A day with a little more whim.*",
      ),
    ).toHaveLength(0);
  });
});
