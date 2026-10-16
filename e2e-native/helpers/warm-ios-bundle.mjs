// Prepare only Metro's local development bundle. This never executes the
// downloaded source or substitutes for the native UI and Keychain checks.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { Script } from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

// Exact GET retained in run 38673383523's RCTMultipartDataTask/CFNetwork logs.
// Its HTTP200 streaming response timed out before the cold bundle completed.
export const iosBundleUrl =
  "http://127.0.0.1:8081/node_modules/expo-router/entry.bundle?platform=ios&dev=true&hot=false&lazy=true&transform.engine=hermes&transform.bytecode=1&transform.routerRoot=app&unstable_transformProfile=hermes-stable";
const deadlineMs = 360000;
const maximumBytes = 128 * 1024 * 1024;
const bundleTypes = new Set([
  "application/javascript",
  "text/javascript",
  "application/x-metro-bytecode-bundle",
]);
const reasons = new Set([
  "deadline-exceeded",
  "http-status",
  "invalid-content-type",
  "missing-body",
  "oversized-bundle",
  "empty-bundle",
  "invalid-bundle",
  "request-failed",
]);
function refuse(reason) {
  const error = new Error(reason);
  error.warmReason = reason;
  return error;
}
function bundleFormat(bytes) {
  // Same header used by RN JSBundleType.cpp and Expo exportHermes.js. Header
  // validation alone establishes format, not successful native execution.
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 8).toString("hex") === "c61fbc03c103191f"
  ) {
    if (bytes.readUInt32LE(8) === 0) throw refuse("invalid-bundle");
    return "hermes-header";
  }
  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw refuse("invalid-bundle");
  }
  // Installed Metro's getPreludeCode.js emits this prelude; its module wrapper
  // uses __d. Reject HTTP200 error text, HTML, JSON and truncated JS responses.
  if (
    !/\bvar\s+__BUNDLE_START_TIME__\s*=/.test(source.slice(0, 4096)) ||
    !/\b__d\s*\(/.test(source)
  )
    throw refuse("invalid-bundle");
  try {
    new Script(source, { filename: "local-ios-metro-warm.bundle" });
  } catch {
    throw refuse("invalid-bundle");
  }
  return "javascript-syntax";
}

export async function warmIosBundle({
  fetchImpl = fetch,
  timeoutMs = deadlineMs,
  maxBytes = maximumBytes,
} = {}) {
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > deadlineMs ||
    !Number.isInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > maximumBytes
  )
    throw new Error("Invalid bounded warm configuration.");
  const started = performance.now();
  const evidence = {
    scope: "local-host-metro-warm-only",
    started_at: new Date().toISOString(),
    elapsed_ms: 0,
    status: null,
    mime_type: null,
    bytes: 0,
    sha256: null,
    format: null,
    ok: false,
    reason: "request-failed",
  };
  const controller = new AbortController();
  let reader,
    timer,
    timedOut = false;
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(refuse("deadline-exceeded"));
      }, timeoutMs);
    });
    const operation = (async () => {
      const response = await fetchImpl(iosBundleUrl, {
        signal: controller.signal,
        redirect: "error",
        cache: "no-store",
        headers: { Accept: "application/javascript" },
      });
      controller.signal.throwIfAborted();
      evidence.status = response.status;
      if (response.status !== 200) throw refuse("http-status");
      const mime = response.headers
        .get("content-type")
        ?.split(";", 1)[0]
        .trim()
        .toLowerCase();
      if (!bundleTypes.has(mime)) throw refuse("invalid-content-type");
      evidence.mime_type = mime;
      if (Number(response.headers.get("content-length")) > maxBytes)
        throw refuse("oversized-bundle");
      if (!response.body) throw refuse("missing-body");
      reader = response.body.getReader();
      const chunks = [],
        hash = createHash("sha256");
      for (;;) {
        const { done, value } = await reader.read();
        controller.signal.throwIfAborted();
        if (done) break;
        evidence.bytes += value.byteLength;
        if (evidence.bytes > maxBytes) throw refuse("oversized-bundle");
        chunks.push(Buffer.from(value));
        hash.update(value);
      }
      if (!evidence.bytes) throw refuse("empty-bundle");
      evidence.format = bundleFormat(Buffer.concat(chunks, evidence.bytes));
      if (timedOut || performance.now() - started > timeoutMs)
        throw refuse("deadline-exceeded");
      evidence.sha256 = hash.digest("hex");
      evidence.ok = true;
      evidence.reason = "verified";
    })();
    await Promise.race([operation, timeout]);
  } catch (error) {
    evidence.reason = timedOut
      ? "deadline-exceeded"
      : reasons.has(error?.warmReason)
        ? error.warmReason
        : "request-failed";
  } finally {
    clearTimeout(timer);
    controller.abort();
    // Cancellation must not itself prolong the bounded preparation step.
    if (reader) void reader.cancel().catch(() => {});
    evidence.elapsed_ms = Math.round(performance.now() - started);
  }
  return { ...evidence };
}

async function main() {
  if (
    process.env.CI !== "true" ||
    process.platform !== "darwin" ||
    process.argv.length !== 2
  )
    throw new Error(
      "This preparation requires the CI Apple host and no arguments.",
    );
  const output = fileURLToPath(
    new URL(
      "../../native-test-artifacts/ios-metro-bundle-warm.json",
      import.meta.url,
    ),
  );
  mkdirSync(path.dirname(output), { recursive: true });
  const evidence = await warmIosBundle();
  writeFileSync(output, JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence));
  if (!evidence.ok) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => {
    console.error(
      "iOS local bundle preparation failed its host guard or evidence write.",
    );
    process.exitCode = 1;
  });
