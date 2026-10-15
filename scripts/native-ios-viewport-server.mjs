import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { analyzePlanViewport } from "./native-plan-viewport.mjs";

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_DEVICE_BYTES = 4096;
const MAX_NODES = 12000;
const MAX_DEPTH = 100;
const MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;
const MAX_OBSERVATIONS = 256;
const TARGETS = new Map([
  ["Start my day", "control"],
  ["Adjust plan", "control"],
  ["Development fixture.*", "readOnly"],
]);

class ObservationError extends Error {
  constructor(reason, status = 502) {
    super(reason);
    this.reason = reason;
    this.status = status;
  }
}

function reject(reason, status) {
  throw new ObservationError(reason, status);
}

function validPort(value) {
  return Number.isInteger(value) && value >= 1024 && value <= 65535;
}

function parseJSON(bytes) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    reject("driver-json-invalid");
  }
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deviceBounds(value) {
  if (
    !record(value) ||
    ![value.widthPoints, value.heightPoints].every(
      (item) => Number.isInteger(item) && item > 0 && item <= 16384,
    )
  )
    reject("driver-device-info-invalid");
  return `[0,0][${value.widthPoints},${value.heightPoints}]`;
}

// Same attributes as IOSDriver.mapViewHierarchy, retaining original fractional
// edges so sub-point clipping cannot disappear through integer truncation. Raw
// leaf children may be omitted; synthetic AX wrappers may be zero-sized.
// Source: Maestro XCTestDriverClient/viewHierarchy and hierarchy/AXElement.kt.
export function normalizeIOSHierarchy(value) {
  if (
    !record(value) ||
    !record(value.axElement) ||
    !Number.isInteger(value.depth) ||
    value.depth < 1 ||
    value.depth > MAX_DEPTH
  )
    reject("driver-hierarchy-invalid");
  let nodes = 0;
  function visit(node, depth) {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH)
      reject("driver-hierarchy-limit");
    if (
      !record(node) ||
      !record(node.frame) ||
      typeof node.identifier !== "string" ||
      typeof node.label !== "string" ||
      typeof node.enabled !== "boolean" ||
      (node.children !== undefined && !Array.isArray(node.children)) ||
      [node.identifier, node.label, node.title, node.value].some(
        (item) =>
          item !== undefined &&
          item !== null &&
          (typeof item !== "string" || item.length > 16384),
      )
    )
      reject("driver-hierarchy-invalid");
    const { X, Y, Width, Height } = node.frame;
    if (
      ![X, Y, Width, Height].every(
        (item) => typeof item === "number" && Number.isFinite(item),
      ) ||
      Width < 0 ||
      Height < 0 ||
      [X, Y, Width, Height, X + Width, Y + Height].some(
        (item) => Math.abs(item) > 1000000,
      )
    )
      reject("driver-frame-invalid");
    return {
      attributes: {
        "resource-id": node.identifier,
        accessibilityText: node.label,
        title: node.title ?? "",
        value: node.value ?? "",
        text: node.title === "" ? (node.value ?? "") : (node.title ?? ""),
        enabled: String(node.enabled),
        bounds: `[${X},${Y}][${X + Width},${Y + Height}]`,
      },
      children: (node.children ?? []).map((child) => visit(child, depth + 1)),
    };
  }
  return visit(value.axElement, 1);
}

async function readDriver(driverPort, route, body, limit, signal) {
  let response;
  try {
    response = await fetch(`http://127.0.0.1:${driverPort}/${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      redirect: "error",
      signal,
    });
    if (response.status !== 200) reject("driver-http-status");
    if (!response.body) reject("driver-body-empty");
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > limit) reject("driver-body-too-large");
        chunks.push(Buffer.from(value));
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    if (!length) reject("driver-body-empty");
    return Buffer.concat(chunks, length);
  } catch (error) {
    if (error instanceof ObservationError) throw error;
    reject(
      signal.aborted ? "driver-timeout" : "driver-request-failed",
      signal.aborted ? 504 : 502,
    );
  } finally {
    await response?.body?.cancel().catch(() => {});
  }
}

function evidence(bytes, filename) {
  return {
    file: filename,
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

/**
 * Internal Maestro API bridge. Only reads /deviceInfo and /viewHierarchy from
 * explicitly selected same-simulator driver ports; Maestro still does all UI
 * gestures/taps. requestTimeoutMs is bounded and injectable for transport tests.
 * @param {{artifactDirectory:string,port?:number,allowedDriverPorts?:number[],requestTimeoutMs?:number}} options
 * @returns {Promise<import('node:http').Server>}
 */
export async function startIOSViewportServer({
  artifactDirectory,
  port = 8766,
  allowedDriverPorts = [7001, 7002, 7003, 7004],
  requestTimeoutMs = 15000,
}) {
  if (
    typeof artifactDirectory !== "string" ||
    !artifactDirectory ||
    !Number.isInteger(port) ||
    (port !== 0 && !validPort(port)) ||
    !Array.isArray(allowedDriverPorts) ||
    !allowedDriverPorts.length ||
    allowedDriverPorts.some((item) => !validPort(item)) ||
    new Set(allowedDriverPorts).size !== allowedDriverPorts.length ||
    !Number.isInteger(requestTimeoutMs) ||
    requestTimeoutMs < 50 ||
    requestTimeoutMs > 30000
  )
    throw new Error("Invalid native viewport server configuration.");
  const directory = resolve(artifactDirectory);
  await mkdir(directory, { recursive: true });
  const session = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  let sequence = 0;
  let retainedBytes = 0;
  let busy = false;
  const server = createServer(async (request, response) => {
    const send = (status, value) => {
      if (response.destroyed) return;
      response.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      response.end(JSON.stringify(value));
    };
    const address = server.address();
    const actualPort =
      typeof address === "object" && address ? address.port : 0;
    if (
      request.method !== "GET" ||
      request.headers.host !== `127.0.0.1:${actualPort}` ||
      request.headers.origin ||
      request.headers["content-length"] ||
      request.headers["transfer-encoding"] ||
      !request.url ||
      !request.url.startsWith("/") ||
      request.url.startsWith("//") ||
      request.url.length > 512
    )
      return send(400, { ok: false, reason: "request-invalid" });
    let url;
    try {
      url = new URL(request.url, `http://127.0.0.1:${actualPort}`);
    } catch {
      return send(400, { ok: false, reason: "request-invalid" });
    }
    if (url.pathname === "/health" && !url.search)
      return send(200, { ok: true });
    if (url.pathname !== "/plan-viewport")
      return send(404, { ok: false, reason: "route-not-found" });
    const keys = [...url.searchParams.keys()];
    const driverText = url.searchParams.get("driverPort") ?? "";
    const driverPort = Number(driverText);
    const targetText = url.searchParams.get("targetText") ?? "";
    const targetKind = url.searchParams.get("targetKind") ?? "control";
    if (
      keys.some(
        (key) => !["driverPort", "targetText", "targetKind"].includes(key),
      ) ||
      new Set(keys).size !== keys.length ||
      !/^\d{4,5}$/.test(driverText) ||
      !allowedDriverPorts.includes(driverPort) ||
      TARGETS.get(targetText) !== targetKind
    )
      return send(400, { ok: false, reason: "query-invalid" });
    if (busy) return send(409, { ok: false, reason: "observation-busy" });
    if (sequence >= MAX_OBSERVATIONS)
      return send(503, { ok: false, reason: "observation-limit" });
    busy = true;
    const current = ++sequence;
    const prefix = `${session}-${String(current).padStart(3, "0")}-driver-${driverPort}`;
    const observedAt = new Date().toISOString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    const abort = () => controller.abort();
    request.once("aborted", abort);
    let deviceBytes;
    let snapshotBytes;
    let geometry;
    let failure;
    try {
      deviceBytes = await readDriver(
        driverPort,
        "deviceInfo",
        {},
        MAX_DEVICE_BYTES,
        controller.signal,
      );
      const screenBounds = deviceBounds(parseJSON(deviceBytes));
      snapshotBytes = await readDriver(
        driverPort,
        "viewHierarchy",
        { appIds: ["com.example.whimway"], excludeKeyboardElements: true },
        MAX_BODY_BYTES,
        controller.signal,
      );
      const hierarchy = normalizeIOSHierarchy(parseJSON(snapshotBytes));
      try {
        geometry = analyzePlanViewport({
          hierarchy,
          targetText,
          targetKind,
          screenBounds,
        });
      } catch {
        reject("viewport-geometry-rejected", 422);
      }
    } catch (error) {
      failure =
        error instanceof ObservationError
          ? error
          : new ObservationError("observation-failed");
    } finally {
      clearTimeout(timer);
      request.removeListener("aborted", abort);
    }
    try {
      const device =
        deviceBytes && evidence(deviceBytes, `${prefix}-device-info.json`);
      const snapshot =
        snapshotBytes && evidence(snapshotBytes, `${prefix}-snapshot.json`);
      const observation = Buffer.from(
        JSON.stringify(
          {
            source: "maestro-xctest-live-ax",
            observedAt,
            sequence: current,
            driverPort,
            targetText,
            targetKind,
            ...(device ? { device } : {}),
            ...(snapshot ? { snapshot } : {}),
            ...(failure
              ? { ok: false, reason: failure.reason }
              : { ok: true, ...geometry }),
          },
          null,
          2,
        ),
      );
      const bytes =
        observation.byteLength +
        (deviceBytes?.byteLength ?? 0) +
        (snapshotBytes?.byteLength ?? 0);
      if (retainedBytes + bytes > MAX_ARTIFACT_BYTES)
        reject("artifact-byte-limit", 503);
      retainedBytes += bytes;
      if (device)
        await writeFile(join(directory, device.file), deviceBytes, {
          flag: "wx",
          mode: 0o600,
        });
      if (snapshot)
        await writeFile(join(directory, snapshot.file), snapshotBytes, {
          flag: "wx",
          mode: 0o600,
        });
      await writeFile(
        join(directory, `${prefix}-observation.json`),
        observation,
        { flag: "wx", mode: 0o600 },
      );
      if (failure) send(failure.status, { ok: false, reason: failure.reason });
      else send(200, { ok: true, ...geometry, observedAt, sequence: current });
    } catch (error) {
      send(error instanceof ObservationError ? error.status : 500, {
        ok: false,
        reason:
          error instanceof ObservationError
            ? error.reason
            : "artifact-write-failed",
      });
    } finally {
      busy = false;
    }
  });
  server.headersTimeout = 5000;
  server.requestTimeout = 35000;
  await new Promise((resolveListening, rejectListening) => {
    server.once("error", rejectListening);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", rejectListening);
      resolveListening(undefined);
    });
  });
  return server;
}
