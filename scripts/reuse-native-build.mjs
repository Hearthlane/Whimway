// Reuse only actual binaries from this repository/branch's native workflow.
// Release binaries must embed the same source. Only the iOS development client
// can accept JS/TS screen changes, because it loads current source from Metro.
// Missing provenance, native changes, or API failures fall back to build.
import { appendFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const shaPattern = /^[a-f0-9]{40}$/;
const workflowPath = ".github/workflows/native.yml";
const artifactNames = {
  android: "android-native-compilation-apk",
  "ios-release": "ios-native-simulator-app",
  "ios-debug": "ios-native-simulator-debug",
};
const compilationSteps = {
  android: {
    job: "android",
    compile: "Compile standalone internal-test APK",
    upload: "Retain internal APK and manifest evidence",
  },
  "ios-release": {
    job: "ios",
    compile: "Compile iOS simulator app without signing credentials",
    upload: "Retain simulator app and runtime evidence",
  },
  "ios-debug": {
    job: "ios",
    compile: "Compile a simulator development client",
    upload: "Retain compiled simulator development client",
  },
};
const runtimeFiles = new Set([
  "scripts/CheckNativeFlows.java",
  "scripts/start-native-test-services.mjs",
  "scripts/native-ios-viewport-server.mjs",
  "scripts/native-ios-gesture-server.mjs",
  "scripts/native-plan-viewport.mjs",
  "scripts/run-android-native-qa.sh",
  "scripts/run-ios-native-qa.mjs",
  "scripts/native-build-inputs.mjs",
  "scripts/test-database.mjs",
  "scripts/reuse-native-build.mjs",
  "scripts/sign-ios-simulator-test-app.sh",
  "scripts/check-ios-simulator-keychain.mjs",
  workflowPath,
]);
// The mobile dependency-graph regression proves these exact server modules are
// unreachable from its source/shared exports. Other lib paths remain strict.
const serverOnlyProviderFiles = new Set([
  "lib/providers/ai.ts",
  "lib/providers/google.ts",
]);
export function isServerOnlyProviderChange(file) {
  return serverOnlyProviderFiles.has(file);
}

export function allowedReuseChange(file, target = "strict") {
  return (
    file === "README.md" ||
    file.startsWith("docs/") ||
    file.startsWith("tests/") ||
    file.startsWith("e2e-native/") ||
    file.startsWith("e2e-mobile/") ||
    isServerOnlyProviderChange(file) ||
    runtimeFiles.has(file) ||
    (target === "ios-debug" && /^apps\/mobile\/(app|src)\/.+\.tsx?$/.test(file))
  );
}
function git(args, cwd) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    timeout: 10000,
  });
  return !result.error && result.status === 0 ? result.stdout : null;
}
export function sourceCompatibility(
  sourceSha,
  currentSha,
  cwd = root,
  target = "strict",
) {
  if (!shaPattern.test(sourceSha ?? "") || !shaPattern.test(currentSha ?? ""))
    return { compatible: false, reason: "source-unavailable" };
  for (const sha of new Set([sourceSha, currentSha])) {
    if (git(["cat-file", "-e", `${sha}^{commit}`], cwd) === null)
      return { compatible: false, reason: "source-unavailable" };
  }
  // NUL separation handles unusual filenames. No rename detection prevents a
  // source-to-docs rename from hiding the deletion of compiled application code.
  const args = [
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "--name-only",
    "--no-renames",
    "-z",
  ];
  const committed = git([...args, sourceSha, currentSha, "--"], cwd);
  const working = git([...args, "HEAD", "--"], cwd);
  if (committed === null || working === null)
    return { compatible: false, reason: "source-unavailable" };
  const changed = [
    ...new Set((committed + working).split("\0").filter(Boolean)),
  ];
  return changed.every((file) => allowedReuseChange(file, target))
    ? { compatible: true, changed_files: changed.length }
    : { compatible: false, reason: "application-source-changed" };
}
export function workflowCompileContract(text, target) {
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  const envStart = lines.findIndex((line) => line === "env:");
  if (envStart < 0) return null;
  const environment = [];
  for (const line of lines.slice(envStart + 1)) {
    if (line && !/^\s/.test(line)) break;
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (!/^  [A-Z_][A-Z_0-9]*: .+$/.test(line)) return null;
    environment.push(line.trim());
  }
  if (
    !environment.some((line) => line.startsWith("EXPO_PUBLIC_API_URL:")) ||
    !environment.some((line) => line.startsWith("WHIMWAY_NATIVE_BUILD_CHECK:"))
  )
    return null;
  const job = target === "android" ? "android" : "ios";
  const start = lines.findIndex((line) => line === `  ${job}:`);
  if (start < 0) return null;
  const jobLines = [];
  for (const line of lines.slice(start + 1)) {
    if (/^  [a-zA-Z_][a-zA-Z_0-9-]*:/.test(line)) break;
    jobLines.push(line);
  }
  const stepStart = jobLines.findIndex((line) => line === "    steps:");
  if (stepStart < 0) return null;
  const header = jobLines
    .slice(0, stepStart)
    .filter((line) =>
      /^\s+(runs-on|container|working-directory|shell):/.test(line),
    )
    .map((line) => line.trim());
  if (
    !header.some((line) => line.startsWith("runs-on:")) ||
    header.some((line) => line.includes("${{"))
  )
    return null;
  const toolchain = jobLines
    .filter(
      (line) =>
        /^\s+(node-version|node-version-file):/.test(line) ||
        /uses: actions\/setup-node@/.test(line),
    )
    .map((line) => line.trim());
  if (!toolchain.some((line) => line.startsWith("node-version:"))) return null;
  const commands = [];
  const blocks = jobLines
    .slice(stepStart + 1)
    .join("\n")
    .split(/(?=^      - )/m);
  for (const block of blocks) {
    const stepLines = block.split("\n");
    const runAt = stepLines.findIndex((line) => /^        run:/.test(line));
    if (runAt < 0) continue;
    const run = stepLines[runAt].replace(/^        run:\s*/, "");
    let body;
    if (run === "|") {
      body = [];
      for (const line of stepLines.slice(runAt + 1)) {
        if (line.trim() && !line.startsWith("          ")) break;
        body.push(line.slice(10));
      }
      body = body.join("\n").trim();
    } else if (/^[>|]/.test(run))
      return null; // Unknown YAML folding fails closed.
    else body = run.trim();
    // Capture the entire preparation/compiler/toolchain script, not just one
    // matched line, so environment or source mutations in that step also count.
    if (
      /expo\s+prebuild|gradlew|xcodebuild|pod\s+install|xcode-select|JAVA_HOME|DEVELOPER_DIR|SDKROOT/.test(
        body,
      )
    ) {
      commands.push(
        body
          .split("\n")
          .filter((line) => !/^\s*tar -czf /.test(line))
          .join("\n"),
      );
    }
    // Build-time environment overrides outside compiler steps still count.
    for (const line of stepLines)
      if (
        /^\s+(EXPO_PUBLIC_[A-Z_0-9]+|WHIMWAY_NATIVE_BUILD_CHECK|NODE_ENV|JAVA_HOME|DEVELOPER_DIR|SDKROOT|RCT_NEW_ARCH_ENABLED):/.test(
          line,
        )
      )
        toolchain.push(line.trim());
  }
  if (
    !commands.some((command) => /expo\s+prebuild/.test(command)) ||
    !commands.some((command) =>
      job === "android"
        ? /gradlew/.test(command)
        : /xcodebuild.*\bbuild\b/.test(command),
    )
  )
    return null;
  return JSON.stringify({
    environment: environment.sort(),
    header,
    toolchain,
    commands,
  });
}
export function workflowCompatibility(sourceText, currentText, target) {
  const source = workflowCompileContract(sourceText, target);
  return (
    source !== null && source === workflowCompileContract(currentText, target)
  );
}
const positiveId = (value) =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const fallback = (reason) => ({
  reused: false,
  artifact_id: "",
  run_id: "",
  source_sha: "",
  binary_source_sha: "",
  source_mode: "",
  reason,
});

export async function findReusableBuild(
  target,
  { env = process.env, event, fetcher = fetch, cwd = root } = {},
) {
  const name = Object.hasOwn(artifactNames, target)
    ? artifactNames[target]
    : undefined;
  if (!name) return fallback("unsupported-target");
  if (!env.GITHUB_TOKEN) return fallback("token-unavailable");
  if (
    !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(env.GITHUB_REPOSITORY ?? "") ||
    !/^\d+$/.test(env.GITHUB_REPOSITORY_ID ?? "")
  )
    return fallback("repository-unavailable");
  const repositoryId = Number(env.GITHUB_REPOSITORY_ID),
    repository = env.GITHUB_REPOSITORY;
  if (!positiveId(repositoryId)) return fallback("repository-unavailable");
  try {
    event ??= env.GITHUB_EVENT_PATH
      ? JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8"))
      : {};
    if (
      event.repository &&
      (event.repository.id !== repositoryId || event.repository.fork)
    )
      return fallback("repository-mismatch");
    const pull = event.pull_request;
    if (env.GITHUB_EVENT_NAME === "pull_request" && !pull)
      return fallback("event-unavailable");
    if (pull && pull.head?.repo?.id !== repositoryId)
      return fallback("fork-head");
    const branch =
      pull?.head?.ref ??
      (env.GITHUB_REF_TYPE === "branch" ? env.GITHUB_REF_NAME : undefined);
    if (typeof branch !== "string" || !branch || /[\r\n\0]/.test(branch))
      return fallback("branch-unavailable");
    if (env.GITHUB_HEAD_REF && env.GITHUB_HEAD_REF !== branch)
      return fallback("branch-mismatch");
    const currentSha = git(["rev-parse", "HEAD"], cwd)?.trim();
    const expectedSha = pull?.head?.sha ?? env.GITHUB_SHA;
    if (!shaPattern.test(currentSha ?? "") || currentSha !== expectedSha)
      return fallback("checkout-mismatch");

    const deadline = Date.now() + 60000;
    async function get(suffix) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("lookup-deadline");
      const response = await fetcher(
        `https://api.github.com/repos/${repository}/${suffix}`,
        {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${env.GITHUB_TOKEN}`,
            "X-GitHub-Api-Version": "2026-03-10",
          },
          redirect: "error",
          signal: AbortSignal.timeout(Math.min(15000, remaining)),
        },
      );
      if (!response.ok) throw new Error("lookup-unavailable");
      return response.json();
    }
    const listed = await get(
      `actions/artifacts?name=${encodeURIComponent(name)}&per_page=100`,
    );
    if (!Array.isArray(listed.artifacts))
      return fallback("artifact-list-unavailable");
    const candidates = listed.artifacts
      .slice(0, 100)
      .filter((artifact) => {
        const run = artifact?.workflow_run;
        return (
          artifact?.name === name &&
          positiveId(artifact.id) &&
          artifact.expired === false &&
          artifact.size_in_bytes > 0 &&
          Date.parse(artifact.expires_at) > Date.now() &&
          positiveId(run?.id) &&
          String(run.id) !== env.GITHUB_RUN_ID &&
          run.repository_id === repositoryId &&
          run.head_repository_id === repositoryId &&
          run.head_branch === branch &&
          shaPattern.test(run.head_sha ?? "")
        );
      })
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    for (const artifact of candidates) {
      if (Date.now() >= deadline) return fallback("lookup-unavailable");
      const sourceSha = artifact.workflow_run.head_sha;
      const comparison = sourceCompatibility(
        sourceSha,
        currentSha,
        cwd,
        target,
      );
      if (!comparison.compatible) continue;
      const sourceWorkflow = git(["show", `${sourceSha}:${workflowPath}`], cwd);
      const currentWorkflow = readFileSync(
        path.join(cwd, workflowPath),
        "utf8",
      );
      if (
        sourceWorkflow === null ||
        !workflowCompatibility(sourceWorkflow, currentWorkflow, target)
      )
        continue;
      const run = await get(`actions/runs/${artifact.workflow_run.id}`);
      if (
        run.id !== artifact.workflow_run.id ||
        run.repository?.id !== repositoryId ||
        run.head_repository?.id !== repositoryId ||
        run.repository?.full_name?.toLowerCase() !== repository.toLowerCase() ||
        run.head_repository?.full_name?.toLowerCase() !==
          repository.toLowerCase() ||
        run.head_branch !== branch ||
        run.head_sha !== sourceSha ||
        typeof run.path !== "string" ||
        run.path.split("@")[0] !== workflowPath
      )
        continue;
      // Older workflows also uploaded restored binaries, whose artifact run SHA
      // is not their compiler SHA. Require the corresponding platform job to
      // prove this run really compiled AND uploaded this artifact; otherwise
      // continue back to the original compiled artifact, never infer lineage.
      const proof = compilationSteps[target];
      const jobList = await get(
        `actions/runs/${run.id}/jobs?filter=latest&per_page=100`,
      );
      if (
        !Array.isArray(jobList.jobs) ||
        !Number.isInteger(jobList.total_count) ||
        jobList.total_count < 1 ||
        jobList.total_count > 100 ||
        jobList.jobs.length !== jobList.total_count
      )
        continue;
      const jobs = jobList.jobs.filter((job) => job?.name === proof.job);
      if (jobs.length !== 1) continue;
      const job = jobs[0];
      if (
        !positiveId(job.id) ||
        job.run_id !== run.id ||
        job.head_sha !== sourceSha ||
        job.head_branch !== branch ||
        !Array.isArray(job.steps)
      )
        continue;
      const compile = job.steps.filter((step) => step?.name === proof.compile);
      const upload = job.steps.filter((step) => step?.name === proof.upload);
      if (
        compile.length !== 1 ||
        upload.length !== 1 ||
        ![compile[0], upload[0]].every(
          (step) =>
            step.status === "completed" &&
            step.conclusion === "success" &&
            positiveId(step.number),
        ) ||
        compile[0].number >= upload[0].number
      )
        continue;
      // Later runtime tests may still be running or may have failed. Their
      // result does not change the now-verified original compilation source.
      return {
        reused: true,
        artifact_id: artifact.id,
        run_id: run.id,
        source_sha: sourceSha,
        binary_source_sha: sourceSha,
        source_mode:
          target === "ios-debug" ? "metro-current-source" : "embedded-source",
        current_sha: currentSha,
        artifact_name: name,
        compilation_job_id: job.id,
        compilation_step_number: compile[0].number,
        changed_files: comparison.changed_files,
      };
    }
    return fallback("no-compatible-artifact");
  } catch {
    // Never log exceptions, response bodies or environment: they can contain
    // authentication headers. The caller always has the compile fallback.
    return fallback("lookup-unavailable");
  }
}

export async function main(args = process.argv.slice(2), env = process.env) {
  const result = await findReusableBuild(
    args.length === 1 ? args[0] : undefined,
    { env },
  );
  if (env.GITHUB_OUTPUT)
    appendFileSync(
      env.GITHUB_OUTPUT,
      [
        "reused",
        "artifact_id",
        "run_id",
        "source_sha",
        "binary_source_sha",
        "source_mode",
      ]
        .map((key) => `${key}=${result[key]}\n`)
        .join(""),
    );
  process.stdout.write(JSON.stringify(result) + "\n");
  return result;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
