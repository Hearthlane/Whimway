import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { analyzePlanViewport } from "../scripts/native-plan-viewport.mjs";

type Node = { attributes?: Record<string, unknown>; children?: Node[] };
type Input = Parameters<typeof analyzePlanViewport>[0];
type Fixture = Input & { hierarchy: Node };
const directory = fileURLToPath(
  new URL("./fixtures/ios-plan-viewport-38750438975/", import.meta.url),
);
const retained = (name: string): Fixture =>
  JSON.parse(readFileSync(path.join(directory, name + ".json"), "utf8"));
const node = (
  bounds: unknown,
  attributes: Record<string, unknown> = {},
  children?: Node[],
): Node => ({
  attributes: { bounds, enabled: "true", ...attributes },
  ...(children ? { children } : {}),
});
function sample(
  target: unknown = "[24,500][378,556]",
  pane: unknown = "[0,472][402,840]",
): Fixture {
  return {
    hierarchy: node("[0,0][0,0]", {}, [
      node("[0,0][402,874]", {}, [
        node(pane, { "resource-id": "plan-timeline" }, [
          node(target, { accessibilityText: "Start my day" }),
        ]),
      ]),
    ]),
    targetText: "^Start my day$",
    screenBounds: "[0,0][402,874]",
  };
}
function visit(tree: Node, work: (node: Node) => void) {
  work(tree);
  tree.children?.forEach((child) => visit(child, work));
}
function moveTarget(input: Fixture, bounds: unknown): Fixture {
  const changed = structuredClone(input);
  const pattern = new RegExp(changed.targetText);
  visit(changed.hierarchy, (item) => {
    if (pattern.test(String(item.attributes?.accessibilityText ?? "")))
      item.attributes!.bounds = bounds;
  });
  return changed;
}
const decode = (
  point: string,
  screen = { left: 0, top: 0, width: 402, height: 874 },
) => {
  const [x, y] = point.split(",").map((part) => Number(part.slice(0, -1)));
  return {
    x: screen.left + (x / 100) * screen.width,
    y: screen.top + (y / 100) * screen.height,
  };
};
function expectSafeSwipe(result: ReturnType<typeof analyzePlanViewport>) {
  expect(result.ready).toBe(false);
  expect(result.tapPoint).toBeNull();
  expect(result.swipe).not.toBeNull();
  const start = decode(result.swipe!.start),
    end = decode(result.swipe!.end);
  for (const point of [start, end]) {
    expect(point.x).toBeGreaterThanOrEqual(result.clipBounds.left + 2);
    expect(point.x).toBeLessThanOrEqual(result.clipBounds.right - 2);
    expect(point.y).toBeGreaterThanOrEqual(result.clipBounds.top + 2);
    expect(point.y).toBeLessThanOrEqual(result.clipBounds.bottom - 2);
  }
  expect(result.direction === "UP" ? end.y > start.y : end.y < start.y).toBe(
    true,
  );
}

describe("Current native Plan viewport geometry", () => {
  it.each([
    [
      "main-start",
      "3226212a7a7938083d43446df04b9b1776789d605b35df2a73ac70db230fa7ba",
    ],
    [
      "large-adjust",
      "3c208d46f15bd4adef6fd736ec369698155e2cd07e6b92e378de42ed0269977b",
    ],
    [
      "large-disclosure",
      "2bba1b32ad99f5504b0825d6414cd0cdbfd70b2f6e37058fba7381b40c43f1e7",
    ],
  ])(
    "retains the extracted %s hierarchy bytes and full-source provenance",
    (name, expectedHash) => {
      const raw = readFileSync(path.join(directory, name + ".json"));
      expect(createHash("sha256").update(raw).digest("hex")).toBe(expectedHash);
      const provenance = JSON.parse(
        readFileSync(path.join(directory, "provenance.json"), "utf8"),
      );
      expect(provenance).toMatchObject({
        run: "38750438975",
        artifact: "11987126144",
        sourceRevision: "e1db62b",
      });
      expect(
        provenance.files.find(
          (item: { fixture: string }) => item.fixture === name + ".json",
        ),
      ).toMatchObject({
        sha256: expectedHash,
        sourceSha256: expect.stringMatching(/^[a-f\d]{64}$/),
      });
    },
  );

  it("rejects the actual main Start tap at201,31 above its280–839 clipped pane", () => {
    const result = analyzePlanViewport(retained("main-start"));
    expect(result).toMatchObject({
      ready: false,
      fullyVisible: false,
      direction: "UP",
      tapCenter: { x: 201, y: 31 },
      targetBounds: { left: 24, top: 3, right: 378, bottom: 59 },
      clipBounds: { top: 280, bottom: 839 },
    });
    expectSafeSwipe(result);
  });
  it("rejects the actual largest Adjust extending below the472–840 pane", () => {
    const result = analyzePlanViewport(retained("large-adjust"));
    expect(result).toMatchObject({
      ready: false,
      fullyVisible: false,
      direction: "DOWN",
      targetBounds: { top: 827, bottom: 909 },
      clipBounds: { top: 472, bottom: 840 },
      tapCenter: { x: 201, y: 868 },
    });
    expectSafeSwipe(result);
  });
  it.each(["main-start", "large-adjust"])(
    "accepts an inset current control in the retained %s ancestor chain",
    (name) => {
      const result = analyzePlanViewport(
        moveTarget(retained(name), "[24,500][378,556]"),
      );
      expect(result).toMatchObject({
        ready: true,
        fullyVisible: true,
        direction: null,
        swipe: null,
        tapCenter: { x: 201, y: 528 },
      });
      const point = decode(result.tapPoint!);
      expect(point.x).toBeCloseTo(201, 5);
      expect(point.y).toBeCloseTo(528, 5);
    },
  );
  it("reverses a DOWN scroll after overshoot instead of reusing a stale direction", () => {
    const original = retained("large-adjust");
    expect(analyzePlanViewport(original).direction).toBe("DOWN");
    const overshot = analyzePlanViewport(
      moveTarget(original, "[24,420][378,502]"),
    );
    expect(overshot.direction).toBe("UP");
    expectSafeSwipe(overshot);
    expect(
      analyzePlanViewport(moveTarget(original, "[24,500][378,582]")).ready,
    ).toBe(true);
    expect(analyzePlanViewport(original).direction).toBe("DOWN");
  });
  it.each([
    ["UP", "[24,471][378,654]", "[24,0][378,183]"],
    ["DOWN", "[24,658][378,841]", "[24,1000][378,1183]"],
  ])(
    "damps a near-%s183pt control more than a distant one, centered within its current pane",
    (direction, nearBounds, farBounds) => {
      const near = analyzePlanViewport(sample(nearBounds));
      const far = analyzePlanViewport(sample(farBounds));
      expect(near.direction).toBe(direction);
      expect(far.direction).toBe(direction);
      expectSafeSwipe(near);
      expectSafeSwipe(far);
      const travel = (result: typeof near) =>
        Math.abs(decode(result.swipe!.end).y - decode(result.swipe!.start).y);
      expect(travel(near)).toBeLessThan(travel(far));
      expect(travel(near)).toBeCloseTo(46.75, 4);
      expect(travel(far)).toBeCloseTo(74, 4);
      for (const result of [near, far]) {
        const start = decode(result.swipe!.start),
          end = decode(result.swipe!.end);
        expect((start.y + end.y) / 2).toBeCloseTo(656, 4);
        expect(travel(result)).toBeLessThanOrEqual((368 - 183) * 0.4 + 0.00002);
      }
    },
  );
  it("uses a separate positive centering budget for an oversized read-only disclosure", () => {
    const result = analyzePlanViewport(retained("large-disclosure"));
    expectSafeSwipe(result);
    const start = decode(result.swipe!.start),
      end = decode(result.swipe!.end);
    expect(Math.abs(end.y - start.y)).toBeCloseTo(368 * 0.2, 4);
    expect((start.y + end.y) / 2).toBeCloseTo(656, 4);
    expect(result.tapPoint).toBeNull();
  });
  it.each([
    ["[24,460][378,470]", "[0,472][402,492]"],
    ["[24,471][378,836]", "[0,472][402,840]"],
    ["[24,471][378,839]", "[0,472][402,840]"],
  ])(
    "fails closed instead of emitting zero or oversized minimum travel for %s",
    (target, pane) => {
      expect(() => analyzePlanViewport(sample(target, pane))).toThrow(
        "plan-viewport-too-small-to-scroll",
      );
    },
  );
  it.each([
    ["[24,450][378,532]", "UP"],
    ["[24,780][378,862]", "DOWN"],
  ])(
    "requires both edges even when the center is inside: %s",
    (target, direction) => {
      const result = analyzePlanViewport(sample(target));
      expect(result.tapCenter.y).toBeGreaterThan(472);
      expect(result.tapCenter.y).toBeLessThan(840);
      expect(result.direction).toBe(direction);
      expectSafeSwipe(result);
    },
  );
  it.each(["[-1,500][300,556]", "[24,500][403,556]"])(
    "fails closed on horizontal clipping despite an inset center: %s",
    (target) => {
      expect(() => analyzePlanViewport(sample(target))).toThrow(
        "plan-target-clipped-horizontally",
      );
    },
  );
  it("intersects positive pane ancestors and the screen, while ignoring zero synthetic wrappers", () => {
    const input = sample("[24,760][378,830]", "[0,150][402,900]");
    input.hierarchy.children![0].attributes!.bounds = "[10,200][392,820]";
    const result = analyzePlanViewport(input);
    expect(result.clipBounds).toEqual({
      left: 10,
      top: 200,
      right: 392,
      bottom: 820,
      width: 382,
      height: 620,
    });
    expectSafeSwipe(result);
    expect(result.direction).toBe("DOWN");
  });
  it("moves its entire gutter swipe with a newly taller header rather than using saved percentages", () => {
    const before = analyzePlanViewport(sample("[24,400][378,456]"));
    const after = analyzePlanViewport(
      sample("[24,650][378,706]", "[0,700][402,840]"),
    );
    expectSafeSwipe(before);
    expectSafeSwipe(after);
    expect(after.swipe).not.toEqual(before.swipe);
    expect(decode(after.swipe!.start).y).toBeGreaterThan(700);
    expect(decode(after.swipe!.end).y).toBeGreaterThan(700);
  });
  it("accepts a whole-pane control only when its center is strictly inside", () => {
    expect(analyzePlanViewport(sample("[0,472][402,840]"))).toMatchObject({
      ready: true,
      fullyVisible: true,
      tapCenter: { x: 201, y: 656 },
    });
  });
  it("collapses one contained ancestor/child label chain to the outer control, not its smaller visible child", () => {
    const input = sample("[24,450][378,532]");
    const target = input.hierarchy.children![0].children![0].children![0];
    target.children = [
      node("[40,480][350,510]", { accessibilityText: "Start my day" }),
    ];
    expect(analyzePlanViewport(input)).toMatchObject({
      ready: false,
      direction: "UP",
      targetBounds: { top: 450, bottom: 532 },
    });
  });
  it("rejects distinct target branches even with identical bounds", () => {
    const input = sample();
    input.hierarchy.children![0].children![0].children!.push(
      node("[24,500][378,556]", { accessibilityText: "Start my day" }),
    );
    expect(() => analyzePlanViewport(input)).toThrow("ambiguous-plan-target");
  });
  it("rejects same-chain label bounds escaping their matched ancestor", () => {
    const input = sample();
    input.hierarchy.children![0].children![0].children![0].children = [
      node("[24,450][378,556]", { accessibilityText: "Start my day" }),
    ];
    expect(() => analyzePlanViewport(input)).toThrow("ambiguous-plan-target");
  });
  it("ignores matching text outside the actual pane and never accepts it instead of a missing descendant", () => {
    const input = sample();
    input.hierarchy.children!.push(
      node("[24,100][378,156]", { accessibilityText: "Start my day" }),
    );
    expect(analyzePlanViewport(input).ready).toBe(true);
    input.hierarchy.children![0].children![0].children = [];
    expect(() => analyzePlanViewport(input)).toThrow("plan-target-not-found");
  });
  it("fails missing or ambiguous panes rather than falling back to screen coordinates", () => {
    const input = sample();
    input.hierarchy.children![0].children![0].attributes!["resource-id"] =
      "other";
    expect(() => analyzePlanViewport(input)).toThrow("plan-viewport-not-found");
    const duplicate = sample();
    duplicate.hierarchy.children!.push(
      node("[0,100][402,800]", { "resource-id": "plan-timeline" }),
    );
    expect(() => analyzePlanViewport(duplicate)).toThrow(
      "ambiguous-plan-viewport",
    );
  });
  it("rejects a control too tall to fit, including the retained385px disclosure if misclassified", () => {
    expect(() =>
      analyzePlanViewport({
        ...retained("large-disclosure"),
        targetKind: "control",
      }),
    ).toThrow("plan-target-larger-than-viewport");
  });
  it("permits only explicit oversized read-only centering and never emits its tap point", () => {
    const original = retained("large-disclosure");
    const offscreen = analyzePlanViewport(original);
    expect(offscreen).toMatchObject({
      ready: false,
      direction: "UP",
      targetBounds: { height: 385 },
      clipBounds: { height: 368 },
      tapPoint: null,
    });
    const centered = analyzePlanViewport(
      moveTarget(original, "[24,460][378,845]"),
    );
    expect(centered).toMatchObject({
      ready: true,
      fullyVisible: false,
      targetKind: "readOnly",
      tapCenter: { x: 201, y: 652.5 },
      tapPoint: null,
      direction: null,
      swipe: null,
    });
    expect(
      analyzePlanViewport({ ...sample(), targetKind: "readOnly" }),
    ).toMatchObject({ ready: true, fullyVisible: true, tapPoint: null });
  });
  it.each([
    ["[24,279.5][378,664.5]", "UP"],
    ["[24,647.5][378,1032.5]", "DOWN"],
  ])(
    "does not accept a read-only center on either clipping edge: %s",
    (target, direction) => {
      const result = analyzePlanViewport(
        moveTarget(retained("large-disclosure"), target),
      );
      expect(result).toMatchObject({ ready: false, direction, tapPoint: null });
      expectSafeSwipe(result);
    },
  );
  it("still requires the full bounds of a read-only label that can fit", () => {
    expect(
      analyzePlanViewport({
        ...sample("[24,450][378,500]"),
        targetKind: "readOnly",
      }),
    ).toMatchObject({
      ready: false,
      direction: "UP",
      fullyVisible: false,
      tapPoint: null,
    });
  });
  it.each([
    undefined,
    "bad",
    "[0,0][0,100]",
    "[50,0][10,100]",
    "[0,100][10,20]",
    { left: 0, top: 0, right: NaN, bottom: 100 },
    { left: 0, top: 0, right: Infinity, bottom: 100 },
    { left: 0, top: 0, right: "100", bottom: 100 },
  ])("fails closed on invalid current target bounds %#", (target) => {
    const input = sample(target);
    if (target === undefined)
      input.hierarchy.children![0].children![0].children![0].attributes!.bounds =
        undefined;
    expect(() => analyzePlanViewport(input)).toThrow(
      "invalid-plan-target-bounds",
    );
  });
  it("rejects invalid screen, pane, ancestor, empty clip, disabled target and disabled pane", () => {
    expect(() =>
      analyzePlanViewport({ ...sample(), screenBounds: "[0,0][0,0]" }),
    ).toThrow("invalid-plan-screen-bounds");
    expect(() =>
      analyzePlanViewport(sample("[24,500][378,556]", "bad")),
    ).toThrow("invalid-plan-viewport-bounds");
    const invalidAncestor = sample();
    invalidAncestor.hierarchy.children![0].attributes!.bounds = "invalid";
    expect(() => analyzePlanViewport(invalidAncestor)).toThrow(
      "invalid-plan-ancestor-bounds",
    );
    expect(() =>
      analyzePlanViewport(sample("[24,900][378,950]", "[0,900][402,1000]")),
    ).toThrow("empty-plan-viewport");
    const disabled = sample();
    disabled.hierarchy.children![0].children![0].children![0].attributes!.enabled =
      "false";
    expect(() => analyzePlanViewport(disabled)).toThrow("plan-target-disabled");
    disabled.hierarchy.children![0].children![0].attributes!.enabled = false;
    expect(() => analyzePlanViewport(disabled)).toThrow(
      "plan-viewport-disabled",
    );
  });
  it.each(["", "(", ".*", "^$"])(
    "rejects empty or unsafe target pattern %s",
    (targetText) => {
      expect(() => analyzePlanViewport({ ...sample(), targetText })).toThrow(
        "invalid-plan-target-pattern",
      );
    },
  );
  it("rejects malformed or cyclic hierarchy and an invalid target kind", () => {
    expect(() =>
      analyzePlanViewport({ ...sample(), hierarchy: { children: "invalid" } }),
    ).toThrow("invalid-plan-hierarchy");
    const cyclic = sample();
    cyclic.hierarchy.children!.push(cyclic.hierarchy);
    expect(() => analyzePlanViewport(cyclic)).toThrow("invalid-plan-hierarchy");
    expect(() =>
      analyzePlanViewport({
        ...sample(),
        targetKind: "tap-anywhere" as "control",
      }),
    ).toThrow("invalid-plan-target-kind");
  });
  it("does not emit a percentage rounded outside a tiny target or unsafe narrow swipe viewport", () => {
    expect(() =>
      analyzePlanViewport(sample("[200.00000001,500][200.00000002,550]")),
    ).toThrow("invalid-plan-tap-point");
    expect(() =>
      analyzePlanViewport(sample("[1,460][3,462]", "[0,472][6,480]")),
    ).toThrow("plan-viewport-too-small-to-scroll");
  });
  it("uses screen-relative percentages with inset screen origins and emits finite JSON only", () => {
    const input = sample("[124,500][478,556]", "[100,472][502,840]");
    input.screenBounds = { left: 100, top: 100, right: 502, bottom: 974 };
    input.hierarchy.children![0].attributes!.bounds = "[100,100][502,974]";
    const result = analyzePlanViewport(input);
    const point = decode(result.tapPoint!, {
      left: 100,
      top: 100,
      width: 402,
      height: 874,
    });
    expect(point.x).toBeCloseTo(301, 5);
    expect(point.y).toBeCloseTo(528, 5);
    expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity|undefined/);
  });
});
