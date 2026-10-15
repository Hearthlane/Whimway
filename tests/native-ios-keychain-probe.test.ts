import { describe, expect, it } from "vitest";
import { createContext, runInContext } from "node:vm";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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
