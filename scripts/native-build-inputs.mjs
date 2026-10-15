// Compare this push, rather than the cumulative pull-request diff. Unknown
// paths and missing history fail toward building, never toward skipping source.
import { readFileSync, appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { isServerOnlyProviderChange } from "./reuse-native-build.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const shaPattern = /^[a-f0-9]{40}$/;
function canSkipNative(file) {
  return (
    file === "README.md" ||
    file.startsWith("docs/") ||
    file.startsWith("tests/") ||
    file.startsWith("e2e-mobile/") ||
    isServerOnlyProviderChange(file)
  );
}
export function nativeInputsChanged(before, after, cwd = root) {
  if (
    !shaPattern.test(before ?? "") ||
    !shaPattern.test(after ?? "") ||
    /^0+$/.test(before)
  )
    return true;
  const diff = spawnSync(
    "git",
    [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--no-renames",
      "--name-only",
      "-z",
      before,
      after,
      "--",
    ],
    { cwd, encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 10000 },
  );
  if (diff.error || diff.status !== 0) return true;
  return diff.stdout
    .split("\0")
    .filter(Boolean)
    .some((file) => !canSkipNative(file));
}
export function main(
  args = process.argv.slice(2),
  env = process.env,
  cwd = root,
) {
  let native = true;
  try {
    if (args.length > 2)
      throw new Error("Unexpected change-detector arguments");
    const event = env.GITHUB_EVENT_PATH
      ? JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8"))
      : {};
    native = nativeInputsChanged(
      args[0] || event.before,
      args[1] || event.after || event.pull_request?.head?.sha,
      cwd,
    );
  } catch {
    // The native workflow remains the safe fallback for unavailable metadata.
  }
  const output = `native=${native}\n`;
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, output);
  process.stdout.write(output);
  return native;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
