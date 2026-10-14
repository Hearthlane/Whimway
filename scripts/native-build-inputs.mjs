// Compare this push, rather than the cumulative pull-request diff. Missing
// event history fails safely toward building, never toward skipping source.
import { readFileSync, appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const event = process.env.GITHUB_EVENT_PATH
  ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"))
  : {};
const before = process.argv[2] || event.before;
const after = process.argv[3] || event.after || event.pull_request?.head?.sha;
let native = true;
const sha = /^[a-f0-9]{40}$/;
if (sha.test(before ?? "") && sha.test(after ?? "") && !/^0+$/.test(before)) {
  const diff = spawnSync("git", ["diff", "--name-only", before, after], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (!diff.error && diff.status === 0)
    native = diff.stdout
      .split(/\r?\n/)
      .some((file) =>
        /^(apps\/mobile\/|packages\/|lib\/|app\/api\/|e2e-native\/|package(?:-lock)?\.json$|scripts\/(?:native-build-inputs|reuse-native-build|start-native-test-services|verify-native-permissions)\.mjs$|scripts\/run-android-native-qa\.sh$|\.github\/workflows\/native\.yml$)/.test(
          file,
        ),
      );
}
const output = `native=${native}\n`;
if (process.env.GITHUB_OUTPUT)
  appendFileSync(process.env.GITHUB_OUTPUT, output);
process.stdout.write(output);
