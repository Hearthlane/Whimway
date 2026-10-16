import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
  allowedReuseChange,
  findReusableBuild,
  sourceCompatibility,
  workflowCompatibility,
} from "../scripts/reuse-native-build.mjs";
import { nativeInputsChanged } from "../scripts/native-build-inputs.mjs";

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
    expect(nativeInputsChanged(base, current, root)).toBe(true);
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

describe("Exact server-only native build exceptions", () => {
  it.each(["android", "ios-release", "ios-debug"])(
    "reuses %s only for the two proven server providers, documentation and tests",
    (target) => {
      const { root, file, commit, base } = fixture();
      file("lib/providers/ai.ts", "export const store = false;");
      file("lib/providers/google.ts", "export const requestLocal = true;");
      file("tests/server-change.test.ts", "// Isolated server regression");
      file("docs/server-change.md", "Server verification evidence");
      const current = commit();
      expect(sourceCompatibility(base, current, root, target).compatible).toBe(
        true,
      );
      expect(nativeInputsChanged(base, current, root)).toBe(false);
    },
  );
  it("replays exact native viewport observer files without relabelling product binaries or exempting adjacent scripts", () => {
    const { root, file, commit, base } = fixture();
    for (const name of [
      "scripts/native-ios-viewport-server.mjs",
      "scripts/native-ios-gesture-server.mjs",
      "scripts/native-plan-viewport.mjs",
      "e2e-native/helpers/observe-ios-plan.js",
    ])
      file(name, "// Native UI observation only");
    const harness = commit();
    for (const target of ["android", "ios-release", "ios-debug"])
      expect(sourceCompatibility(base, harness, root, target).compatible).toBe(
        true,
      );
    expect(nativeInputsChanged(base, harness, root)).toBe(true);
    file("scripts/native-plan-viewport.native.mjs", "// Unknown build input");
    const unknown = commit();
    for (const target of ["android", "ios-release", "ios-debug"])
      expect(sourceCompatibility(base, unknown, root, target).compatible).toBe(
        false,
      );
  });
  it("allows only the exact test-flow parser while keeping SDK lock changes strict", () => {
    const { root, file, commit, base } = fixture();
    file(
      "scripts/CheckNativeFlows.java",
      "// Official Maestro flow conversion only",
    );
    const parser = commit();
    for (const target of ["android", "ios-release", "ios-debug"])
      expect(sourceCompatibility(base, parser, root, target).compatible).toBe(
        true,
      );
    expect(nativeInputsChanged(base, parser, root)).toBe(true);
    // Even an allowed harness path never exempts a changed native SDK contract.
    file("apps/mobile/package-lock.json", '{"version":"updated-sdk"}');
    for (const target of ["android", "ios-release", "ios-debug"])
      expect(sourceCompatibility(base, parser, root, target).compatible).toBe(
        false,
      );
    file("apps/mobile/package-lock.json", '{"version":"original-sdk"}');
    file("scripts/CheckNativeFlowsNative.java", "// Unknown build input");
    const unknown = commit();
    for (const target of ["android", "ios-release", "ios-debug"])
      expect(sourceCompatibility(base, unknown, root, target).compatible).toBe(
        false,
      );
  });
  it("separates the exact external iOS QA runner from compiled app inputs", () => {
    const { root, file, commit, base } = fixture();
    file(
      "scripts/run-ios-native-qa.mjs",
      "// Host-only XCTest lifecycle fence",
    );
    const harness = commit();
    for (const target of ["android", "ios-release", "ios-debug"])
      expect(sourceCompatibility(base, harness, root, target).compatible).toBe(
        true,
      );
    expect(nativeInputsChanged(base, harness, root)).toBe(true);
    file("apps/mobile/app/index.tsx", "export default 'new portrait layout';");
    const product = commit();
    for (const target of ["android", "ios-release"])
      expect(sourceCompatibility(base, product, root, target).compatible).toBe(
        false,
      );
    expect(
      sourceCompatibility(base, product, root, "ios-debug").compatible,
    ).toBe(true);
    file("apps/mobile/package-lock.json", '{"version":"different-sdk"}');
    expect(
      sourceCompatibility(base, product, root, "ios-debug").compatible,
    ).toBe(false);
    file("apps/mobile/package-lock.json", '{"version":"original-sdk"}');
    file("scripts/run-ios-native-qa.native.mjs", "// Unknown build input");
    const unknown = commit();
    for (const target of ["android", "ios-release", "ios-debug"])
      expect(sourceCompatibility(base, unknown, root, target).compatible).toBe(
        false,
      );
  });
  it.each([
    "lib/providers/currency-data.ts",
    "lib/providers/google.native.ts",
    "lib/schema.ts",
    "lib/planner.ts",
    "apps/mobile/app.config.ts",
    "apps/mobile/package.json",
    "apps/mobile/package-lock.json",
    "packages/native-sdk/index.ts",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "unknown-native-input.ts",
    "scripts/native-ios-gesture-server.native.mjs",
  ])(
    "keeps the shared/native/config/dependency or unknown path %s strict",
    (name) => {
      const { root, file, commit, base } = fixture();
      file(name, "Changed build input");
      const current = commit();
      for (const target of ["android", "ios-release", "ios-debug"])
        expect(
          sourceCompatibility(base, current, root, target).compatible,
        ).toBe(false);
      expect(nativeInputsChanged(base, current, root)).toBe(true);
    },
  );
  it("still builds for mobile JavaScript changes and embeds them freshly in Release", () => {
    const { root, file, commit, base } = fixture();
    file("apps/mobile/app/index.tsx", "export default 'new screen';");
    const current = commit();
    expect(nativeInputsChanged(base, current, root)).toBe(true);
    for (const target of ["android", "ios-release"])
      expect(sourceCompatibility(base, current, root, target).compatible).toBe(
        false,
      );
    // Existing Debug-only Metro behavior is unchanged by the server exception.
    expect(
      sourceCompatibility(base, current, root, "ios-debug").compatible,
    ).toBe(true);
  });
  it("does not hide a shared module deletion by renaming it to an allowlisted server path", () => {
    const { root, file, commit } = fixture();
    file("lib/providers/currency-data.ts", "export const currency = 'CAD';");
    const base = commit();
    renameSync(
      path.join(root, "lib/providers/currency-data.ts"),
      path.join(root, "lib/providers/google.ts"),
    );
    const current = commit();
    for (const target of ["android", "ios-release", "ios-debug"])
      expect(sourceCompatibility(base, current, root, target).compatible).toBe(
        false,
      );
    expect(nativeInputsChanged(base, current, root)).toBe(true);
  });
  it("fails toward building for missing/invalid history, and keeps native harness changes runnable", () => {
    const { root, file, commit, base } = fixture();
    for (const before of [undefined, "bad-sha", "0".repeat(40), "f".repeat(40)])
      expect(nativeInputsChanged(before, base, root)).toBe(true);
    file("e2e-native/helpers/boot.yaml", "# Changed simulator test");
    const current = commit();
    expect(nativeInputsChanged(base, current, root)).toBe(true);
    expect(allowedReuseChange("lib/providers/ai.ts")).toBe(true);
    expect(allowedReuseChange("lib/providers/google.ts")).toBe(true);
    expect(allowedReuseChange("lib/providers/ai.ts.backup")).toBe(false);
    expect(allowedReuseChange("lib/providers/google.ts/other")).toBe(false);
  });
});

const repository = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const deniedProviders = new Set([
  "lib/providers/ai.ts",
  "lib/providers/google.ts",
]);
const relative = (file: string) =>
  path.relative(repository, file).split(path.sep).join("/");

function mobileEntries(): string[] {
  const entries = [path.join(repository, "apps/mobile/app.config.ts")];
  function walk(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink())
        throw new Error(
          "Mobile source symlinks need an explicit dependency-boundary review.",
        );
      if (entry.isDirectory()) walk(file);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name)) entries.push(file);
    }
  }
  walk(path.join(repository, "apps/mobile/app"));
  walk(path.join(repository, "apps/mobile/src"));
  return entries;
}

// Inspect the real source graph rather than grepping direct imports. This also
// follows type imports and re-exports conservatively, with every Metro platform
// suffix represented. Dependencies under node_modules are intentionally terminal.
function workspaceGraph(
  entries: string[],
  overrides = new Map<string, string>(),
) {
  const configPath = path.join(repository, "apps/mobile/tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error)
    throw new Error(
      ts.flattenDiagnosticMessageText(config.error.messageText, "\n"),
    );
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    path.dirname(configPath),
    undefined,
    configPath,
  );
  if (parsed.errors.length)
    throw new Error(
      parsed.errors
        .map((error) =>
          ts.flattenDiagnosticMessageText(error.messageText, "\n"),
        )
        .join("\n"),
    );
  const host: ts.ModuleResolutionHost = {
    ...ts.sys,
    fileExists: (file) =>
      overrides.has(path.resolve(file)) || ts.sys.fileExists(file),
    readFile: (file) =>
      overrides.get(path.resolve(file)) ?? ts.sys.readFile(file),
  };
  const visited = new Set<string>(),
    issues: string[] = [];
  const platforms = [
    [".ios", ".native", ""],
    [".android", ".native", ""],
    [".native", ""],
    [".web", ""],
    [""],
  ];
  function visit(input: string) {
    const absolute = path.resolve(input);
    const file = overrides.has(absolute) ? absolute : realpathSync(absolute);
    if (file.split(path.sep).includes("node_modules")) return;
    const name = relative(file);
    if (name.startsWith("../") || path.isAbsolute(name)) {
      issues.push("Workspace resolution escaped the repository");
      return;
    }
    if (visited.has(name)) return;
    visited.add(name);
    if (deniedProviders.has(name)) {
      issues.push(`Server-only module is reachable: ${name}`);
      return;
    }
    if (name.endsWith(".json")) return;
    if (!/\.[cm]?[jt]sx?$/.test(name)) {
      issues.push(`Unknown workspace source format: ${name}`);
      return;
    }
    const contents = host.readFile!(file);
    if (contents === undefined) {
      issues.push(`Unreadable workspace source: ${name}`);
      return;
    }
    const imports = ts.preProcessFile(contents, true, true);
    const specifiers = new Set(
      imports.importedFiles.map((entry) => entry.fileName),
    );
    const source = ts.createSourceFile(
      file,
      contents,
      ts.ScriptTarget.Latest,
      true,
    );
    function scan(node: ts.Node) {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        const loadsModule =
          callee.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(callee) && callee.text === "require") ||
          (ts.isPropertyAccessExpression(callee) &&
            ts.isIdentifier(callee.expression) &&
            callee.expression.text === "require" &&
            callee.name.text === "resolve");
        if (loadsModule) {
          const argument = node.arguments[0];
          if (!argument || !ts.isStringLiteralLike(argument))
            issues.push(`Nonliteral module load: ${name}`);
          else specifiers.add(argument.text);
        }
      }
      ts.forEachChild(node, scan);
    }
    scan(source);
    for (const specifier of specifiers) {
      const resolved = new Set<string>();
      for (const moduleSuffixes of platforms) {
        const result = ts.resolveModuleName(
          specifier,
          file,
          { ...parsed.options, moduleSuffixes },
          host,
        ).resolvedModule;
        if (result) resolved.add(result.resolvedFileName);
      }
      if (!resolved.size)
        issues.push(`Unresolved import: ${name} -> ${specifier}`);
      for (const dependency of resolved) visit(dependency);
    }
    for (const reference of imports.referencedFiles) {
      const dependency = path.resolve(path.dirname(file), reference.fileName);
      if (!host.fileExists(dependency))
        issues.push(`Unresolved source reference: ${name}`);
      else visit(dependency);
    }
    for (const reference of imports.typeReferenceDirectives) {
      const result = ts.resolveTypeReferenceDirective(
        reference.fileName,
        file,
        parsed.options,
        host,
      ).resolvedTypeReferenceDirective;
      if (!result?.resolvedFileName)
        issues.push(
          `Unresolved type reference: ${name} -> ${reference.fileName}`,
        );
      else visit(result.resolvedFileName);
    }
  }
  entries.forEach(visit);
  return { visited, issues };
}

describe("Server-only exceptions stay outside the actual mobile dependency graph", () => {
  it("traverses all app/src roots and shared exports without reaching either provider", () => {
    const entries = mobileEntries(),
      graph = workspaceGraph(entries);
    expect(graph.issues).toEqual([]);
    for (const entry of entries)
      expect(graph.visited.has(relative(entry))).toBe(true);
    for (const shared of [
      "lib/schema.ts",
      "lib/geo.ts",
      "lib/time.ts",
      "lib/storage.ts",
    ])
      expect(graph.visited.has(shared)).toBe(true);
    for (const provider of [
      ...deniedProviders,
      "scripts/native-plan-viewport.mjs",
      "scripts/native-ios-viewport-server.mjs",
      "scripts/native-ios-gesture-server.mjs",
      "scripts/run-ios-native-qa.mjs",
      "scripts/CheckNativeFlows.java",
    ])
      expect(graph.visited.has(provider)).toBe(false);
  });
  it.each(["ai", "google"])(
    "detects the %s provider through a shared alias and transitive barrel export",
    (provider) => {
      const entry = path.join(
        repository,
        "apps/mobile/src/core/__boundary-probe.ts",
      );
      const barrel = path.join(repository, "lib/__native-boundary-barrel.ts");
      const graph = workspaceGraph(
        [entry],
        new Map([
          [entry, 'export * from "@core/__native-boundary-barrel";'],
          [barrel, `export * from "./providers/${provider}";`],
        ]),
      );
      expect(graph.issues).toContain(
        `Server-only module is reachable: lib/providers/${provider}.ts`,
      );
    },
  );
  it("follows a native-only shared export even when the default module is safe", () => {
    const entry = path.join(
      repository,
      "apps/mobile/src/core/__boundary-probe.ts",
    );
    const barrel = path.join(repository, "lib/__native-boundary-barrel.ts");
    const nativeBarrel = path.join(
      repository,
      "lib/__native-boundary-barrel.native.ts",
    );
    const graph = workspaceGraph(
      [entry],
      new Map([
        [entry, 'export * from "@core/__native-boundary-barrel";'],
        [barrel, "export const safe = true;"],
        [nativeBarrel, 'export * from "./providers/google";'],
      ]),
    );
    expect(graph.visited.has("lib/__native-boundary-barrel.ts")).toBe(true);
    expect(graph.visited.has("lib/__native-boundary-barrel.native.ts")).toBe(
      true,
    );
    expect(graph.issues).toContain(
      "Server-only module is reachable: lib/providers/google.ts",
    );
  });
  it.each([
    'import "./__missing_native_dependency";',
    'import "@core/__missing_native_dependency";',
    'import "__unresolved_workspace_alias__/module";',
    'const name = "@core/providers/google"; void import(name);',
    'const name = "@core/providers/ai"; require(name);',
  ])(
    "fails conservatively on an unresolved or computed import: %s",
    (contents) => {
      const entry = path.join(
        repository,
        "apps/mobile/src/core/__boundary-probe.ts",
      );
      expect(
        workspaceGraph([entry], new Map([[entry, contents]])).issues.length,
      ).toBeGreaterThan(0);
    },
  );
});

function githubCompilationFixture(
  target: "android" | "ios-release" | "ios-debug",
) {
  const local = fixture();
  local.file(
    ".github/workflows/native.yml",
    readFileSync(path.join(repository, ".github/workflows/native.yml"), "utf8"),
  );
  const compiled = local.commit();
  local.file(
    "README.md",
    "This run restored and reuploaded a previous binary.",
  );
  const restored = local.commit();
  local.file("README.md", "Current runtime-only follow-up.");
  const current = local.commit();
  const repo = "Fixture/Whimway",
    repoId = 123,
    branch = "codex/native-test";
  const names = {
    android: [
      "android-native-compilation-apk",
      "android",
      "Compile standalone internal-test APK",
      "Retain internal APK and manifest evidence",
    ],
    "ios-release": [
      "ios-native-simulator-app",
      "ios",
      "Compile iOS simulator app without signing credentials",
      "Retain simulator app and runtime evidence",
    ],
    "ios-debug": [
      "ios-native-simulator-debug",
      "ios",
      "Compile a simulator development client",
      "Retain compiled simulator development client",
    ],
  };
  const [artifactName, jobName, compileName, uploadName] = names[target];
  const run = (id: number, source: string) => ({
    id,
    head_sha: source,
    head_branch: branch,
    path: ".github/workflows/native.yml",
    repository: { id: repoId, full_name: repo },
    head_repository: { id: repoId, full_name: repo },
  });
  const artifact = (
    id: number,
    runId: number,
    source: string,
    age: number,
  ) => ({
    id,
    name: artifactName,
    expired: false,
    size_in_bytes: 1024,
    created_at: new Date(Date.now() - age).toISOString(),
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    workflow_run: {
      id: runId,
      head_sha: source,
      head_branch: branch,
      repository_id: repoId,
      head_repository_id: repoId,
    },
  });
  const jobs = (id: number, source: string, conclusion = "success") => ({
    total_count: 1,
    jobs: [
      {
        id: id * 100,
        run_id: id,
        head_sha: source,
        head_branch: branch,
        name: jobName,
        status: "completed",
        conclusion: "failure",
        steps: [
          { name: compileName, status: "completed", conclusion, number: 10 },
          {
            name: uploadName,
            status: "completed",
            conclusion: "success",
            number: 12,
          },
        ],
      },
    ],
  });
  const artifacts = [
    artifact(402, 202, restored, 0),
    artifact(401, 201, compiled, 1000),
  ];
  const artifactSuffix = `actions/artifacts?name=${artifactName}&per_page=100`;
  const jobSuffix = (id: number) =>
    `actions/runs/${id}/jobs?filter=latest&per_page=100`;
  const replies = new Map<string, unknown>([
    [artifactSuffix, { artifacts }],
    ["actions/runs/201", run(201, compiled)],
    ["actions/runs/202", run(202, restored)],
    [jobSuffix(201), jobs(201, compiled)],
    [jobSuffix(202), jobs(202, restored, "skipped")],
  ]);
  const unavailable = new Set<string>();
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const prefix = `https://api.github.com/repos/${repo}/`;
    if (!url.startsWith(prefix)) throw new Error("Unexpected fixture URL");
    const suffix = url.slice(prefix.length);
    if (unavailable.has(suffix)) return new Response("{}", { status: 403 });
    if (!replies.has(suffix)) throw new Error("Unexpected fixture lookup");
    return new Response(JSON.stringify(replies.get(suffix)), { status: 200 });
  });
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    GITHUB_TOKEN: "synthetic-token",
    GITHUB_REPOSITORY: repo,
    GITHUB_REPOSITORY_ID: String(repoId),
    GITHUB_REF_TYPE: "branch",
    GITHUB_REF_NAME: branch,
    GITHUB_SHA: current,
    GITHUB_RUN_ID: "999",
    GITHUB_EVENT_NAME: "workflow_dispatch",
  };
  const lookup = () =>
    findReusableBuild(target, {
      env,
      cwd: local.root,
      fetcher,
    });
  return {
    compiled,
    restored,
    current,
    replies,
    unavailable,
    fetcher,
    lookup,
    jobs,
    artifactSuffix,
    jobSuffix,
    artifacts,
  };
}

describe("Original compiler-source provenance through GitHub job metadata", () => {
  it.each(["android", "ios-release", "ios-debug"] as const)(
    "accepts genuinely compiled %s artifacts even when later runtime tests failed",
    async (target) => {
      const fixture = githubCompilationFixture(target);
      fixture.replies.set(fixture.artifactSuffix, {
        artifacts: [fixture.artifacts[1]],
      });
      const result = await fixture.lookup();
      expect(result).toMatchObject({
        reused: true,
        artifact_id: 401,
        run_id: 201,
        source_sha: fixture.compiled,
        binary_source_sha: fixture.compiled,
        compilation_job_id: 20100,
        compilation_step_number: 10,
      });
      expect(
        fixture.fetcher.mock.calls.some(([url]) =>
          String(url).endsWith(fixture.jobSuffix(201)),
        ),
      ).toBe(true);
    },
  );
  it.each(["android", "ios-release", "ios-debug"] as const)(
    "rejects a reuploaded %s binary whose compiler was skipped and selects the original compiler SHA",
    async (target) => {
      const fixture = githubCompilationFixture(target),
        result = await fixture.lookup();
      expect(result).toMatchObject({
        reused: true,
        artifact_id: 401,
        run_id: 201,
        source_sha: fixture.compiled,
        binary_source_sha: fixture.compiled,
      });
      expect(result.binary_source_sha).not.toBe(fixture.restored);
      expect(
        fixture.fetcher.mock.calls.filter(([url]) =>
          String(url).includes("/jobs?"),
        ),
      ).toHaveLength(2);
    },
  );
  it("falls back when compiler proof is absent, malformed, belongs to another job/source, or never completed successfully", async () => {
    const fixture = githubCompilationFixture("ios-debug");
    fixture.replies.set(fixture.artifactSuffix, {
      artifacts: [fixture.artifacts[1]],
    });
    const mutate = (
      change: (value: ReturnType<typeof fixture.jobs>) => void,
    ) => {
      const value = fixture.jobs(201, fixture.compiled);
      change(value);
      return value;
    };
    const invalid: unknown[] = [
      {},
      { total_count: 0, jobs: [] },
      mutate((value) => {
        value.jobs[0].steps = [];
      }),
      mutate((value) => {
        value.jobs[0].steps[0].conclusion = "skipped";
      }),
      mutate((value) => {
        value.jobs[0].steps[0].conclusion = "failure";
      }),
      mutate((value) => {
        value.jobs[0].steps[0].status = "in_progress";
      }),
      mutate((value) => {
        value.jobs[0].steps[1].conclusion = "skipped";
      }),
      mutate((value) => {
        value.jobs[0].steps[1].number = 9;
      }),
      mutate((value) => {
        value.jobs[0].name = "android";
      }),
      mutate((value) => {
        value.jobs[0].run_id = 999;
      }),
      mutate((value) => {
        value.jobs[0].head_sha = "f".repeat(40);
      }),
      mutate((value) => {
        value.jobs[0].head_branch = "another-branch";
      }),
      mutate((value) => {
        value.jobs.push(structuredClone(value.jobs[0]));
        value.total_count = 2;
      }),
      mutate((value) => {
        value.total_count = 101;
      }),
    ];
    for (const response of invalid) {
      fixture.replies.set(fixture.jobSuffix(201), response);
      expect(await fixture.lookup()).toMatchObject({
        reused: false,
        binary_source_sha: "",
        reason: "no-compatible-artifact",
      });
    }
    fixture.unavailable.add(fixture.jobSuffix(201));
    expect(await fixture.lookup()).toMatchObject({
      reused: false,
      binary_source_sha: "",
      reason: "lookup-unavailable",
    });
  });
  it("uploads compiler artifacts only after actual compilation and keeps the compilation contract intact", () => {
    const workflow = readFileSync(
      path.join(repository, ".github/workflows/native.yml"),
      "utf8",
    );
    expect(workflow).toMatch(
      /name: Compile standalone internal-test APK\r?\n\s+id: android_compile/,
    );
    for (const [name, step] of [
      ["Retain internal APK and manifest evidence", "android_compile"],
      ["Retain simulator app and runtime evidence", "ios_compile"],
      ["Retain compiled simulator development client", "ios_debug_compile"],
    ])
      expect(workflow).toContain(
        `name: ${name}\n        if: always() && steps.${step}.outcome == 'success'`.replaceAll(
          "\n",
          workflow.includes("\r\n") ? "\r\n" : "\n",
        ),
      );
    const previousUploadConditions = workflow
      .replace(/        id: android_compile\r?\n/, "")
      .replace(
        /        if: always\(\) && steps.android_compile.outcome == 'success'\r?\n/,
        "",
      )
      .replace(
        "if: always() && steps.ios_compile.outcome == 'success'",
        "if: always() && (steps.ios_compile.outcome == 'success' || steps.reuse_ios_release.outputs.reused == 'true')",
      )
      .replace(
        "if: always() && steps.ios_debug_compile.outcome == 'success'",
        "if: always() && (steps.ios_debug_compile.outcome == 'success' || steps.reuse_ios_debug.outputs.reused == 'true')",
      );
    for (const target of ["android", "ios-release", "ios-debug"])
      expect(
        workflowCompatibility(previousUploadConditions, workflow, target),
      ).toBe(true);
    const runtimeUpload = workflow.match(
      /      - name: Retain iOS native runtime evidence([\s\S]*?)(?=      - name:|$)/,
    )?.[1];
    for (const file of ["native-smoke.png", "launch.txt", "devices.json"])
      expect(runtimeUpload).toContain(`apps/mobile/ios/${file}`);
  });
  it("requires fresh iOS products when enabling Xcode Simulator entitlement packaging without changing Android compilation", () => {
    const current = readFileSync(
      path.join(repository, ".github/workflows/native.yml"),
      "utf8",
    );
    const unsigned = current.replaceAll(
      "CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=-",
      "CODE_SIGNING_ALLOWED=NO",
    );
    expect(
      current.match(/CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=-/g),
    ).toHaveLength(2);
    expect(workflowCompatibility(unsigned, current, "android")).toBe(true);
    for (const target of ["ios-release", "ios-debug"])
      expect(workflowCompatibility(unsigned, current, target)).toBe(false);
    expect(current).toContain("node scripts/run-ios-native-qa.mjs");
    const runner = readFileSync(
      path.join(repository, "scripts/run-ios-native-qa.mjs"),
      "utf8",
    );
    for (const required of [
      "scripts/check-ios-simulator-keychain.mjs",
      "ios-keychain-proof.json",
      "ios-keychain-diagnostics.json",
    ])
      expect(runner).toContain(required);
    expect(current).toContain("name: Collect bounded iOS startup diagnostics");
  });
});
