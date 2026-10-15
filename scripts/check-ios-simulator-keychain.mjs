// Run only against the disposable CI simulator's existing Whimway Hermes
// process. Never print CDP payloads, native exceptions, IDs, or stored values.
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

const applicationId = "com.example.whimway";
const discoveryTimeoutMs = 30000;
const requestTimeoutMs = 4000;
const evaluationTimeoutMs = 15000;
const maximumMessageBytes = 256 * 1024;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Every exported diagnostic is one of these fixed codes. Never forward native
// exceptions, CDP payloads, target labels, URLs, installation IDs or stored data.
const diagnosticStages = new Map([
  ...[
    "invalid-arguments",
    "invalid-local-port",
    "ci-apple-simulator-required",
  ].map((reason) => [reason, "guard"]),
  ...[
    "invalid-discovery-response",
    "ambiguous-whimway-target",
    "missing-local-debugger",
    "unsafe-debugger-endpoint",
    "whimway-hermes-not-found",
  ].map((reason) => [reason, "discovery"]),
  ...[
    "native-check-timeout",
    "native-check-send-failed",
    "invalid-debugger-message",
    "native-check-failed",
    "native-check-start-failed",
    "native-check-cleanup-failed",
    "invalid-native-proof",
    "debugger-connection-failed",
    "debugger-closed-before-result",
  ].map((reason) => [reason, "debugger"]),
  ["hermes-not-initialized", "module"],
  ["notifications-module-unavailable", "module"],
  ["native-module-access-failed", "module"],
  ["registration-read-failed", "registration"],
  ["invalid-registration-result", "registration"],
  ["installation-first-read-failed", "installation"],
  ["installation-second-read-failed", "installation"],
  ["invalid-installation-result", "installation"],
  ["installation-not-stable", "installation"],
]);
export function checkDiagnostic(error) {
  const reason = error instanceof Error ? error.message : undefined;
  return diagnosticStages.has(reason)
    ? { stage: diagnosticStages.get(reason), reason }
    : { stage: "probe", reason: "unclassified-failure" };
}

export function metroEndpoint(port = "8081") {
  if (!/^\d{1,5}$/.test(port) || Number(port) < 1024 || Number(port) > 65535)
    throw new Error("invalid-local-port");
  return new URL(`http://127.0.0.1:${Number(port)}/json/list`);
}

export function selectWhimwayTarget(targets, endpoint) {
  if (!Array.isArray(targets)) throw new Error("invalid-discovery-response");
  const ownTargets = targets.filter(
    (target) =>
      target &&
      typeof target === "object" &&
      target.appId === applicationId &&
      target.type === "node" &&
      target.reactNative &&
      typeof target.reactNative === "object" &&
      // RN 0.86 advertises its modern bridgeless HostTarget with an empty VM
      // label; the actual Hermes engine is checked inside that process below.
      (target.vm === "Hermes" ||
        (target.vm === "" &&
          target.reactNative.capabilities?.nativePageReloads === true)),
  );
  if (ownTargets.length > 1) throw new Error("ambiguous-whimway-target");
  if (!ownTargets.length) return null;
  const target = ownTargets[0];
  if (typeof target.webSocketDebuggerUrl !== "string")
    throw new Error("missing-local-debugger");
  let socket;
  try {
    socket = new URL(target.webSocketDebuggerUrl);
  } catch {
    throw new Error("unsafe-debugger-endpoint");
  }
  const device = socket.searchParams.get("device"),
    page = socket.searchParams.get("page");
  if (
    socket.protocol !== "ws:" ||
    socket.hostname !== "127.0.0.1" ||
    socket.port !== endpoint.port ||
    socket.username ||
    socket.password ||
    socket.hash ||
    socket.pathname !== "/inspector/debug" ||
    [...socket.searchParams.keys()].sort().join(",") !== "device,page" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(device ?? "") ||
    !/^\d{1,10}$/.test(page ?? "") ||
    target.reactNative.logicalDeviceId !== device ||
    target.id !== `${device}-${page}`
  )
    throw new Error("unsafe-debugger-endpoint");
  return socket;
}

// Native methods are invoked on the actual app's JSI module, so this checks the
// app's signature and default Keychain group. No registration state is enabled.
const expression = `(async () => {
  const failed = failure => ({ failure });
  if (!globalThis.HermesInternal) return failed('hermes-not-initialized');
  const module = globalThis.expo?.modules?.NotificationsServerRegistrationModule;
  if (!module || typeof module.getRegistrationInfoAsync !== 'function' || typeof module.getInstallationIdAsync !== 'function')
    return failed('notifications-module-unavailable');
  let registration;
  try {
    registration = await module.getRegistrationInfoAsync();
  } catch { return failed('registration-read-failed'); }
  // The installed Expo type explicitly permits both undefined and null when
  // registration state is absent. Neither empty state is a Keychain failure.
  if (registration !== null && registration !== undefined && typeof registration !== 'string')
    return failed('invalid-registration-result');
  let first, second;
  try { first = await module.getInstallationIdAsync(); }
  catch { return failed('installation-first-read-failed'); }
  try { second = await module.getInstallationIdAsync(); }
  catch { return failed('installation-second-read-failed'); }
  if (typeof first !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(first))
    return failed('invalid-installation-result');
  if (first !== second) return failed('installation-not-stable');
  return { registrationRead: true, installationRead: true, installationStable: true };
})().catch(() => ({ failure: 'native-module-access-failed' }))`;

/**
 * @param {URL} socketUrl
 * @param {new (url: string) => Pick<WebSocket, "readyState" | "addEventListener" | "send" | "close">} Socket
 */
export async function checkKeychain(socketUrl, Socket = WebSocket) {
  // Recheck transport even when this function is imported independently.
  const endpoint = metroEndpoint(socketUrl.port);
  if (
    socketUrl.protocol !== "ws:" ||
    socketUrl.hostname !== endpoint.hostname ||
    socketUrl.username ||
    socketUrl.password ||
    socketUrl.hash ||
    socketUrl.pathname !== "/inspector/debug"
  )
    throw new Error("unsafe-debugger-endpoint");
  return new Promise((resolve, reject) => {
    const socket = new Socket(socketUrl.toString());
    let settled = false;
    let poll,
      requestId = 0,
      pendingRequest;
    const proofKey = `__whimwayCiKeychain_${randomUUID().replaceAll("-", "")}`;
    const quotedKey = JSON.stringify(proofKey);
    const timeout = setTimeout(
      () => finish(new Error("native-check-timeout")),
      evaluationTimeoutMs,
    );
    function finish(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(poll);
      if (error && socket.readyState === 1) {
        try {
          socket.send(
            JSON.stringify({
              id: ++requestId,
              method: "Runtime.evaluate",
              params: {
                expression: `delete globalThis[${quotedKey}]`,
                returnByValue: true,
                silent: true,
              },
            }),
          );
        } catch {}
      }
      // Stop a pending connection too; no inspector session should outlive this
      // bounded check. Ignore close errors instead of logging remote data.
      try {
        socket.close();
      } catch {}
      if (error) reject(error);
      else resolve(result);
    }
    function evaluate(source, phase) {
      const id = ++requestId;
      pendingRequest = { id, phase };
      socket.send(
        JSON.stringify({
          id,
          method: "Runtime.evaluate",
          params: {
            expression: source,
            returnByValue: true,
            silent: true,
          },
        }),
      );
    }
    socket.addEventListener("open", () => {
      try {
        // Hermes versions differ in awaitPromise support. Keep only a pending
        // sentinel or sanitized booleans in a unique, temporary JS property.
        evaluate(
          `(() => { if (Object.hasOwn(globalThis, ${quotedKey})) return false;
          globalThis[${quotedKey}] = { pending: true };
          ${expression}.then(value => { if (Object.hasOwn(globalThis, ${quotedKey})) globalThis[${quotedKey}] = value; });
          return true; })()`,
          "start",
        );
      } catch {
        finish(new Error("native-check-send-failed"));
      }
    });
    socket.addEventListener("message", (event) => {
      try {
        if (
          typeof event.data !== "string" ||
          Buffer.byteLength(event.data) > maximumMessageBytes
        )
          return finish(new Error("invalid-debugger-message"));
        const message = JSON.parse(event.data);
        if (message.id !== pendingRequest?.id) return;
        if (message.error || message.result?.exceptionDetails)
          return finish(new Error("native-check-failed"));
        const value = message.result?.result?.value;
        if (pendingRequest.phase === "start") {
          if (value !== true)
            return finish(new Error("native-check-start-failed"));
          evaluate(`globalThis[${quotedKey}]`, "read");
          return;
        }
        if (pendingRequest.phase === "cleanup") {
          if (value !== true)
            return finish(new Error("native-check-cleanup-failed"));
          return finish(null, {
            registrationRead: true,
            installationRead: true,
            installationStable: true,
          });
        }
        if (value?.pending === true && Object.keys(value).length === 1) {
          poll = setTimeout(() => {
            try {
              evaluate(`globalThis[${quotedKey}]`, "read");
            } catch {
              finish(new Error("native-check-send-failed"));
            }
          }, 100);
          return;
        }
        if (
          value &&
          typeof value === "object" &&
          Object.keys(value).join(",") === "failure" &&
          ["module", "registration", "installation"].includes(
            diagnosticStages.get(value.failure),
          )
        )
          return finish(new Error(value.failure));
        const keys = [
          "registrationRead",
          "installationRead",
          "installationStable",
        ];
        if (
          !value ||
          typeof value !== "object" ||
          Object.keys(value).sort().join(",") !== [...keys].sort().join(",") ||
          !keys.every((key) => value[key] === true)
        )
          return finish(new Error("invalid-native-proof"));
        // The final payload is constructed locally after removing the temporary
        // property; no native strings or arbitrary target values are forwarded.
        evaluate(`delete globalThis[${quotedKey}]`, "cleanup");
      } catch {
        finish(new Error("invalid-debugger-message"));
      }
    });
    socket.addEventListener("error", () =>
      finish(new Error("debugger-connection-failed")),
    );
    socket.addEventListener("close", () =>
      finish(new Error("debugger-closed-before-result")),
    );
  });
}

export async function runCheck(port = "8081") {
  if (process.env.CI !== "true" || process.platform !== "darwin")
    throw new Error("ci-apple-simulator-required");
  const endpoint = metroEndpoint(port);
  const deadline = Date.now() + discoveryTimeoutMs;
  let socket;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(endpoint, {
        signal: AbortSignal.timeout(
          Math.min(requestTimeoutMs, deadline - Date.now()),
        ),
        redirect: "error",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("discovery-unavailable");
      const contentLength = Number(response.headers.get("content-length"));
      if (contentLength > maximumMessageBytes)
        throw new Error("invalid-discovery-response");
      if (!response.body) throw new Error("invalid-discovery-response");
      const reader = response.body.getReader(),
        chunks = [];
      let bytes = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maximumMessageBytes) {
          await reader.cancel();
          throw new Error("invalid-discovery-response");
        }
        chunks.push(Buffer.from(value));
      }
      const text = Buffer.concat(chunks).toString("utf8");
      socket = selectWhimwayTarget(JSON.parse(text), endpoint);
      if (socket) break;
    } catch (error) {
      if (
        [
          "ambiguous-whimway-target",
          "unsafe-debugger-endpoint",
          "missing-local-debugger",
          "invalid-discovery-response",
        ].includes(error?.message)
      )
        throw error;
      // Metro may still be booting. Retry only bounded, local discovery errors.
    }
    await delay(Math.min(500, Math.max(0, deadline - Date.now())));
  }
  if (!socket) throw new Error("whimway-hermes-not-found");
  return checkKeychain(socket);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    if (process.argv.length > 3) throw new Error("invalid-arguments");
    console.log(JSON.stringify(await runCheck(process.argv[2])));
    console.error(JSON.stringify({ stage: "complete", reason: "verified" }));
  } catch (error) {
    // Separate stderr contains only allowlisted codes, never the exception.
    console.error(JSON.stringify(checkDiagnostic(error)));
    console.log(
      JSON.stringify({
        registrationRead: false,
        installationRead: false,
        installationStable: false,
      }),
    );
    process.exitCode = 1;
  }
}
