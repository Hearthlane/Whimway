import { afterEach, describe, expect, it } from "vitest";
import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { startIOSViewportServer } from "../scripts/native-ios-viewport-server.mjs";

const servers: Server[] = [];
const directories: string[] = [];
type DriverHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => void;

function frame(X: number, Y: number, Width: number, Height: number) {
  return { X, Y, Width, Height };
}

function node(
  identifier: string,
  label: string,
  box: ReturnType<typeof frame>,
  children?: unknown[],
) {
  return {
    identifier,
    label,
    frame: box,
    enabled: true,
    ...(children ? { children } : {}),
  };
}

function snapshot(y = 600, label = "Adjust plan") {
  return {
    depth: 4,
    axElement: node("", "", frame(0, 0, 0, 0), [
      node("", "Whimway", frame(0, 0, 402, 874), [
        node("plan-timeline", "", frame(0, 472, 402, 368), [
          node("", label, frame(24, y, 354, 82)),
        ]),
      ]),
    ]),
  };
}

const dimensions = {
  widthPoints: 402,
  heightPoints: 874,
  widthPixels: 1206,
  heightPixels: 2622,
};
function port(server: Server) {
  const address = server.address();
  if (!address || typeof address === "string")
    throw Error("Missing test listener.");
  return address.port;
}

async function driver(handler: DriverHandler) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

async function bridge(
  driverServer: Server,
  options: { requestTimeoutMs?: number } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "whimway-viewport-"));
  directories.push(directory);
  const server = await startIOSViewportServer({
    artifactDirectory: directory,
    port: 0,
    allowedDriverPorts: [port(driverServer)],
    ...options,
  });
  servers.push(server);
  return { server, directory, origin: `http://127.0.0.1:${port(server)}` };
}

function query(driverServer: Server, label = "Adjust plan", kind = "control") {
  return (
    "/plan-viewport?" +
    new URLSearchParams({
      driverPort: String(port(driverServer)),
      targetText: label,
      targetKind: kind,
    })
  );
}

async function observations(directory: string) {
  const files = (await readdir(directory)).filter((file) =>
    file.endsWith("-observation.json"),
  );
  return Promise.all(
    files.map(async (file) =>
      JSON.parse(await readFile(join(directory, file), "utf8")),
    ),
  );
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
  await Promise.all(
    directories.splice(0).map((directory) => {
      if (
        resolve(dirname(directory)) !== resolve(tmpdir()) ||
        !basename(directory).startsWith("whimway-viewport-")
      )
        throw Error("Refusing cleanup outside the test temporary directory.");
      return rm(directory, { recursive: true, force: true });
    }),
  );
});

describe("native iOS viewport live-driver HTTP bridge", () => {
  it("reads only exact device/snapshot POSTs, uses points and retains original bytes with hashes", async () => {
    const calls: {
      method: string | undefined;
      url: string | undefined;
      body: unknown;
      contentType: string | undefined;
    }[] = [];
    const rawSnapshot = JSON.stringify(snapshot());
    const native = await driver((request, response) => {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        calls.push({
          method: request.method,
          url: request.url,
          body: JSON.parse(body),
          contentType: request.headers["content-type"],
        });
        response.end(
          request.url === "/deviceInfo"
            ? JSON.stringify(dimensions)
            : rawSnapshot,
        );
      });
    });
    const test = await bridge(native);
    expect(test.server.address()).toMatchObject({ address: "127.0.0.1" });
    expect(await (await fetch(test.origin + "/health")).json()).toEqual({
      ok: true,
    });
    expect(calls).toHaveLength(0);
    const response = await fetch(test.origin + query(native));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({
      ok: true,
      ready: true,
      fullyVisible: true,
      targetKind: "control",
      sequence: 1,
    });
    expect(result.clipBounds).toMatchObject({
      left: 0,
      top: 472,
      right: 402,
      bottom: 840,
    });
    expect(result.tapCenter).toEqual({ x: 201, y: 641 });
    expect(result.tapPoint).toBeTruthy();
    expect(calls).toEqual([
      {
        method: "POST",
        url: "/deviceInfo",
        body: {},
        contentType: "application/json",
      },
      {
        method: "POST",
        url: "/viewHierarchy",
        body: {
          appIds: ["com.example.whimway"],
          excludeKeyboardElements: true,
        },
        contentType: "application/json",
      },
    ]);
    const [observation] = await observations(test.directory);
    expect(observation).toMatchObject({
      source: "maestro-xctest-live-ax",
      ok: true,
      ready: true,
      driverPort: port(native),
    });
    const retained = await readFile(
      join(test.directory, observation.snapshot.file),
    );
    expect(retained.toString()).toBe(rawSnapshot);
    expect(observation.snapshot.sha256).toBe(
      createHash("sha256").update(retained).digest("hex"),
    );
    expect(observation.snapshot.bytes).toBe(Buffer.byteLength(rawSnapshot));
  });

  it("returns not-ready geometry for the actual bottom-clipped control rather than claiming a tap is safe", async () => {
    const native = await driver((request, response) =>
      response.end(
        JSON.stringify(
          request.url === "/deviceInfo" ? dimensions : snapshot(827),
        ),
      ),
    );
    const test = await bridge(native);
    const result = await (await fetch(test.origin + query(native))).json();
    expect(result).toMatchObject({
      ok: true,
      ready: false,
      fullyVisible: false,
      tapPoint: null,
      direction: "DOWN",
    });
    expect(result.tapCenter.y).toBeGreaterThan(result.clipBounds.bottom);
    expect(result.swipe).toMatchObject({
      start: expect.any(String),
      end: expect.any(String),
    });
  });

  it("preserves fractional AX edges when a control clips by half a point, without changing retained snapshot bytes", async () => {
    const rawSnapshot = JSON.stringify({
      depth: 3,
      axElement: node("", "Whimway", frame(0, 0, 402, 874), [
        node("plan-timeline", "", frame(0, 472.7, 402, 367.3), [
          node("", "Adjust plan", frame(24, 472.2, 354, 82)),
        ]),
      ]),
    });
    const native = await driver((request, response) =>
      response.end(
        request.url === "/deviceInfo"
          ? JSON.stringify(dimensions)
          : rawSnapshot,
      ),
    );
    const test = await bridge(native);
    const result = await (await fetch(test.origin + query(native))).json();
    expect(result).toMatchObject({
      ok: true,
      ready: false,
      fullyVisible: false,
      tapPoint: null,
      direction: "UP",
      targetBounds: { top: 472.2 },
      clipBounds: { top: 472.7 },
    });
    const [observation] = await observations(test.directory);
    const retained = await readFile(
      join(test.directory, observation.snapshot.file),
    );
    expect(retained.toString()).toBe(rawSnapshot);
    expect(observation.snapshot.sha256).toBe(
      createHash("sha256").update(rawSnapshot).digest("hex"),
    );
  });

  it("handles real optional AX leaves and exact disclosure matching without producing a read-only tap", async () => {
    const native = await driver((request, response) =>
      response.end(
        JSON.stringify(
          request.url === "/deviceInfo"
            ? dimensions
            : snapshot(600, "Development fixture · synthetic places"),
        ),
      ),
    );
    const test = await bridge(native);
    const result = await (
      await fetch(
        test.origin + query(native, "Development fixture.*", "readOnly"),
      )
    ).json();
    expect(result).toMatchObject({
      ok: true,
      ready: true,
      targetKind: "readOnly",
      tapPoint: null,
    });
  });

  it.each([
    [
      "unknown driver port",
      (native: Server) => query(native).replace(String(port(native)), "7000"),
    ],
    ["unknown target", (native: Server) => query(native, ".*")],
    [
      "kind mismatch",
      (native: Server) => query(native, "Adjust plan", "readOnly"),
    ],
    [
      "duplicate parameter",
      (native: Server) => query(native) + "&targetText=Adjust%20plan",
    ],
    [
      "unknown parameter",
      (native: Server) => query(native) + "&url=http://example.com",
    ],
  ])("rejects %s without contacting a driver", async (_name, invalidQuery) => {
    let calls = 0;
    const native = await driver((_request, response) => {
      calls++;
      response.end("{}");
    });
    const test = await bridge(native);
    const response = await fetch(test.origin + invalidQuery(native));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      reason: "query-invalid",
    });
    expect(calls).toBe(0);
  });

  it.each([
    ["malformed JSON", "{", "driver-json-invalid"],
    [
      "wrong schema",
      JSON.stringify({ axElement: {}, depth: 1 }),
      "driver-hierarchy-invalid",
    ],
    [
      "nonfinite frame",
      JSON.stringify(snapshot()).replace('"X":24', '"X":1e309'),
      "driver-frame-invalid",
    ],
    [
      "oversized body",
      " ".repeat(2 * 1024 * 1024 + 1),
      "driver-body-too-large",
    ],
    [
      "missing own pane",
      JSON.stringify(snapshot()).replace("plan-timeline", "another-app"),
      "viewport-geometry-rejected",
    ],
    [
      "unbounded depth",
      JSON.stringify({ ...snapshot(), depth: 101 }),
      "driver-hierarchy-invalid",
    ],
  ])(
    "fails closed for %s and records a fixed observation reason",
    async (_name, body, reason) => {
      const native = await driver((request, response) =>
        response.end(
          request.url === "/deviceInfo" ? JSON.stringify(dimensions) : body,
        ),
      );
      const test = await bridge(native);
      const response = await fetch(test.origin + query(native));
      expect(response.ok).toBe(false);
      expect(await response.json()).toEqual({ ok: false, reason });
      expect(await observations(test.directory)).toMatchObject([
        { ok: false, reason },
      ]);
    },
  );

  it("rejects invalid point dimensions before making a hierarchy request", async () => {
    const calls: string[] = [];
    const native = await driver((request, response) => {
      calls.push(request.url ?? "");
      response.end('{"widthPoints":"402","heightPoints":874}');
    });
    const test = await bridge(native);
    const response = await fetch(test.origin + query(native));
    expect(await response.json()).toEqual({
      ok: false,
      reason: "driver-device-info-invalid",
    });
    expect(calls).toEqual(["/deviceInfo"]);
  });

  it("bounds a stalled real HTTP response and never reaches a second driver route", async () => {
    const calls: string[] = [];
    const native = await driver((request) => {
      calls.push(request.url ?? "");
    });
    const test = await bridge(native, { requestTimeoutMs: 80 });
    const start = performance.now();
    const response = await fetch(test.origin + query(native));
    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({
      ok: false,
      reason: "driver-timeout",
    });
    expect(performance.now() - start).toBeLessThan(2000);
    expect(calls).toEqual(["/deviceInfo"]);
  });

  it("does not follow driver redirects or expose an arbitrary native error body", async () => {
    let redirected = 0;
    const outside = await driver((_request, response) => {
      redirected++;
      response.end("not a native snapshot");
    });
    const native = await driver((_request, response) => {
      response.writeHead(302, {
        Location: `http://127.0.0.1:${port(outside)}/touch`,
      });
      response.end("private-native-exception-value");
    });
    const test = await bridge(native);
    const response = await fetch(test.origin + query(native));
    expect(await response.json()).toEqual({
      ok: false,
      reason: "driver-request-failed",
    });
    expect(redirected).toBe(0);
    expect(JSON.stringify(await observations(test.directory))).not.toContain(
      "private-native-exception-value",
    );
  });

  it.each(["depth", "nodes"])(
    "bounds the actual AX walk by %s even when the reported depth is false",
    async (limit) => {
      let root = node("", "", frame(0, 0, 0, 0));
      if (limit === "depth") {
        for (let index = 0; index < 101; index++)
          root = node("", "", frame(0, 0, 0, 0), [root]);
      } else {
        root = node(
          "",
          "",
          frame(0, 0, 0, 0),
          Array.from({ length: 12000 }, () => node("", "", frame(0, 0, 0, 0))),
        );
      }
      const body = JSON.stringify({ axElement: root, depth: 1 });
      expect(Buffer.byteLength(body)).toBeLessThan(2 * 1024 * 1024);
      const native = await driver((request, response) =>
        response.end(
          request.url === "/deviceInfo" ? JSON.stringify(dimensions) : body,
        ),
      );
      const test = await bridge(native);
      const response = await fetch(test.origin + query(native));
      expect(await response.json()).toEqual({
        ok: false,
        reason: "driver-hierarchy-limit",
      });
    },
  );

  it("applies the deadline while draining a response body, not only while connecting", async () => {
    const native = await driver((_request, response) => {
      response.writeHead(200);
      response.write('{"widthPoints":402,');
    });
    const test = await bridge(native, { requestTimeoutMs: 80 });
    const response = await fetch(test.origin + query(native));
    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({
      ok: false,
      reason: "driver-timeout",
    });
  });

  it("rejects cross-origin or write requests without accessing native routes", async () => {
    let calls = 0;
    const native = await driver((_request, response) => {
      calls++;
      response.end("{}");
    });
    const test = await bridge(native);
    for (const options of [
      { headers: { Origin: "https://example.com" } },
      { method: "POST" },
    ]) {
      const response = await fetch(test.origin + query(native), options);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        ok: false,
        reason: "request-invalid",
      });
    }
    expect(calls).toBe(0);
  });
});
