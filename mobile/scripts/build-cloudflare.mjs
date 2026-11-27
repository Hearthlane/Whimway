// Builds the web app for Cloudflare Pages with the public settings in .env.cloudflare,
// without writing any .env file that would change other local builds.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, renameSync, statSync, writeFileSync, existsSync } from "node:fs";
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
if (run.status !== 0) process.exit(run.status ?? 1);

// Cloudflare's asset server loops redirecting "@" ⇄ "%40" in paths, so fonts and icons under
// assets/node_modules/@scope/… never load. Move them to assets/vendor/_at_scope/… and point
// every reference in the build at the new paths.
const dist = path.join(root, "dist");
const from = path.join(dist, "assets", "node_modules");
const to = path.join(dist, "assets", "vendor");
if (existsSync(from)) {
  renameSync(from, to);
  for (const name of readdirSync(to)) if (name.startsWith("@")) renameSync(path.join(to, name), path.join(to, `_at_${name.slice(1)}`));
  const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(path.join(dir, n)).isDirectory() ? walk(path.join(dir, n)) : [path.join(dir, n)]));
  let changed = 0;
  for (const file of walk(dist).filter((f) => /\.(js|html|css|json|map)$/.test(f))) {
    const text = readFileSync(file, "utf8");
    const next = text.replaceAll("assets/node_modules/@", "assets/vendor/_at_").replaceAll("assets/node_modules/", "assets/vendor/");
    if (next !== text) (writeFileSync(file, next), changed++);
  }
  console.log(`Moved assets/node_modules to assets/vendor (${changed} files updated).`);
}
