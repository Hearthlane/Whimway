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

const root = fileURLToPath(new URL("../", import.meta.url));
const mobile = path.join(root, "apps/mobile");
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
function shutdown(code) {
  if (stopping) return;
  stopping = true;
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
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
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
if (!stopping) {
  writeFileSync(
    readyFile,
    JSON.stringify({
      backend: true,
      metro: true,
      mode: "synthetic",
      at: new Date().toISOString(),
    }),
  );
  console.log(
    "Native fixture backend and Metro are ready; all provider data is synthetic.",
  );
}
