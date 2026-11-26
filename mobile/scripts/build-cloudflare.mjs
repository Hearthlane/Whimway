// Builds the web app for Cloudflare Pages with the public settings in .env.cloudflare,
// without writing any .env file that would change other local builds.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const vars = Object.fromEntries(
  readFileSync(path.join(root, ".env.cloudflare"), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
);
const run = spawnSync("npx", ["expo", "export", "--platform", "web", "--output-dir", "dist"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, ...vars, CI: "1" },
});
process.exit(run.status ?? 1);
