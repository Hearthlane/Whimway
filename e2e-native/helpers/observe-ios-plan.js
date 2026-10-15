/* global IOS_DRIVER_PORT, TARGET_KIND, TARGET_TEXT, http, output */
// Maestro's JS runtime has no live bounds binding. The loopback observer reads
// only the SAME explicitly selected XCTest driver's hierarchy/deviceInfo.
output.whimwayPlanViewport = { ready: false, tapPoint: null };
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
output.whimwayPlanViewport = whimwayViewport;
