/* global IOS_DRIVER_PORT, TARGET_KIND, TARGET_TEXT, http, output */
// Maestro's JS runtime has no live bounds binding. The loopback observer reads
// only the SAME explicitly selected XCTest driver's hierarchy/deviceInfo.
output.whimwayPlanViewport = { ready: false, tapPoint: null };
output.whimwayPlanValidatedSwipe = null;
var whimwayDriverPort =
  typeof IOS_DRIVER_PORT === "undefined" ? "" : String(IOS_DRIVER_PORT);
var whimwayTargetKind =
  typeof TARGET_KIND === "undefined" ? "control" : String(TARGET_KIND);
var whimwayObservation = http.get(
  "http://127.0.0.1:8766/plan-viewport?driverPort=" +
    encodeURIComponent(whimwayDriverPort) +
    "&targetText=" +
    encodeURIComponent(String(TARGET_TEXT)) +
    "&targetKind=" +
    encodeURIComponent(whimwayTargetKind),
);
if (!whimwayObservation.ok) {
  throw new Error(
    "Native viewport observation failed: " + whimwayObservation.status,
  );
}
var whimwayViewport = JSON.parse(whimwayObservation.body);
if (whimwayViewport.ok !== true || typeof whimwayViewport.ready !== "boolean") {
  throw new Error("Native viewport observation was invalid");
}
function whimwayRect(value) {
  if (
    !value ||
    ![value.left, value.top, value.right, value.bottom].every(
      function (number) {
        return typeof number === "number" && Number.isFinite(number);
      },
    ) ||
    value.right <= value.left ||
    value.bottom <= value.top
  )
    throw new Error("Native viewport rectangle was invalid");
  return value;
}
function whimwayInside(rect, point) {
  return (
    point.x > rect.left &&
    point.x < rect.right &&
    point.y > rect.top &&
    point.y < rect.bottom
  );
}
var whimwayScreenMatch =
  typeof whimwayViewport.screenBounds === "string" &&
  whimwayViewport.screenBounds.match(/^\[0,0\]\[(\d+),(\d+)\]$/);
var whimwayAge = Date.now() - Date.parse(whimwayViewport.observedAt);
if (
  !/^(7001|7002|7003|7004)$/.test(whimwayDriverPort) ||
  whimwayViewport.driverPort !== Number(whimwayDriverPort) ||
  !Number.isInteger(whimwayViewport.sequence) ||
  whimwayViewport.sequence < 1 ||
  !Number.isFinite(whimwayAge) ||
  whimwayAge < -1000 ||
  whimwayAge > 10000 ||
  !whimwayScreenMatch ||
  whimwayViewport.targetKind !== whimwayTargetKind
)
  throw new Error("Native viewport provenance was invalid or stale");
var whimwayScreen = whimwayRect({
  left: 0,
  top: 0,
  right: Number(whimwayScreenMatch[1]),
  bottom: Number(whimwayScreenMatch[2]),
});
var whimwayClip = whimwayRect(whimwayViewport.clipBounds);
var whimwayTarget = whimwayRect(whimwayViewport.targetBounds);
function whimwayPercentPoint(value) {
  var match =
    typeof value === "string" &&
    value.match(/^(\d+(?:\.\d+)?)%,(\d+(?:\.\d+)?)%$/);
  if (!match) throw new Error("Native swipe point was invalid");
  var point = {
    x: (Number(match[1]) * whimwayScreen.right) / 100,
    y: (Number(match[2]) * whimwayScreen.bottom) / 100,
  };
  if (
    !whimwayInside(whimwayScreen, point) ||
    !whimwayInside(whimwayClip, point)
  )
    throw new Error("Native swipe point left the live viewport");
  return point;
}
if (whimwayViewport.ready) {
  if (whimwayTargetKind === "control") {
    var whimwayCenter = whimwayViewport.tapCenter;
    var whimwayTap = {
      x: Math.round(whimwayCenter && whimwayCenter.x),
      y: Math.round(whimwayCenter && whimwayCenter.y),
    };
    if (
      whimwayViewport.fullyVisible !== true ||
      !Number.isFinite(whimwayCenter && whimwayCenter.x) ||
      !Number.isFinite(whimwayCenter && whimwayCenter.y) ||
      whimwayTarget.left < whimwayClip.left ||
      whimwayTarget.right > whimwayClip.right ||
      whimwayTarget.top < whimwayClip.top ||
      whimwayTarget.bottom > whimwayClip.bottom ||
      !Number.isFinite(whimwayTap.x) ||
      !Number.isFinite(whimwayTap.y) ||
      !whimwayInside(whimwayTarget, whimwayTap) ||
      !whimwayInside(whimwayClip, whimwayTap) ||
      !whimwayInside(whimwayScreen, whimwayTap)
    )
      throw new Error("Native tap point left the live viewport");
    // 2.11's late-evaluated TapOnPointV2 still parses coordinates as integers.
    // Recheck the rounded absolute POINTS rather than returning percent floats.
    whimwayViewport.tapPoint = whimwayTap.x + "," + whimwayTap.y;
  } else {
    whimwayViewport.tapPoint = null;
  }
} else {
  if (
    typeof whimwayViewport.observationToken !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      whimwayViewport.observationToken,
    )
  )
    throw new Error("Native swipe observation identity was invalid");
  var whimwayStart = whimwayPercentPoint(
    whimwayViewport.swipe && whimwayViewport.swipe.start,
  );
  var whimwayEnd = whimwayPercentPoint(
    whimwayViewport.swipe && whimwayViewport.swipe.end,
  );
  var whimwayDelta = whimwayEnd.y - whimwayStart.y;
  if (
    Math.abs(whimwayStart.x - whimwayEnd.x) > 0.001 ||
    Math.abs(whimwayDelta) < 1 ||
    Math.abs(whimwayDelta) > (whimwayClip.bottom - whimwayClip.top) * 0.31 ||
    (whimwayViewport.direction === "DOWN"
      ? whimwayDelta >= 0
      : whimwayViewport.direction === "UP"
        ? whimwayDelta <= 0
        : true)
  )
    throw new Error("Native swipe direction or distance was invalid");
  output.whimwayPlanValidatedSwipe = {
    observationToken: whimwayViewport.observationToken,
    driverPort: whimwayViewport.driverPort,
    sequence: whimwayViewport.sequence,
    observedAt: whimwayViewport.observedAt,
    payload: {
      startX: whimwayStart.x,
      startY: whimwayStart.y,
      endX: whimwayEnd.x,
      endY: whimwayEnd.y,
      duration: 0.6,
      appIds: ["com.example.whimway"],
    },
  };
}
output.whimwayPlanViewport = whimwayViewport;
