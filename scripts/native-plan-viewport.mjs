// Pure, current-snapshot geometry for the disposable native QA harness. Bounds
// and screen dimensions are iOS POINTS, never screenshot pixels or app state.

/** @typedef {{left:number,top:number,right:number,bottom:number,width:number,height:number}} Rect */
/** @typedef {{attributes?:Record<string,unknown>,children?:HierarchyNode[]}} HierarchyNode */

function fail(code) {
  throw new Error(code);
}

/** @returns {Rect} */
function bounds(value, code, allowZero = false) {
  let edges;
  if (typeof value === "string") {
    const match = value.match(
      /^\[(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\]\[(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\]$/,
    );
    if (match) edges = match.slice(1).map(Number);
  } else if (value && typeof value === "object" && !Array.isArray(value)) {
    edges = [value.left, value.top, value.right, value.bottom];
  }
  if (
    !edges ||
    !edges.every((edge) => typeof edge === "number" && Number.isFinite(edge))
  )
    fail(code);
  const [left, top, right, bottom] = edges;
  const width = right - left,
    height = bottom - top;
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 0 ||
    height < 0 ||
    (!allowZero && (!width || !height))
  )
    fail(code);
  return { left, top, right, bottom, width, height };
}

function contains(outer, inner) {
  return (
    inner.left >= outer.left &&
    inner.right <= outer.right &&
    inner.top >= outer.top &&
    inner.bottom <= outer.bottom
  );
}

function inside(rect, point) {
  return (
    point.x > rect.left &&
    point.x < rect.right &&
    point.y > rect.top &&
    point.y < rect.bottom
  );
}

/**
 * @param {{hierarchy:unknown,targetText:string,screenBounds:unknown,targetKind?:'control'|'readOnly'}} input
 */
export function analyzePlanViewport({
  hierarchy,
  targetText,
  screenBounds,
  targetKind = "control",
}) {
  if (targetKind !== "control" && targetKind !== "readOnly")
    fail("invalid-plan-target-kind");
  if (typeof targetText !== "string" || !targetText || targetText.length > 500)
    fail("invalid-plan-target-pattern");
  let pattern;
  try {
    pattern = new RegExp(targetText);
  } catch {
    fail("invalid-plan-target-pattern");
  }
  if (pattern.test("")) fail("invalid-plan-target-pattern");
  const screen = bounds(screenBounds, "invalid-plan-screen-bounds");
  const panes = [];
  const entries = [];
  const seen = new Set();
  const queue = [{ node: hierarchy, ancestors: [] }];
  while (queue.length) {
    const entry = queue.pop();
    const { node, ancestors } = entry;
    if (
      !node ||
      typeof node !== "object" ||
      Array.isArray(node) ||
      seen.has(node) ||
      ancestors.length > 256 ||
      seen.size >= 25000
    )
      fail("invalid-plan-hierarchy");
    seen.add(node);
    const attributes = node.attributes ?? {};
    if (
      !attributes ||
      typeof attributes !== "object" ||
      Array.isArray(attributes) ||
      (node.children !== undefined && !Array.isArray(node.children))
    )
      fail("invalid-plan-hierarchy");
    entries.push(entry);
    if (attributes["resource-id"] === "plan-timeline") panes.push(entry);
    for (const child of [...(node.children ?? [])].reverse())
      queue.push({ node: child, ancestors: [...ancestors, node] });
  }
  if (!panes.length) fail("plan-viewport-not-found");
  if (panes.length !== 1) fail("ambiguous-plan-viewport");
  const pane = panes[0];
  const paneBounds = bounds(
    pane.node.attributes?.bounds,
    "invalid-plan-viewport-bounds",
  );
  if ([false, "false"].includes(pane.node.attributes?.enabled))
    fail("plan-viewport-disabled");
  let clipBounds = screen;
  // A synthetic XCTest root may be zero-sized. Positive ancestor frames up to
  // the pane constrain its viewport; ordinary content frames BELOW the pane do
  // not: those legitimately move outside it when a user scrolls.
  for (const ancestor of [...pane.ancestors, pane.node]) {
    if (ancestor.attributes?.bounds === undefined) continue;
    const frame = bounds(
      ancestor.attributes.bounds,
      "invalid-plan-ancestor-bounds",
      true,
    );
    if (!frame.width || !frame.height) continue;
    clipBounds = bounds(
      {
        left: Math.max(clipBounds.left, frame.left),
        top: Math.max(clipBounds.top, frame.top),
        right: Math.min(clipBounds.right, frame.right),
        bottom: Math.min(clipBounds.bottom, frame.bottom),
      },
      "empty-plan-viewport",
    );
  }
  const matches = entries.filter(
    ({ node, ancestors }) =>
      ancestors.includes(pane.node) &&
      [
        node.attributes?.accessibilityText,
        node.attributes?.text,
        node.attributes?.title,
      ].some((text) => typeof text === "string" && pattern.test(text)),
  );
  if (!matches.length) fail("plan-target-not-found");
  const target = matches[0];
  const targetBounds = bounds(
    target.node.attributes?.bounds,
    "invalid-plan-target-bounds",
  );
  let previous = target;
  let previousBounds = targetBounds;
  for (const candidate of matches.slice(1)) {
    // AX often exposes an outer control plus its same-text child. Only one
    // contained ancestry chain describes one control; siblings stay ambiguous.
    const candidateBounds = bounds(
      candidate.node.attributes?.bounds,
      "invalid-plan-target-bounds",
    );
    if (
      !candidate.ancestors.includes(previous.node) ||
      !contains(previousBounds, candidateBounds)
    )
      fail("ambiguous-plan-target");
    previous = candidate;
    previousBounds = candidateBounds;
  }
  if ([false, "false"].includes(target.node.attributes?.enabled))
    fail("plan-target-disabled");
  if (
    targetBounds.left < clipBounds.left ||
    targetBounds.right > clipBounds.right
  )
    fail("plan-target-clipped-horizontally");
  const oversized = targetBounds.height > clipBounds.height;
  if (oversized && targetKind === "control")
    fail("plan-target-larger-than-viewport");
  const tapCenter = {
    x: targetBounds.left + targetBounds.width / 2,
    y: targetBounds.top + targetBounds.height / 2,
  };
  if (
    !Number.isFinite(tapCenter.x) ||
    !Number.isFinite(tapCenter.y) ||
    !inside(targetBounds, tapCenter)
  )
    fail("invalid-plan-target-center");
  const fullyVisible =
    contains(clipBounds, targetBounds) && inside(clipBounds, tapCenter);
  const ready =
    fullyVisible ||
    (targetKind === "readOnly" && oversized && inside(clipBounds, tapCenter));
  const percent = (point) =>
    `${Number((((point.x - screen.left) / screen.width) * 100).toFixed(6))}%,${Number((((point.y - screen.top) / screen.height) * 100).toFixed(6))}%`;
  const direction = ready
    ? null
    : (
          oversized
            ? tapCenter.y <= clipBounds.top
            : targetBounds.top < clipBounds.top
        )
      ? "UP"
      : "DOWN";
  let swipe = null;
  if (!ready) {
    // Keep a >=2px margin after percentage rounding. Both ends and the gutter
    // derive from the CURRENT clipped pane, including a changing header/notice.
    if (clipBounds.width <= 6 || clipBounds.height <= 6)
      fail("plan-viewport-too-small-to-scroll");
    const x =
      clipBounds.right - Math.max(3, Math.min(12, clipBounds.width * 0.04));
    const center = clipBounds.top + clipBounds.height / 2;
    const distance = Math.abs(tapCenter.y - center);
    const travel = oversized
      ? Math.min(clipBounds.height * 0.2, distance * 0.5)
      : Math.min(
          clipBounds.height * 0.3,
          (clipBounds.height - targetBounds.height) * 0.4,
          distance * 0.5,
        );
    // A nearly reached target needs less travel than a distant one. Keep the
    // step within its full-fit interval to reduce overshoot; oversized read-only
    // disclosures use a separate centering budget. Never inflate an unsafe
    // budget to meet the eight-point minimum gesture: fail closed instead.
    if (!Number.isFinite(travel) || travel < 8)
      fail("plan-viewport-too-small-to-scroll");
    const upper = center - travel / 2;
    const lower = center + travel / 2;
    const start = { x, y: direction === "DOWN" ? lower : upper };
    const end = { x, y: direction === "DOWN" ? upper : lower };
    if (
      !inside(clipBounds, start) ||
      !inside(clipBounds, end) ||
      upper >= lower
    )
      fail("invalid-plan-swipe");
    swipe = { start: percent(start), end: percent(end) };
  }
  const tapPoint =
    ready && targetKind === "control" ? percent(tapCenter) : null;
  if (tapPoint) {
    const values = tapPoint
      .split(",")
      .map((value) => Number(value.slice(0, -1)));
    const emitted = {
      x: screen.left + (values[0] / 100) * screen.width,
      y: screen.top + (values[1] / 100) * screen.height,
    };
    if (!inside(targetBounds, emitted) || !inside(clipBounds, emitted))
      fail("invalid-plan-tap-point");
  }
  return {
    ready,
    fullyVisible,
    targetKind,
    targetBounds,
    paneBounds,
    clipBounds,
    tapCenter,
    tapPoint,
    direction,
    swipe,
  };
}
