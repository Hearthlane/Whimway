import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { startIOSNativeTestBridges } from "../scripts/start-native-test-services.mjs";

const servers: Server[] = [];
const bridges: Awaited<ReturnType<typeof startIOSNativeTestBridges>>[] = [];
const directories: string[] = [];

function port(server: Server) {
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No test listener.");
  return address.port;
}

function origin(server: Server) {
  return `http://127.0.0.1:${port(server)}`;
}

async function listen(server = createServer()) {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "whimway-test-bridges-"));
  directories.push(directory);
  return directory;
}

const snapshot = {
  depth: 3,
  axElement: {
    identifier: "",
    label: "Whimway",
    enabled: true,
    frame: { X: 0, Y: 0, Width: 402, Height: 874 },
    children: [
      {
        identifier: "plan-timeline",
        label: "",
        enabled: true,
        frame: { X: 0, Y: 472, Width: 402, Height: 368 },
        children: [
          {
            identifier: "",
            label: "Adjust plan",
            enabled: true,
            frame: { X: 24, Y: 827, Width: 354, Height: 82 },
          },
        ],
      },
    ],
  },
};

afterEach(async () => {
  for (const bridge of bridges.splice(0)) bridge.close();
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
        !basename(directory).startsWith("whimway-test-bridges-")
      )
        throw Error("Refusing cleanup outside the test temporary directory.");
      return rm(directory, { recursive: true, force: true });
    }),
  );
});

describe("native fixture UI bridge service lifecycle", () => {
  it("starts two healthy loopback listeners and passes only server-observed geometry to one real driver dispatch", async () => {
    const calls: { route: string; body: unknown }[] = [];
    const native = await listen(
      createServer((request, response) => {
        let body = "";
        request.on("data", (chunk) => {
          body += chunk;
        });
        request.on("end", () => {
          calls.push({ route: request.url ?? "", body: JSON.parse(body) });
          if (request.url === "/swipeV2") return response.end();
          response.end(
            JSON.stringify(
              request.url === "/deviceInfo"
                ? { widthPoints: 402, heightPoints: 874 }
                : snapshot,
            ),
          );
        });
      }),
    );
    const bridge = await startIOSNativeTestBridges({
      artifactDirectory: await temporaryDirectory(),
      viewportOptions: { port: 0, allowedDriverPorts: [port(native)] },
      gestureOptions: { port: 0, allowedDriverPorts: [port(native)] },
    });
    bridges.push(bridge);
    expect(bridge.viewport.address()).toMatchObject({ address: "127.0.0.1" });
    expect(bridge.gestures.address()).toMatchObject({ address: "127.0.0.1" });
    expect(port(bridge.viewport)).not.toBe(port(bridge.gestures));
    const observerOrigin = origin(bridge.viewport);
    const gestureOrigin = origin(bridge.gestures);
    for (const base of [observerOrigin, gestureOrigin])
      expect(await (await fetch(base + "/health")).json()).toEqual({
        ok: true,
      });
    expect(calls).toEqual([]);

    const observation = await (
      await fetch(
        observerOrigin +
          "/plan-viewport?" +
          new URLSearchParams({
            driverPort: String(port(native)),
            targetText: "Adjust plan",
            targetKind: "control",
          }),
      )
    ).json();
    expect(observation).toMatchObject({ ok: true, ready: false });
    const result = await (
      await fetch(gestureOrigin + "/gesture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          observationToken: observation.observationToken,
        }),
      })
    ).json();
    expect(result).toMatchObject({ ok: true });
    expect(calls.map((call) => call.route)).toEqual([
      "/deviceInfo",
      "/viewHierarchy",
      "/swipeV2",
    ]);
    const swipe = calls[2].body as Record<string, number>;
    expect(swipe.startX).toBeGreaterThan(2);
    expect(swipe.startX).toBeLessThan(400);
    expect(swipe.startY).toBeGreaterThan(474);
    expect(swipe.startY).toBeLessThan(838);
    expect(swipe.endY).toBeGreaterThan(474);
    expect(swipe.endY).toBeLessThan(swipe.startY);

    bridge.close();
    expect(bridge.gestures.listening).toBe(false);
    expect(bridge.viewport.listening).toBe(false);
    await expect(fetch(observerOrigin + "/health")).rejects.toThrow();
    await expect(fetch(gestureOrigin + "/health")).rejects.toThrow();
    expect(() =>
      bridge.viewport.consumeObservation(observation.observationToken),
    ).toThrow("observation-server-closed");
  });

  it("closes an already-started observer when the separate broker cannot bind, leaving no partial-ready listener", async () => {
    const occupied = await listen();
    const reservation = await listen();
    const observerPort = port(reservation);
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    await expect(
      startIOSNativeTestBridges({
        artifactDirectory: await temporaryDirectory(),
        viewportOptions: { port: observerPort },
        gestureOptions: { port: port(occupied) },
      }),
    ).rejects.toThrow();
    await expect(
      fetch(`http://127.0.0.1:${observerPort}/health`),
    ).rejects.toThrow();
    expect(occupied.listening).toBe(true);
  });
});
