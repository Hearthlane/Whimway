/* global IOS_DRIVER_PORT, http, output */
// Maestro 2.11 eagerly parses YAML swipe coordinates before JS evaluation.
// Its supported JS HTTP client invokes the SAME XCTest native gesture route,
// once, using the read-only observer's current clipped and damped geometry.
var whimwayProof = output.whimwayPlanValidatedSwipe;
var whimwayCurrent = output.whimwayPlanViewport;
var whimwayPort = String(IOS_DRIVER_PORT);
var whimwayTime =
  Date.now() - Date.parse(whimwayProof && whimwayProof.observedAt);
if (
  !/^(7001|7002|7003|7004)$/.test(whimwayPort) ||
  !whimwayProof ||
  !whimwayCurrent ||
  whimwayCurrent.ready !== false ||
  whimwayProof.driverPort !== Number(whimwayPort) ||
  whimwayProof.sequence !== whimwayCurrent.sequence ||
  whimwayProof.observedAt !== whimwayCurrent.observedAt ||
  !Number.isFinite(whimwayTime) ||
  whimwayTime < -1000 ||
  whimwayTime > 10000
)
  throw new Error("Native swipe proof was invalid or stale");
var whimwayPayload = whimwayProof.payload;
var whimwayClip = whimwayCurrent.clipBounds;
if (
  !whimwayPayload ||
  !whimwayClip ||
  ![
    whimwayPayload.startX,
    whimwayPayload.startY,
    whimwayPayload.endX,
    whimwayPayload.endY,
  ].every(function (value) {
    return typeof value === "number" && Number.isFinite(value);
  }) ||
  whimwayPayload.duration !== 0.6 ||
  JSON.stringify(whimwayPayload.appIds) !== '["com.example.whimway"]' ||
  whimwayPayload.startX <= whimwayClip.left ||
  whimwayPayload.startX >= whimwayClip.right ||
  whimwayPayload.endX <= whimwayClip.left ||
  whimwayPayload.endX >= whimwayClip.right ||
  whimwayPayload.startY <= whimwayClip.top ||
  whimwayPayload.startY >= whimwayClip.bottom ||
  whimwayPayload.endY <= whimwayClip.top ||
  whimwayPayload.endY >= whimwayClip.bottom
)
  throw new Error("Native swipe payload left the live viewport");
var whimwayDelta = whimwayPayload.endY - whimwayPayload.startY;
if (
  Math.abs(whimwayPayload.startX - whimwayPayload.endX) > 0.001 ||
  Math.abs(whimwayDelta) < 1 ||
  Math.abs(whimwayDelta) > (whimwayClip.bottom - whimwayClip.top) * 0.31 ||
  (whimwayCurrent.direction === "DOWN"
    ? whimwayDelta >= 0
    : whimwayCurrent.direction === "UP"
      ? whimwayDelta <= 0
      : true)
)
  throw new Error("Native swipe direction or distance was invalid");
// Clear before dispatch: a failed/408 call may already have executed and must
// never be replayed. The loop obtains a new actual AX snapshot afterward.
output.whimwayPlanValidatedSwipe = null;
var whimwayResponse = http.post(
  "http://127.0.0.1:" + whimwayPort + "/swipeV2",
  {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(whimwayPayload),
  },
);
var whimwayBody =
  typeof whimwayResponse.body === "string" ? whimwayResponse.body : "";
console.log(
  JSON.stringify({
    source: "maestro-xctest-native-swipe",
    driverPort: Number(whimwayPort),
    sequence: whimwayProof.sequence,
    payload: whimwayPayload,
    response: {
      ok: whimwayResponse.ok,
      status: whimwayResponse.status,
      body: whimwayBody.slice(0, 8192),
      bodyTruncated: whimwayBody.length > 8192,
    },
  }),
);
if (whimwayResponse.ok !== true || whimwayResponse.status !== 200)
  throw new Error("Native swipe failed");
