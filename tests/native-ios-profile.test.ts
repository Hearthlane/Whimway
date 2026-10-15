import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import observed from "./fixtures/ios-38670492664-profile.json";

const require = createRequire(import.meta.url);
const { loadAll } = require("js-yaml") as {
  loadAll: (source: string) => unknown[];
};
type Command = Record<string, unknown>;
function bounds(value: string) {
  const [left, top, right, bottom] = value.match(/\d+/g)!.map(Number);
  return { left, top, right, bottom };
}

describe("retained native iOS Profile save reachability", () => {
  it("reproduces the screen-visible Save center outside its real scroll viewport", () => {
    const screen = bounds(observed.screenBounds);
    const viewport = bounds(observed.scrollViewBounds);
    const save = bounds(observed.saveBounds);
    const budget = bounds(observed.budgetBoundsBeforeErase);
    const saveCenter = (save.top + save.bottom) / 2;
    expect(saveCenter).toBe(834);
    expect(save.bottom).toBeLessThan(screen.bottom);
    expect(save.top).toBeGreaterThan(viewport.bottom);
    expect((budget.top + budget.bottom) / 2).toBeLessThan(viewport.bottom);
    expect(observed.budgetValueAfterErase).toBe("");
  });

  it("centers both real Save taps and retains the invalid and successful save outcomes", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../e2e-native/smoke.yaml", import.meta.url)),
      "utf8",
    );
    const flow = loadAll(source)[1] as Command[];
    const saves = flow.flatMap((command, index) =>
      command.tapOn === "Save my preferences" ? [index] : [],
    );
    expect(saves).toHaveLength(2);
    for (const index of saves) {
      expect(flow[index - 2]).toEqual({
        runFlow: {
          when: { platform: "iOS" },
          commands: [
            {
              scrollUntilVisible: {
                element: "Save my preferences",
                direction: "DOWN",
                centerElement: true,
                timeout: 15000,
              },
            },
          ],
        },
      });
      expect(flow[index - 1].takeScreenshot).toMatch(
        /^native-profile-(empty|valid)-budget-before-save$/,
      );
    }
    expect(flow[saves[0] + 1]).toEqual({
      assertVisible: observed.expectedError,
    });
    expect(flow[saves[0] + 2]).toEqual({
      assertVisible: "Save my preferences",
    });
    expect(flow[saves[1] + 1]).toEqual({
      assertVisible: "Preferences saved on this device.",
    });
  });
});
