import { describe, expect, it } from "vitest";
import { createContext, runInContext } from "node:vm";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { createServer, type IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import {
  checkDiagnostic,
  checkKeychain,
  metroEndpoint,
  selectWhimwayTarget,
} from "../scripts/check-ios-simulator-keychain.mjs";

const validId = "12345678-1234-1234-1234-1234567890ab";
const secret = "PRIVATE_NATIVE_VALUE_MUST_NOT_ESCAPE";
const endpoint = metroEndpoint();
const target = {
  id: "simulator-1",
  appId: "com.example.whimway",
  type: "node",
  vm: "Hermes",
  reactNative: { logicalDeviceId: "simulator" },
  webSocketDebuggerUrl:
    "ws://127.0.0.1:8081/inspector/debug?device=simulator&page=1",
};
// Shape emitted by installed RN 0.86.3 InspectorPackagerConnection.cpp:257-278
// and dev-middleware InspectorProxy.js:175-205: modern C++ pages omit vm. Expo's
// headless middleware disables multiple-debugger support without adding vm.
const modernTarget = {
  id: target.id,
  title: "com.example.whimway (CI Simulator)",
  description: "React Native Bridgeless [C++ connection]",
  appId: "com.example.whimway",
  type: "node",
  webSocketDebuggerUrl: target.webSocketDebuggerUrl,
  deviceName: "CI Simulator",
  reactNative: {
    logicalDeviceId: "simulator",
    capabilities: {
      nativePageReloads: true,
      nativeSourceCodeFetching: false,
      supportsMultipleDebuggers: false,
    },
  },
};

// Executes the helper's actual Runtime.evaluate expressions in an isolated JS
// context. These mocks verify probe boundaries; they establish no OS capability.
function runtime(
  options: {
    hermes?: boolean;
    module?: boolean;
    registration?: unknown;
    registrationFails?: boolean;
    installationFailsAt?: number;
    installation?: readonly string[];
  } = {},
) {
  let reads = 0;
  const context = createContext({
    ...(options.hermes === false ? {} : { HermesInternal: {} }),
    expo: {
      modules:
        options.module === false
          ? {}
          : {
              NotificationsServerRegistrationModule: {
                async getRegistrationInfoAsync() {
                  if (options.registrationFails) throw new Error(secret);
                  return options.registration;
                },
                async getInstallationIdAsync() {
                  reads += 1;
                  if (reads === options.installationFailsAt)
                    throw new Error(secret);
                  return options.installation?.[reads - 1] ?? validId;
                },
              },
            },
    },
  });
  const sent: Record<string, unknown>[] = [];
  class Socket extends EventTarget {
    readyState = 1;
    constructor() {
      super();
      queueMicrotask(() => this.dispatchEvent(new Event("open")));
    }
    send(raw: string | ArrayBufferLike | Blob | ArrayBufferView) {
      if (typeof raw !== "string")
        throw new Error("Expected a text CDP request.");
      const message = JSON.parse(raw);
      sent.push(message);
      const value = runInContext(message.params.expression, context);
      queueMicrotask(() =>
        this.dispatchEvent(
          new MessageEvent("message", {
            data: JSON.stringify({
              id: message.id,
              result: { result: { value } },
            }),
          }),
        ),
      );
    }
    close() {
      this.readyState = 3;
    }
  }
  return {
    check: () => checkKeychain(new URL(target.webSocketDebuggerUrl), Socket),
    context,
    sent,
    reads: () => reads,
  };
}

describe("native iOS Keychain probe diagnostics", () => {
  it("sends the validated loopback Origin through Node's real WebSocket and satisfies the installed RN handshake guard", async () => {
    const require = createRequire(
      new URL("../apps/mobile/package.json", import.meta.url),
    );
    const middleware =
      require.resolve("@react-native/dev-middleware/package.json");
    const InspectorProxy = require(
      fileURLToPath(
        new URL(
          "./dist/inspector-proxy/InspectorProxy.js",
          pathToFileURL(middleware),
        ),
      ),
    ).default;
    type TestSocket = {
      send: (value: string) => void;
      on: (name: string, listener: (value: Buffer) => void) => void;
      terminate: () => void;
    };
    type TestServer = {
      removeAllListeners: (name: string) => void;
      on: (name: string, listener: (socket: TestSocket) => void) => void;
      emit: (
        name: string,
        socket: TestSocket,
        request: IncomingMessage,
      ) => void;
      handleUpgrade: (
        request: IncomingMessage,
        socket: Duplex,
        head: Buffer,
        listener: (client: TestSocket) => void,
      ) => void;
      clients: Set<TestSocket>;
      close: (callback: () => void) => void;
    };
    const server = createServer();
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Expected a loopback TCP address.");
    const origin = `http://127.0.0.1:${address.port}`;
    let rejected = 0;
    const proxy = new InspectorProxy(
      new URL(origin),
      undefined,
      {},
      {
        error() {
          rejected += 1;
        },
      },
    );
    const endpoints = proxy.createWebSocketListeners() as Record<
      string,
      TestServer
    >;
    const inspector = endpoints["/inspector/debug"];
    // Keep the installed verifyClient origin guard unchanged. Replace only
    // native-device handling with an intentional CDP refusal: this transport
    // test must never fabricate successful native Keychain evidence.
    inspector.removeAllListeners("connection");
    inspector.on("connection", (socket) =>
      socket.on("message", (raw) => {
        const message = JSON.parse(raw.toString());
        socket.send(
          JSON.stringify({
            id: message.id,
            result: { result: { value: false } },
          }),
        );
      }),
    );
    const origins: (string | undefined)[] = [];
    server.on("upgrade", (request, socket, head) => {
      origins.push(request.headers.origin);
      inspector.handleUpgrade(request, socket, head, (client) =>
        inspector.emit("connection", client, request),
      );
    });
    const url = new URL(
      `ws://127.0.0.1:${address.port}/inspector/debug?device=fixture&page=1`,
    );
    try {
      const blocked = new WebSocket(url);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Missing rejected-handshake event.")),
          2000,
        );
        blocked.addEventListener(
          "error",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
        blocked.addEventListener(
          "open",
          () => {
            clearTimeout(timer);
            reject(new Error("Missing Origin was accepted."));
          },
          { once: true },
        );
      });
      const rejectedBefore = rejected;
      const attemptsBefore = origins.length;
      expect(rejectedBefore).toBeGreaterThan(0);
      expect(origins.every((value) => value === undefined)).toBe(true);
      await expect(checkKeychain(url)).rejects.toThrow(
        "native-check-start-failed",
      );
      expect(origins.length).toBeGreaterThan(attemptsBefore);
      expect(
        origins.slice(attemptsBefore).every((value) => value === origin),
      ).toBe(true);
      expect(rejected).toBe(rejectedBefore);
    } finally {
      for (const endpoint of Object.values(endpoints)) {
        for (const socket of endpoint.clients) socket.terminate();
        await new Promise<void>((resolve) => endpoint.close(resolve));
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it("accepts the installed modern producer's absent vm only with nativePageReloads, while retaining actual Hermes verification", async () => {
    expect(Object.hasOwn(modernTarget, "vm")).toBe(false);
    expect(selectWhimwayTarget([modernTarget], endpoint)?.toString()).toBe(
      target.webSocketDebuggerUrl,
    );
    expect(
      selectWhimwayTarget([{ ...modernTarget, vm: "" }], endpoint)?.toString(),
    ).toBe(target.webSocketDebuggerUrl);
    // Discovery is not engine proof. The native expression still refuses a
    // target whose actual running JS environment has no HermesInternal.
    const error = await runtime({ hermes: false })
      .check()
      .catch((caught: unknown) => caught);
    expect(checkDiagnostic(error)).toEqual({
      stage: "module",
      reason: "hermes-not-initialized",
    });
  });
  it.each([
    { ...modernTarget, reactNative: { logicalDeviceId: "simulator" } },
    {
      ...modernTarget,
      reactNative: {
        ...modernTarget.reactNative,
        capabilities: { nativePageReloads: false },
      },
    },
    { ...modernTarget, vm: "", reactNative: { logicalDeviceId: "simulator" } },
    { ...modernTarget, vm: "V8" },
    { ...modernTarget, vm: "JavaScriptCore" },
    { ...modernTarget, vm: "unknown" },
    { ...modernTarget, vm: null },
    { ...modernTarget, vm: undefined },
    { ...modernTarget, type: "page" },
    { ...modernTarget, appId: "com.other.app" },
  ])(
    "rejects absent modern capabilities, explicit unknown/non-Hermes vm or foreign target metadata %#",
    (metadata) => {
      expect(selectWhimwayTarget([metadata], endpoint)).toBeNull();
    },
  );
  it("retains exact modern target identity, device binding and local debugger URL guards", () => {
    for (const metadata of [
      { ...modernTarget, id: "another-1" },
      {
        ...modernTarget,
        reactNative: {
          ...modernTarget.reactNative,
          logicalDeviceId: "another",
        },
      },
      {
        ...modernTarget,
        webSocketDebuggerUrl:
          "ws://example.com:8081/inspector/debug?device=simulator&page=1",
      },
      {
        ...modernTarget,
        webSocketDebuggerUrl: target.webSocketDebuggerUrl + "&extra=1",
      },
      {
        ...modernTarget,
        webSocketDebuggerUrl: target.webSocketDebuggerUrl + "#fragment",
      },
    ])
      expect(() => selectWhimwayTarget([metadata], endpoint)).toThrow(
        "unsafe-debugger-endpoint",
      );
    expect(() =>
      selectWhimwayTarget([modernTarget, modernTarget], endpoint),
    ).toThrow("ambiguous-whimway-target");
  });
  it.each([undefined, null, secret])(
    "accepts Expo's documented absent/string registration state %# without exporting it",
    async (registration) => {
      const fixture = runtime({ registration });
      const proof = await fixture.check();
      expect(proof).toEqual({
        registrationRead: true,
        installationRead: true,
        installationStable: true,
      });
      expect(JSON.stringify(proof)).not.toContain(secret);
      expect(fixture.reads()).toBe(2);
      expect(
        Object.keys(fixture.context).filter((key) =>
          key.startsWith("__whimwayCiKeychain_"),
        ),
      ).toEqual([]);
      for (const message of fixture.sent)
        expect(message).toMatchObject({
          method: "Runtime.evaluate",
          params: { returnByValue: true, silent: true },
        });
    },
  );
  it.each([
    [{ hermes: false }, "module", "hermes-not-initialized"],
    [{ module: false }, "module", "notifications-module-unavailable"],
    [{ registrationFails: true }, "registration", "registration-read-failed"],
    [
      { registration: { secret } },
      "registration",
      "invalid-registration-result",
    ],
    [
      { installationFailsAt: 1 },
      "installation",
      "installation-first-read-failed",
    ],
    [
      { installationFailsAt: 2 },
      "installation",
      "installation-second-read-failed",
    ],
    [
      { installation: [secret, secret] },
      "installation",
      "invalid-installation-result",
    ],
    [
      { installation: [validId, "87654321-1234-1234-1234-1234567890ab"] },
      "installation",
      "installation-not-stable",
    ],
  ] as const)(
    "identifies native failure stage %# without forwarding native data",
    async (options, stage, reason) => {
      const fixture = runtime(options);
      const error = await fixture.check().catch((caught: unknown) => caught);
      expect(checkDiagnostic(error)).toEqual({ stage, reason });
      expect(JSON.stringify(checkDiagnostic(error))).not.toContain(secret);
    },
  );
  it("accepts exactly one own local Hermes target and refuses ambiguous, foreign or remote inspectors", () => {
    expect(selectWhimwayTarget([target], endpoint)?.toString()).toBe(
      target.webSocketDebuggerUrl,
    );
    expect(
      selectWhimwayTarget([{ ...target, appId: "com.other.app" }], endpoint),
    ).toBeNull();
    for (const targets of [
      [target, target],
      [
        {
          ...target,
          webSocketDebuggerUrl:
            "ws://example.com:8081/inspector/debug?device=simulator&page=1",
        },
      ],
      [
        {
          ...target,
          webSocketDebuggerUrl:
            "ws://127.0.0.1:8082/inspector/debug?device=simulator&page=1",
        },
      ],
    ]) {
      expect(() => selectWhimwayTarget(targets, endpoint)).toThrow();
    }
  });
  it("replaces unknown exceptions with a fixed diagnostic and keeps CLI stdout to the three booleans", () => {
    expect(checkDiagnostic(new Error(secret))).toEqual({
      stage: "probe",
      reason: "unclassified-failure",
    });
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(
          new URL(
            "../scripts/check-ios-simulator-keychain.mjs",
            import.meta.url,
          ),
        ),
      ],
      {
        env: { ...process.env, CI: "false" },
        encoding: "utf8",
        timeout: 5000,
      },
    );
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({
      registrationRead: false,
      installationRead: false,
      installationStable: false,
    });
    expect(JSON.parse(result.stderr)).toEqual({
      stage: "guard",
      reason: "ci-apple-simulator-required",
    });
    expect(result.stdout + result.stderr).not.toContain(secret);
  });
});
