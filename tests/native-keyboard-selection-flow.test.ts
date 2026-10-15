import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

type Command = Record<string, unknown>;
const { loadAll } = createRequire(import.meta.url)("js-yaml") as {
  loadAll: (source: string) => unknown[];
};
const commands = loadAll(
  readFileSync(
    new URL("../e2e-native/helpers/create-fixture-plan.yaml", import.meta.url),
    "utf8",
  ),
)[1] as Command[];
const place = "CF Toronto Eaton Centre";
const done = "Done editing, dismiss keyboard";
const firstResult = commands.findIndex(
  (command) =>
    (command.extendedWaitUntil as Command | undefined)?.visible === place,
);
const interests = commands.findIndex(
  (command, index) =>
    index > firstResult && command.assertVisible === "What sounds fun[?]",
);
const selection = commands.slice(firstResult, interests + 1);

// A model of the retained keyboard-covered hit, not an emulator/device test.
// Execute the actual YAML ordering, including its selection assertions, so a
// lost tap or failed location resolution cannot silently advance the planner.
function exercise(flow: Command[], { resolves = true, dismisses = true } = {}) {
  let keyboard = true;
  let selected = false;
  let question = "explore";
  const taps: string[] = [];
  function visible(matcher: unknown): boolean {
    if (typeof matcher === "object" && matcher !== null)
      return (matcher as Command).id === "^delete$" && keyboard;
    if (matcher === done) return keyboard;
    if (matcher === "^Toronto$") return !selected;
    if (matcher === place) return question === "explore";
    if (matcher === "What sounds fun[?]") return question === "interests";
    return false;
  }
  function execute(list: Command[]) {
    for (const command of list) {
      if (command.runFlow) {
        const nested = command.runFlow as {
          when: { platform?: string; visible?: unknown };
          commands: Command[];
        };
        if (
          (!nested.when.platform || nested.when.platform === "iOS") &&
          (!nested.when.visible || visible(nested.when.visible))
        )
          execute(nested.commands);
      } else if (command.extendedWaitUntil) {
        const condition = command.extendedWaitUntil as Command;
        const passed = condition.visible
          ? visible(condition.visible)
          : !visible(condition.notVisible);
        if (!passed) throw Error("Readiness condition did not complete.");
      } else if (command.assertVisible) {
        if (!visible(command.assertVisible)) throw Error("Expected UI absent.");
      } else if (command.assertNotVisible) {
        if (visible(command.assertNotVisible)) throw Error("Unexpected UI.");
      } else if (command.tapOn) {
        const target = command.tapOn as string;
        taps.push(target);
        if (target === done && dismisses) keyboard = false;
        if (target === place && !keyboard && resolves) selected = true;
        if (target === ".*find something good")
          question = selected ? "interests" : "location";
      }
    }
  }
  execute(flow);
  return { selected, question, taps };
}

describe("native place selection around the software keyboard", () => {
  it("reproduces the retained covered result hit before keyboard dismissal", () => {
    // Native artifact12009928737: result[24,485][378,648], center201,566;
    // keyboard starts at539 below its Done accessory[260,473][386,539].
    expect((485 + 648) / 2).toBeGreaterThan(539);
    expect(() =>
      exercise([
        { tapOn: place },
        { tapOn: done },
        { tapOn: ".*find something good" },
        { assertVisible: "What sounds fun[?]" },
      ]),
    ).toThrow("Expected UI absent");
  });

  it("dismisses the actual keyboard before selection and proves acceptance before the planner", () => {
    expect(firstResult).toBeGreaterThan(-1);
    expect(interests).toBeGreaterThan(firstResult);
    expect(exercise(selection)).toEqual({
      selected: true,
      question: "interests",
      taps: [done, place, ".*find something good"],
    });
    const tap = selection.findIndex((command) => command.tapOn === place);
    expect(selection.slice(0, tap)).toContainEqual({
      scrollUntilVisible: {
        element: place,
        direction: "DOWN",
        timeout: 15000,
      },
    });
    expect(selection.slice(tap + 1)).toContainEqual({ assertVisible: place });
  });

  it("fails before entering planning if keyboard dismissal has not completed", () => {
    expect(() => exercise(selection, { dismisses: false })).toThrow(
      "Readiness condition did not complete",
    );
  });

  it("does not accept a still-visible result as proof of a resolved selection", () => {
    expect(() => exercise(selection, { resolves: false })).toThrow(
      "Readiness condition did not complete",
    );
  });
});
