// Serves the exported web build (dist/) and proxies /api/* to the Whimway API, so the
// browser sees a single origin — exactly like a production deployment behind one host.
// Usage: node scripts/serve-web.mjs [port] [apiOrigin]
import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";

const port = Number(process.argv[2] ?? 8090);
const api = new URL(process.argv[3] ?? "http://localhost:3000");
const root = path.resolve(import.meta.dirname, "..", "dist");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".ico": "image/x-icon", ".ttf": "font/ttf", ".svg": "image/svg+xml" };

http
  .createServer((req, res) => {
    if (req.url.startsWith("/api/")) {
      const upstream = http.request(
        { hostname: api.hostname, port: api.port, path: req.url, method: req.method, headers: req.headers },
        (r) => {
          res.writeHead(r.statusCode ?? 502, r.headers);
          r.pipe(res);
        },
      );
      upstream.on("error", () => {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "The Whimway API isn't running.", code: "API_DOWN" }));
      });
      req.pipe(upstream);
      return;
    }
    const clean = path.normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
    let file = path.join(root, clean);
    if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) file = path.join(root, "index.html");
    res.writeHead(200, { "Content-Type": types[path.extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  })
  .listen(port, () => console.log(`Whimway app (web) on http://localhost:${port} → API ${api.origin}`));
