import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { sourceCompatibility } from "../scripts/reuse-native-build.mjs";

const directories: string[] = [];
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "whimway-reuse-"));
  directories.push(root);
  const git = (...args: string[]) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  const file = (name: string, contents: string) => {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), contents);
  };
  const commit = () => {
    git("add", ".");
    git(
      "-c",
      "user.name=Whimway test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-m",
      "fixture",
    );
    return git("rev-parse", "HEAD");
  };
  git("init");
  file("README.md", "Original documentation");
  file("apps/mobile/app/index.tsx", "export default 'original screen';");
  file("apps/mobile/package-lock.json", '{"version":"original-sdk"}');
  const base = commit();
  return { root, git, file, commit, base };
}
afterEach(() => {
  for (const root of directories.splice(0)) {
    const absolute = path.resolve(root);
    if (
      path.dirname(absolute) !== path.resolve(tmpdir()) ||
      !path.basename(absolute).startsWith("whimway-reuse-")
    )
      throw new Error("Refusing unexpected test cleanup path");
    rmSync(absolute, { recursive: true, force: true });
  }
});

describe("Native artifact source provenance", () => {
  it("allows documentation and unit tests, but keeps Release tied to embedded app source and Debug tied to the SDK", () => {
    const { root, file, commit, base } = fixture();
    file("README.md", "Updated verification evidence");
    file("tests/new-regression.test.ts", "// Isolated test source");
    const documentation = commit();
    expect(
      sourceCompatibility(base, documentation, root, "strict").compatible,
    ).toBe(true);
    file("apps/mobile/app/index.tsx", "export default 'corrected screen';");
    const current = commit();
    expect(sourceCompatibility(base, current, root, "strict").compatible).toBe(
      false,
    );
    expect(
      sourceCompatibility(base, current, root, "ios-debug").compatible,
    ).toBe(true);
    file("apps/mobile/package-lock.json", '{"version":"different-sdk"}');
    expect(
      sourceCompatibility(base, current, root, "ios-debug").compatible,
    ).toBe(false);
  });
  it("does not disguise removed embedded source by renaming it into documentation", () => {
    const { root, file, commit, base } = fixture();
    file("docs/placeholder.txt", "documentation");
    const original = path.join(root, "apps/mobile/app/index.tsx");
    const content = readFileSync(original, "utf8");
    renameSync(original, path.join(root, "docs/screen.tsx"));
    expect(readFileSync(path.join(root, "docs/screen.tsx"), "utf8")).toBe(
      content,
    );
    const current = commit();
    expect(sourceCompatibility(base, current, root, "strict").compatible).toBe(
      false,
    );
  });
});
