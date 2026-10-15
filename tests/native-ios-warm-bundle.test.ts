import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  iosBundleUrl,
  warmIosBundle,
} from "../e2e-native/helpers/warm-ios-bundle.mjs";
import {
  workflowCompatibility,
  allowedReuseChange,
} from "../scripts/reuse-native-build.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const secret = "PRIVATE_DOWNLOADED_SOURCE_MUST_NOT_BE_LOGGED";
// Structural Metro script fixture only. Parsing must never execute its code.
const script = `var __BUNDLE_START_TIME__=Date.now();
function __d(factory) { return factory; }
__d(function(){ return ${JSON.stringify(secret)}; });
globalThis.__whimwayWarmMustNotExecute = true;`;
const jsHeaders = { "content-type": "application/javascript; charset=utf-8" };
const fixtureFetch = (response: Response) => async () => response;

describe("bounded local iOS Metro preparation", () => {
  it("fetches only the exact observed loopback development bundle and requires the complete body before reporting readiness", async () => {
    const url = new URL(iosBundleUrl);
    expect(url.origin).toBe("http://127.0.0.1:8081");
    expect(url.pathname).toBe("/node_modules/expo-router/entry.bundle");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      platform: "ios",
      dev: "true",
      hot: "false",
      lazy: "true",
      "transform.engine": "hermes",
      "transform.bytecode": "1",
      "transform.routerRoot": "app",
      unstable_transformProfile: "hermes-stable",
    });
    const split = Math.floor(script.length / 2);
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
    });
    let completed = false;
    const warming = warmIosBundle({
      fetchImpl: async (requested, options) => {
        expect(requested).toBe(iosBundleUrl);
        expect(options).toMatchObject({
          redirect: "error",
          cache: "no-store",
          headers: { Accept: "application/javascript" },
        });
        expect(options?.signal).toBeInstanceOf(AbortSignal);
        return new Response(stream, { headers: jsHeaders });
      },
      timeoutMs: 1000,
    }).then((value) => {
      completed = true;
      return value;
    });
    controller.enqueue(Buffer.from(script.slice(0, split)));
    await new Promise((resolve) => setTimeout(resolve, 1));
    expect(completed).toBe(false);
    controller.enqueue(Buffer.from(script.slice(split)));
    controller.close();
    const evidence = await warming;
    expect(evidence).toMatchObject({
      ok: true,
      status: 200,
      format: "javascript-syntax",
      bytes: Buffer.byteLength(script),
      reason: "verified",
      sha256: createHash("sha256").update(script).digest("hex"),
    });
    expect(JSON.stringify(evidence)).not.toContain(secret);
    expect("__whimwayWarmMustNotExecute" in globalThis).toBe(false);
  });
  it.each([
    ["<html>server error</html>", "invalid-bundle"],
    [JSON.stringify({ error: secret }), "invalid-bundle"],
    ["var __BUNDLE_START_TIME__=Date.now(); __d(function(", "invalid-bundle"],
    ["", "empty-bundle"],
  ])(
    "refuses empty, error, non-Metro or syntactically truncated HTTP200 bodies %#",
    async (body, reason) => {
      const evidence = await warmIosBundle({
        fetchImpl: fixtureFetch(new Response(body, { headers: jsHeaders })),
      });
      expect(evidence).toMatchObject({ ok: false, reason, sha256: null });
      expect(JSON.stringify(evidence)).not.toContain(secret);
    },
  );
  it("recognizes only the installed Hermes header when a complete bytecode body is returned", async () => {
    const bytecode = Buffer.alloc(128);
    Buffer.from("c61fbc03c103191f", "hex").copy(bytecode);
    bytecode.writeUInt32LE(100, 8);
    const evidence = await warmIosBundle({
      fetchImpl: fixtureFetch(
        new Response(bytecode, {
          headers: { "content-type": "application/x-metro-bytecode-bundle" },
        }),
      ),
    });
    expect(evidence).toMatchObject({
      ok: true,
      format: "hermes-header",
      bytes: 128,
    });
    bytecode.writeUInt32LE(0, 8);
    expect(
      await warmIosBundle({
        fetchImpl: fixtureFetch(new Response(bytecode, { headers: jsHeaders })),
      }),
    ).toMatchObject({ ok: false, reason: "invalid-bundle" });
  });
  it("rejects missing bodies, wrong status/MIME and both advertised and streamed oversized responses", async () => {
    const cases = [
      [new Response(null, { headers: jsHeaders }), "missing-body"],
      [
        new Response(script, { status: 503, headers: jsHeaders }),
        "http-status",
      ],
      [
        new Response(script, {
          status: 302,
          headers: { ...jsHeaders, Location: "https://example.com" },
        }),
        "http-status",
      ],
      [
        new Response(script, {
          headers: { "content-type": "application/json" },
        }),
        "invalid-content-type",
      ],
      [
        new Response(script, {
          headers: { ...jsHeaders, "content-length": "1000" },
        }),
        "oversized-bundle",
      ],
      [new Response(script, { headers: jsHeaders }), "oversized-bundle"],
    ] as const;
    for (const [response, reason] of cases) {
      expect(
        await warmIosBundle({
          fetchImpl: fixtureFetch(response),
          maxBytes: 64,
        }),
      ).toMatchObject({ ok: false, reason, sha256: null });
    }
  });
  it("bounds even a stalled header request without relying on the mock to honor AbortSignal", async () => {
    const started = performance.now();
    const evidence = await warmIosBundle({
      fetchImpl: () => new Promise<Response>(() => {}),
      timeoutMs: 10,
    });
    expect(evidence).toMatchObject({
      ok: false,
      reason: "deadline-exceeded",
      sha256: null,
    });
    expect(performance.now() - started).toBeLessThan(1000);
  });
  it("bounds a stalled HTTP200 body, cancels its reader, and never reports progress bytes as a valid bundle", async () => {
    let cancelled = false;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(Buffer.from(script.slice(0, 32)));
      },
      cancel() {
        cancelled = true;
      },
    });
    const evidence = await warmIosBundle({
      fetchImpl: fixtureFetch(new Response(body, { headers: jsHeaders })),
      timeoutMs: 10,
    });
    expect(evidence).toMatchObject({
      ok: false,
      reason: "deadline-exceeded",
      bytes: 32,
      sha256: null,
    });
    expect(cancelled).toBe(true);
  });
  it("redacts arbitrary transport errors and refuses invalid timeout/size limits", async () => {
    expect(
      await warmIosBundle({
        fetchImpl: async () => {
          throw new Error(secret);
        },
      }),
    ).toMatchObject({ ok: false, reason: "request-failed", sha256: null });
    expect(
      JSON.stringify(
        await warmIosBundle({
          fetchImpl: async () => {
            throw new Error(secret);
          },
        }),
      ),
    ).not.toContain(secret);
    for (const options of [
      { timeoutMs: 0 },
      { timeoutMs: 360001 },
      { maxBytes: 0 },
      { maxBytes: 128 * 1024 * 1024 + 1 },
    ])
      await expect(warmIosBundle(options)).rejects.toThrow(
        "Invalid bounded warm configuration",
      );
  });
  it("runs only on a CI Apple host and does not log bundle source on a guard failure", () => {
    const helper = fileURLToPath(
      new URL("../e2e-native/helpers/warm-ios-bundle.mjs", import.meta.url),
    );
    const result = spawnSync(process.execPath, [helper], {
      env: { ...process.env, CI: "false" },
      encoding: "utf8",
      timeout: 10000,
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("host guard");
    expect(result.stderr).not.toContain(secret);
  });
  it("warms only iOS after service health and before UI/probe, preserving every compiler reuse contract", () => {
    const workflow = readFileSync(
      new URL("../.github/workflows/native.yml", import.meta.url),
      "utf8",
    );
    const warm = workflow.indexOf(
      "node e2e-native/helpers/warm-ios-bundle.mjs",
    );
    expect(warm).toBeGreaterThan(
      workflow.indexOf("test -f native-test-artifacts/ready.json"),
    );
    expect(warm).toBeLessThan(
      workflow.indexOf(
        "if maestro test --driver-host-port 7001 --test-output-dir native-results/ios-ready",
      ),
    );
    expect(workflow.slice(0, workflow.indexOf("  ios:"))).not.toContain(
      "warm-ios-bundle",
    );
    const head = spawnSync(
      "git",
      ["show", "HEAD:.github/workflows/native.yml"],
      { cwd: root, encoding: "utf8", timeout: 10000 },
    );
    expect(head.status).toBe(0);
    for (const target of ["android", "ios-release", "ios-debug"]) {
      expect(workflowCompatibility(head.stdout, workflow, target)).toBe(true);
      expect(
        allowedReuseChange("e2e-native/helpers/warm-ios-bundle.mjs", target),
      ).toBe(true);
    }
  });
});
