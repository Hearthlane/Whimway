// Local QA server for Expo's exported RN Web screens; never deploy this proxy.
import http from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const mobile = fileURLToPath(new URL("../apps/mobile/", import.meta.url));
const root = path.join(mobile, "dist-qa");
const host = "127.0.0.1";
const port = 8082;
if (process.argv.includes("--build")) {
  const child = spawn(
    process.execPath,
    [
      path.join(mobile, "node_modules/expo/bin/cli"),
      "export",
      "--dev",
      "--platform",
      "web",
      "--output-dir",
      "dist-qa",
    ],
    {
      cwd: mobile,
      stdio: "inherit",
      env: {
        ...process.env,
        EXPO_NO_TELEMETRY: "1",
        EXPO_PUBLIC_API_URL: `http://${host}:${port}`,
      },
    },
  );
  const code = await new Promise((resolve) => child.once("exit", resolve));
  if (code !== 0) process.exit(code ?? 1);
}
if (!existsSync(path.join(root, "index.html")))
  throw new Error(
    "Build the local development preview first: node scripts/serve-mobile-preview.mjs --build",
  );
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2",
};
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${host}:${port}`);
  if (url.pathname.startsWith("/api/")) {
    const proxy = http.request(
      new URL(req.url, "http://127.0.0.1:3000"),
      { method: req.method, headers: req.headers },
      (response) => {
        if (res.destroyed) return response.destroy();
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
      },
    );
    proxy.on("error", () => {
      if (res.destroyed) return;
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: "Start the local Whimway backend on port 3000.",
          code: "BACKEND_UNAVAILABLE",
        }),
      );
    });
    req.pipe(proxy);
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405);
    res.end();
    return;
  }
  try {
    let file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
    const relative = path.relative(root, file);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      res.writeHead(400);
      res.end();
      return;
    }
    if (!path.extname(url.pathname)) file = path.join(root, "index.html");
    const details = await stat(file);
    if (!details.isFile()) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, {
      "Content-Type": mime[path.extname(file)] ?? "application/octet-stream",
      "Content-Length": details.size,
      "Cache-Control": "no-store",
    });
    if (req.method === "HEAD") res.end();
    else createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
server.listen(port, host, () =>
  process.stdout.write(
    `Exported React Native web preview: http://${host}:${port}\n`,
  ),
);
