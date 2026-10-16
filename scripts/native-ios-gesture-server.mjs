import { createServer, request as nativeRequest } from "node:http";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const TOKEN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_BODY = 32 * 1024;
const MAX_RECORDS = 256;
const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024;
const TARGETS = new Map([
  ["Adjust plan", "control"],
  ["Start my day", "control"],
  ["Development fixture.*", "readOnly"],
]);

function fail(reason) {
  throw new Error(reason);
}
function validPort(value) {
  return Number.isInteger(value) && value >= 1024 && value <= 65535;
}
function rect(value) {
  if (
    !value ||
    ![value.left, value.top, value.right, value.bottom].every(
      Number.isFinite,
    ) ||
    value.left >= value.right ||
    value.top >= value.bottom
  )
    fail("trusted-geometry-invalid");
  return value;
}
function inside(box, point) {
  return (
    point.x > box.left &&
    point.x < box.right &&
    point.y > box.top &&
    point.y < box.bottom
  );
}
function fresh(value) {
  const age =
    Date.now() - (typeof value === "number" ? value : Date.parse(value));
  return Number.isFinite(age) && age >= -1000 && age <= 10000;
}

function trustedPayload(proof, token, ports) {
  if (
    !proof ||
    proof.observationToken !== token ||
    !ports.has(proof.driverPort) ||
    !Number.isInteger(proof.sequence) ||
    proof.sequence < 1 ||
    !fresh(proof.observedAt) ||
    !fresh(proof.issuedAt) ||
    !TARGETS.has(proof.targetText) ||
    TARGETS.get(proof.targetText) !== proof.targetKind
  )
    fail("trusted-observation-invalid");
  const geometry = proof.geometry;
  if (
    !geometry ||
    geometry.ready !== false ||
    geometry.targetKind !== proof.targetKind ||
    !["UP", "DOWN"].includes(geometry.direction)
  )
    fail("trusted-geometry-invalid");
  const screenMatch =
    typeof proof.screenBounds === "string" &&
    proof.screenBounds.match(/^\[0,0\]\[(\d+),(\d+)\]$/);
  if (!screenMatch) fail("trusted-geometry-invalid");
  const screen = rect({
    left: 0,
    top: 0,
    right: Number(screenMatch[1]),
    bottom: Number(screenMatch[2]),
  });
  if (screen.right > 16384 || screen.bottom > 16384)
    fail("trusted-geometry-invalid");
  const clip = rect(geometry.clipBounds);
  if (
    clip.left < screen.left ||
    clip.top < screen.top ||
    clip.right > screen.right ||
    clip.bottom > screen.bottom
  )
    fail("trusted-geometry-invalid");
  rect(geometry.targetBounds);
  function point(value) {
    const match =
      typeof value === "string" &&
      value.match(/^(\d+(?:\.\d+)?)%,(\d+(?:\.\d+)?)%$/);
    if (!match) fail("trusted-geometry-invalid");
    const result = {
      x: (Number(match[1]) * screen.right) / 100,
      y: (Number(match[2]) * screen.bottom) / 100,
    };
    if (!inside(screen, result) || !inside(clip, result))
      fail("trusted-geometry-invalid");
    return result;
  }
  const start = point(geometry.swipe?.start),
    end = point(geometry.swipe?.end),
    delta = end.y - start.y;
  if (
    Math.abs(start.x - end.x) > 0.001 ||
    Math.abs(delta) < 1 ||
    Math.abs(delta) > (clip.bottom - clip.top) * 0.31 ||
    (geometry.direction === "DOWN" ? delta >= 0 : delta <= 0)
  )
    fail("trusted-geometry-invalid");
  return {
    startX: start.x,
    startY: start.y,
    endX: end.x,
    endY: end.y,
    duration: 0.6,
    appIds: ["com.example.whimway"],
  };
}

// Node core http.request performs ONE transmission. In particular it does not
// replay HTTP408 or a lost connection as Maestro's generic OkHttp binding can.
function dispatch(port, payload, timeout) {
  return new Promise((resolveOutcome) => {
    let status = null,
      chunks = [],
      bytes = 0,
      truncated = false,
      settled = false;
    const finish = (reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveOutcome({
        ok: reason === null && status === 200 && bytes === 0,
        reason:
          reason ??
          (status === 200 && bytes === 0 ? null : "native-http-failed"),
        status,
        body: Buffer.concat(chunks),
        truncated,
      });
    };
    const request = nativeRequest(
      {
        host: "127.0.0.1",
        port,
        path: "/swipeV2",
        method: "POST",
        agent: false,
        headers: { "Content-Type": "application/json" },
      },
      (response) => {
        status = response.statusCode ?? null;
        response.on("data", (chunk) => {
          const buffer = Buffer.from(chunk),
            remaining = MAX_BODY - bytes;
          if (buffer.length > remaining) {
            chunks.push(buffer.subarray(0, remaining));
            bytes += remaining;
            truncated = true;
            finish("native-response-too-large");
            response.destroy();
            request.destroy();
            return;
          }
          chunks.push(buffer);
          bytes += buffer.length;
        });
        response.on("end", () => finish(null));
        response.on("error", () => finish("native-transport-lost"));
        response.on("aborted", () => finish("native-transport-lost"));
      },
    );
    const timer = setTimeout(() => {
      finish("native-timeout");
      request.destroy();
    }, timeout);
    request.on("error", () => finish("native-transport-lost"));
    request.end(JSON.stringify(payload));
  });
}

/** Separate one-shot gesture broker; the viewport observer remains read-only.
 * @param {{consumeObservation:(token:string)=>unknown,artifactDirectory:string,port?:number,allowedDriverPorts?:number[],requestTimeoutMs?:number}} options
 * @returns {Promise<import('node:http').Server>}
 */
export async function startIOSGestureBroker({
  consumeObservation,
  artifactDirectory,
  port = 8767,
  allowedDriverPorts = [7001, 7002, 7003, 7004],
  requestTimeoutMs = 15000,
}) {
  if (
    typeof consumeObservation !== "function" ||
    typeof artifactDirectory !== "string" ||
    !artifactDirectory ||
    !Number.isInteger(port) ||
    (port !== 0 && !validPort(port)) ||
    !Array.isArray(allowedDriverPorts) ||
    !allowedDriverPorts.length ||
    allowedDriverPorts.some((p) => !validPort(p)) ||
    new Set(allowedDriverPorts).size !== allowedDriverPorts.length ||
    !Number.isInteger(requestTimeoutMs) ||
    requestTimeoutMs < 50 ||
    requestTimeoutMs > 30000
  )
    throw new Error("Invalid native gesture broker configuration.");
  const directory = resolve(artifactDirectory),
    ports = new Set(allowedDriverPorts);
  await mkdir(directory, { recursive: true });
  const records = new Map(),
    activeDrivers = new Set();
  let artifactBytes = 0;
  async function consumeAndDispatch(token) {
    let proof, payload, outcome, reason;
    try {
      proof = consumeObservation(token);
      payload = trustedPayload(proof, token, ports);
    } catch {
      return { ok: false, reason: "observation-rejected" };
    }
    if (activeDrivers.has(proof.driverPort))
      return { ok: false, reason: "driver-gesture-in-flight" };
    activeDrivers.add(proof.driverPort);
    try {
      outcome = await dispatch(proof.driverPort, payload, requestTimeoutMs);
    } finally {
      activeDrivers.delete(proof.driverPort);
    }
    const identity = createHash("sha256").update(token).digest("hex");
    const metadata = {
      source: "maestro-xctest-one-shot-gesture",
      observationIdentitySha256: identity,
      driverPort: proof.driverPort,
      sequence: proof.sequence,
      observedAt: proof.observedAt,
      dispatchedAt: new Date().toISOString(),
      payload,
      native: {
        status: outcome.status,
        reason: outcome.reason,
        bodyBytes: outcome.body.length,
        bodySha256: createHash("sha256").update(outcome.body).digest("hex"),
        bodyTruncated: outcome.truncated,
        bodyFile: identity + "-native-body.bin",
      },
    };
    const json = Buffer.from(JSON.stringify(metadata, null, 2));
    if (artifactBytes + json.length + outcome.body.length > MAX_ARTIFACT_BYTES)
      reason = "gesture-artifact-limit";
    else {
      artifactBytes += json.length + outcome.body.length;
      try {
        await writeFile(
          join(directory, identity + "-native-body.bin"),
          outcome.body,
          { mode: 0o600, flag: "wx" },
        );
        await writeFile(join(directory, identity + "-gesture.json"), json, {
          mode: 0o600,
          flag: "wx",
        });
      } catch {
        reason = "gesture-artifact-write-failed";
      }
    }
    return {
      ok: !reason && outcome.ok,
      reason: reason ?? outcome.reason,
      nativeStatus: outcome.status,
      sequence: proof.sequence,
      driverPort: proof.driverPort,
    };
  }
  const server = createServer(async (request, response) => {
    const send = (value) => {
      if (response.destroyed) return;
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      response.end(JSON.stringify(value));
    };
    const address = server.address(),
      actualPort = typeof address === "object" && address ? address.port : 0;
    if (
      request.headers.host !== `127.0.0.1:${actualPort}` ||
      request.headers.origin !== undefined
    )
      return send({ ok: false, reason: "request-invalid" });
    if (request.method === "GET" && request.url === "/health")
      return send({ ok: true });
    if (request.method !== "POST" || request.url !== "/gesture")
      return send({ ok: false, reason: "request-invalid" });
    let token;
    try {
      const parts = [];
      let length = 0;
      for await (const chunk of request) {
        length += chunk.length;
        if (length > 1024) throw Error();
        parts.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(parts).toString("utf8"));
      if (
        !body ||
        Array.isArray(body) ||
        Object.keys(body).length !== 1 ||
        typeof body.observationToken !== "string" ||
        !TOKEN.test(body.observationToken)
      )
        throw Error();
      token = body.observationToken;
    } catch {
      return send({ ok: false, reason: "request-invalid" });
    }
    let record = records.get(token);
    if (!record) {
      if (records.size >= MAX_RECORDS)
        return send({ ok: false, reason: "gesture-capacity-exceeded" });
      // Publish the promise BEFORE consuming. Any concurrent or retried request
      // receives this same result, including after client disconnect/failure.
      record = Promise.resolve()
        .then(() => consumeAndDispatch(token))
        .catch(() => ({ ok: false, reason: "gesture-failed" }));
      records.set(token, record);
    }
    send(await record);
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  await new Promise((ready, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      ready(undefined);
    });
  });
  return server;
}
