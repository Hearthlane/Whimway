/* eslint-disable @typescript-eslint/no-require-imports -- Metro requires CommonJS. */
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");
const config = getDefaultConfig(__dirname);
const repositoryRoot = path.resolve(__dirname, "../..");
config.watchFolders = [repositoryRoot];
// Keep React and native packages on the mobile app's compatible SDK versions.
config.resolver.nodeModulesPaths = [path.resolve(__dirname, "node_modules")];
// Watch shared source, not server bundles, browser traces, captured images,
// generated native projects, or the independent web client's dependencies.
// Those frequently-written trees otherwise cause continuous Metro invalidation.
const escapePattern = (value) => value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
const ignored = [
  ".next",
  ".git",
  "node_modules",
  "docs/screenshots",
  "test-results",
  "test-results-mobile",
  "playwright-report",
  "apps/mobile/dist",
  "apps/mobile/test-dist",
  "apps/mobile/dist-qa",
  "apps/mobile/android",
  "apps/mobile/ios",
];
config.resolver.blockList = [
  ...(Array.isArray(config.resolver.blockList)
    ? config.resolver.blockList
    : config.resolver.blockList
      ? [config.resolver.blockList]
      : []),
  ...ignored.map(
    (directory) =>
      new RegExp(
        "^" +
          escapePattern(path.resolve(repositoryRoot, directory)) +
          "(?:[\\\\/].*)?$",
      ),
  ),
];
// Local browser inspection of the native UI uses the same API origin. This
// development-only proxy is not included in Expo exports or native binaries.
const http = require("node:http");
config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => (req, res, next) => {
    if (!req.url?.startsWith("/api/")) return middleware(req, res, next);
    const upstream = new URL(req.url, "http://127.0.0.1:3000");
    const proxy = http.request(
      upstream,
      { method: req.method, headers: req.headers },
      (response) => {
        res.writeHead(response.statusCode || 502, response.headers);
        response.pipe(res);
      },
    );
    proxy.on("error", () => {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: "Start the Whimway backend on port 3000 to preview planning.",
          code: "BACKEND_UNAVAILABLE",
        }),
      );
    });
    req.pipe(proxy);
  },
};
module.exports = config;
