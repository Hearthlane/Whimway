// Local-only fixture runtime for hosted native UI tests; not a deployment server.
import { spawn } from "node:child_process";
import {
  mkdirSync,
  openSync,
  closeSync,
  existsSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { startIOSViewportServer } from "./native-ios-viewport-server.mjs";
import { startIOSGestureBroker } from "./native-ios-gesture-server.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const mobile = path.join(root, "apps/mobile");

// Separate listeners keep UI observation read-only and real gestures subject
// to the broker's one-dispatch-per-observation guarantee.
export async function startIOSNativeTestBridges({
  artifactDirectory,
  viewportOptions = {},
  gestureOptions = {},
}) {
  let viewport;
  let gestures;
  const close = () => {
    for (const server of [gestures, viewport]) {
      server?.close();
      server?.closeAllConnections();
    }
  };
  try {
    viewport = await startIOSViewportServer({
      artifactDirectory: path.join(artifactDirectory, "ios-plan-viewport"),
      ...viewportOptions,
    });
    gestures = await startIOSGestureBroker({
      artifactDirectory: path.join(artifactDirectory, "ios-plan-gestures"),
      ...gestureOptions,
      consumeObservation: viewport.consumeObservation,
    });
    for (const server of [viewport, gestures]) {
      const address = server.address();
      if (!address || typeof address !== "object")
        throw new Error("Native UI bridge did not listen.");
      const response = await fetch(`http://127.0.0.1:${address.port}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (!response.ok || (await response.json()).ok !== true)
        throw new Error("Native UI bridge health check failed.");
    }
    return { viewport, gestures, close };
  } catch (error) {
    close();
    throw error;
  }
}

export async function startNativeTestServices() {
  const artifacts = path.join(root, "native-test-artifacts");
  mkdirSync(artifacts, { recursive: true });
  const readyFile = path.join(artifacts, "ready.json");
  if (existsSync(readyFile)) unlinkSync(readyFile);
  const processes = [];
  function start(name, args, cwd, env) {
    const log = openSync(path.join(artifacts, name + ".log"), "w");
    const child = spawn(process.execPath, args, {
      cwd,
      env: { ...process.env, EXPO_NO_TELEMETRY: "1", ...env },
      stdio: ["ignore", log, log],
    });
    closeSync(log);
    processes.push(child);
    child.on("error", (error) => {
      console.error(name + " could not start: " + error.name);
      shutdown(1);
    });
    child.on("exit", (code) => {
      if (!stopping) {
        console.error(name + " stopped before native QA finished: " + code);
        shutdown(1);
      }
    });
  }
  let stopping = false;
  let iosBridges;
  function shutdown(code) {
    if (stopping) return;
    stopping = true;
    iosBridges?.close();
    if (existsSync(readyFile)) unlinkSync(readyFile);
    for (const child of processes) child.kill("SIGTERM");
    process.exitCode = code;
  }
  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
  start(
    "backend",
    [
      path.join(root, "node_modules/next/dist/bin/next"),
      "dev",
      "--hostname",
      "127.0.0.1",
    ],
    root,
    {
      NODE_ENV: "development",
      WHIMWAY_DEMO_MODE: "true",
      NEXT_PUBLIC_WHIMWAY_DEMO_MODE: "true",
      DAILY_GUEST_GENERATIONS: "100",
      DAILY_REMIX_LIMIT: "100",
      GLOBAL_DAILY_PROVIDER_LIMIT: "1000",
      APP_ORIGIN: "",
    },
  );
  start(
    "metro",
    [
      // Expo binds --localhost using DNS. Prefer IPv4 so both the health probe
      // and adb reverse reach that same loopback listener on hosted runners.
      "--dns-result-order=ipv4first",
      path.join(mobile, "node_modules/expo/bin/cli"),
      "start",
      "--dev-client",
      "--localhost",
      "--port",
      "8081",
    ],
    mobile,
    {
      EXPO_PUBLIC_API_URL: "http://127.0.0.1:3000",
      REACT_NATIVE_PACKAGER_HOSTNAME: "127.0.0.1",
      // CI exercises the native app, without preparing an unused desktop
      // React Native DevTools Electron shell on a headless Linux runner.
      EXPO_UNSTABLE_HEADLESS: "1",
    },
  );
  const deadline = Date.now() + 180000;
  for (const url of [
    "http://127.0.0.1:3000/api/status",
    "http://127.0.0.1:8081/status",
  ]) {
    let ready = false;
    while (!stopping && Date.now() < deadline) {
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(10000),
        });
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!ready) {
      console.error("Native fixture service did not become ready: " + url);
      shutdown(1);
      break;
    }
  }
  if (!stopping && process.env.WHIMWAY_IOS_UI_OBSERVER === "1") {
    try {
      if (process.platform !== "darwin")
        throw new Error("Expected an iOS runner");
      iosBridges = await startIOSNativeTestBridges({
        artifactDirectory: artifacts,
      });
      if (stopping) iosBridges.close();
    } catch {
      console.error(
        "The local native UI observer and gesture broker could not start.",
      );
      shutdown(1);
    }
  }
  if (!stopping) {
    writeFileSync(
      readyFile,
      JSON.stringify({
        backend: true,
        metro: true,
        iosViewport: Boolean(iosBridges?.viewport),
        iosGestures: Boolean(iosBridges?.gestures),
        mode: "synthetic",
        at: new Date().toISOString(),
      }),
    );
    console.log(
      "Native fixture backend and Metro are ready; all provider data is synthetic.",
    );
  }
  return { shutdown, readyFile };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await startNativeTestServices();
