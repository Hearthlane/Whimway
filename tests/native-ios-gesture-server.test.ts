import { afterEach, describe, expect, it } from "vitest";
import {
  createServer,
  request,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { startIOSGestureBroker } from "../scripts/native-ios-gesture-server.mjs";

const servers: Server[] = [];
const directories: string[] = [];
function port(server: Server) {
  const a = server.address();
  if (!a || typeof a === "string") throw Error("Missing listener");
  return a.port;
}
async function fakeDriver(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
) {
  const s = createServer(handler);
  servers.push(s);
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  return s;
}
function proof(token: string, driverPort: number) {
  return {
    observationToken: token,
    driverPort,
    observedAt: new Date().toISOString(),
    issuedAt: Date.now(),
    sequence: 7,
    screenBounds: "[0,0][402,874]",
    targetText: "Adjust plan",
    targetKind: "control",
    geometry: {
      ready: false,
      targetKind: "control",
      direction: "DOWN",
      clipBounds: { left: 0, top: 472, right: 402, bottom: 840 },
      targetBounds: { left: 24, top: 827, right: 378, bottom: 909 },
      swipe: { start: "97%,78%", end: "97%,70%" },
    },
  };
}
async function broker(
  driver: Server,
  consume: (token: string) => unknown,
  options: { requestTimeoutMs?: number } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "whimway-gesture-"));
  directories.push(directory);
  const server = await startIOSGestureBroker({
    consumeObservation: consume,
    artifactDirectory: directory,
    port: 0,
    allowedDriverPorts: [port(driver)],
    ...options,
  });
  servers.push(server);
  return { server, directory, url: `http://127.0.0.1:${port(server)}/gesture` };
}
const post = (url: string, token: string) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ observationToken: token }),
  });
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise<void>((r) => {
          s.closeAllConnections();
          s.close(() => r());
        }),
    ),
  );
  await Promise.all(
    directories.splice(0).map((d) => {
      if (
        resolve(dirname(d)) !== resolve(tmpdir()) ||
        !basename(d).startsWith("whimway-gesture-")
      )
        throw Error("Unsafe temporary cleanup");
      return rm(d, { recursive: true, force: true });
    }),
  );
});

describe("one-shot native iOS gesture broker", () => {
  it("takes only a trusted observation identity, dispatches one exact native POST and retains empty200 proof", async () => {
    const token = randomUUID(),
      calls: { method?: string; url?: string; body: unknown }[] = [];
    let consumed = 0;
    const driver = await fakeDriver((req, res) => {
      let body = "";
      req.on("data", (b) => (body += b));
      req.on("end", () => {
        calls.push({
          method: req.method,
          url: req.url,
          body: JSON.parse(body),
        });
        res.end();
      });
    });
    const test = await broker(driver, (t) => {
      expect(t).toBe(token);
      consumed++;
      return proof(t, port(driver));
    });
    const result = await (await post(test.url, token)).json();
    expect(result).toMatchObject({ ok: true, nativeStatus: 200, sequence: 7 });
    expect(calls).toEqual([
      {
        method: "POST",
        url: "/swipeV2",
        body: {
          startX: 389.94,
          startY: 681.72,
          endX: 389.94,
          endY: 611.8,
          duration: 0.6,
          appIds: ["com.example.whimway"],
        },
      },
    ]);
    expect(consumed).toBe(1);
    const identity = createHash("sha256").update(token).digest("hex");
    const metadata = JSON.parse(
      await readFile(join(test.directory, identity + "-gesture.json"), "utf8"),
    );
    expect(metadata.native).toMatchObject({
      status: 200,
      bodyBytes: 0,
      bodyTruncated: false,
      bodySha256: createHash("sha256").update("").digest("hex"),
    });
    expect(
      (await readFile(join(test.directory, identity + "-native-body.bin")))
        .length,
    ).toBe(0);
    expect(JSON.stringify(metadata)).not.toContain(token);
  });

  it("deduplicates concurrent/in-flight/completed identities before consuming or dispatching", async () => {
    const token = randomUUID();
    let calls = 0,
      consumed = 0;
    const driver = await fakeDriver((_req, res) => {
      calls++;
      setTimeout(() => res.end(), 60);
    });
    const test = await broker(driver, (t) => {
      consumed++;
      return proof(t, port(driver));
    });
    const results = await Promise.all(
      Array.from(
        { length: 4 },
        async () => await (await post(test.url, token)).json(),
      ),
    );
    expect(results.every((x) => x.ok)).toBe(true);
    expect(new Set(results.map((x) => JSON.stringify(x))).size).toBe(1);
    expect(await (await post(test.url, token)).json()).toEqual(results[0]);
    expect(calls).toBe(1);
    expect(consumed).toBe(1);
  });

  it.each([408, 500, 302])(
    "never retries nativeHTTP%s and caches failure in HTTP200 envelope",
    async (status) => {
      const token = randomUUID();
      let calls = 0;
      const nativeBody = '{"errorMessage":"isolated native failure"}';
      const driver = await fakeDriver((_req, res) => {
        calls++;
        res.writeHead(status);
        res.end(nativeBody);
      });
      const test = await broker(driver, (t) => proof(t, port(driver)));
      for (let i = 0; i < 3; i++) {
        const r = await post(test.url, token);
        expect(r.status).toBe(200);
        expect(await r.json()).toMatchObject({
          ok: false,
          reason: "native-http-failed",
          nativeStatus: status,
        });
      }
      expect(calls).toBe(1);
      const files = await readdir(test.directory);
      const body = await readFile(
        join(
          test.directory,
          files.find((f) => f.endsWith("-native-body.bin"))!,
        ),
      );
      expect(body.toString()).toBe(nativeBody);
    },
  );

  it("caches a lost native connection as an unknown outcome without redispatch", async () => {
    const token = randomUUID();
    let calls = 0;
    const driver = await fakeDriver((req) => {
      calls++;
      req.socket.destroy();
    });
    const test = await broker(driver, (t) => proof(t, port(driver)));
    const first = await (await post(test.url, token)).json();
    expect(first).toMatchObject({ ok: false, reason: "native-transport-lost" });
    expect(await (await post(test.url, token)).json()).toEqual(first);
    expect(calls).toBe(1);
  });

  it("does not cancel or repeat a gesture after the broker client disconnects mid-flight", async () => {
    const token = randomUUID();
    let calls = 0;
    let reached!: () => void;
    const nativeReached = new Promise<void>((r) => (reached = r));
    const driver = await fakeDriver((_req, res) => {
      calls++;
      reached();
      setTimeout(() => res.end(), 80);
    });
    const test = await broker(driver, (t) => proof(t, port(driver)));
    const first = request(test.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    first.on("error", () => {});
    first.end(JSON.stringify({ observationToken: token }));
    await nativeReached;
    first.destroy();
    expect(await (await post(test.url, token)).json()).toMatchObject({
      ok: true,
      nativeStatus: 200,
    });
    expect(await (await post(test.url, token)).json()).toMatchObject({
      ok: true,
      nativeStatus: 200,
    });
    expect(calls).toBe(1);
  });

  it("fails a native timeout once and preserves the consumed identity", async () => {
    const token = randomUUID();
    let calls = 0;
    const driver = await fakeDriver(() => {
      calls++;
    });
    const test = await broker(driver, (t) => proof(t, port(driver)), {
      requestTimeoutMs: 80,
    });
    const first = await (await post(test.url, token)).json();
    expect(first).toMatchObject({ ok: false, reason: "native-timeout" });
    expect(await (await post(test.url, token)).json()).toEqual(first);
    expect(calls).toBe(1);
  });

  it("refuses request-supplied coordinates, ports or malformed identity without consumption", async () => {
    const driver = await fakeDriver((_req, res) => res.end());
    let consumed = 0;
    const test = await broker(driver, (t) => {
      consumed++;
      return proof(t, port(driver));
    });
    for (const body of [
      { observationToken: "unknown" },
      { observationToken: randomUUID(), driverPort: port(driver) },
      { observationToken: randomUUID(), startX: 100 },
    ]) {
      const r = await fetch(test.url, {
        method: "POST",
        body: JSON.stringify(body),
      });
      expect(await r.json()).toEqual({ ok: false, reason: "request-invalid" });
    }
    expect(consumed).toBe(0);
  });

  it.each(["", "http://127.0.0.1"])(
    "rejects an Origin header even when its value is %j without consumption",
    async (origin) => {
      const driver = await fakeDriver((_req, res) => res.end());
      let consumed = 0;
      const test = await broker(driver, (t) => {
        consumed++;
        return proof(t, port(driver));
      });
      const response = await fetch(test.url, {
        method: "POST",
        headers: { Origin: origin },
        body: JSON.stringify({ observationToken: randomUUID() }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        ok: false,
        reason: "request-invalid",
      });
      expect(consumed).toBe(0);
    },
  );

  it.each(["expired", "port", "clip", "ready", "target", "superseded"])(
    "rejects %s trusted proof and never contacts the native endpoint",
    async (invalid) => {
      const token = randomUUID();
      let calls = 0,
        consumed = 0;
      const driver = await fakeDriver((_req, res) => {
        calls++;
        res.end();
      });
      const test = await broker(driver, (t) => {
        consumed++;
        if (invalid === "superseded")
          throw Error("observation-token-superseded");
        const p = proof(t, port(driver));
        if (invalid === "expired") p.issuedAt = Date.now() - 30000;
        if (invalid === "port") p.driverPort = 7000;
        if (invalid === "clip") p.geometry.swipe.start = "97%,99%";
        if (invalid === "ready") p.geometry.ready = true;
        if (invalid === "target") p.targetText = "Unapproved control";
        return p;
      });
      const first = await (await post(test.url, token)).json();
      expect(first).toEqual({ ok: false, reason: "observation-rejected" });
      expect(await (await post(test.url, token)).json()).toEqual(first);
      expect(calls).toBe(0);
      expect(consumed).toBe(1);
    },
  );
});
