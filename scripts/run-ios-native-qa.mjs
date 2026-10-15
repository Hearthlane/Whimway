// Maestro 2.11 can leave xcodebuild alive when driver.open fails before its
// session shutdown hook is installed. Keep each failed scope failed, and fence
// its owned runner before starting another scope on the same simulator.
// Pinned upstream cleanup and generated command contracts:
// https://github.com/mobile-dev-inc/maestro/blob/cli-2.11.0/maestro-cli/src/main/java/maestro/cli/session/MaestroSessionManager.kt
// https://github.com/mobile-dev-inc/maestro/blob/cli-2.11.0/maestro-ios-driver/src/main/kotlin/xcuitest/installer/LocalXCTestInstaller.kt
// https://github.com/mobile-dev-inc/maestro/blob/cli-2.11.0/maestro-ios-driver/src/main/kotlin/util/XCRunnerCLIUtils.kt
import { execFile, spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

export const DRIVER_BUNDLE = "dev.mobile.maestro-driver-iosUITests.xctrunner";
const DRIVER_EXECUTABLE = "maestro-driver-iosUITests-Runner";
const UUID = /^[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}$/;
const MAX_PROCESSES = 4096;
const MAX_IDENTITIES = 32;
const MAX_OUTPUT = 1024 * 1024;
const EXPO_URL =
  "exp+whimway://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081&disableOnboarding=1&disableFab=1&disableAutoLaunch=1";
export const IOS_SCOPES = Object.freeze([
  { name: "ready", port: 7001, output: "ios-ready", flow: "ios-ready.yaml" },
  { name: "main", port: 7002, output: "ios", flow: "smoke.yaml" },
  {
    name: "reminders",
    port: 7003,
    output: "ios-reminders",
    flow: "reminders-allow.yaml",
  },
  {
    name: "large-text",
    port: 7004,
    output: "ios-large-text",
    flow: "large-text.yaml",
  },
]);

/** @returns {never} */
function fail(reason) {
  throw new Error(reason);
}

export function parseIOSProcessTable(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > MAX_OUTPUT)
    fail("process-table-invalid");
  const rows = text.split(/\r?\n/).filter((line) => line.trim());
  if (rows.length > MAX_PROCESSES) fail("process-table-too-large");
  const seen = new Set();
  return rows.map((line) => {
    // lstart is a process birth identity, not its changing elapsed duration.
    const row = line.match(
      /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+)$/,
    );
    if (!row) fail("process-row-invalid");
    const process = {
      pid: Number(row[1]),
      ppid: Number(row[2]),
      pgid: Number(row[3]),
      started: row[4].replace(/\s+/g, " "),
      command: row[5],
    };
    if (
      ![process.pid, process.ppid, process.pgid].every(Number.isSafeInteger) ||
      seen.has(process.pid)
    )
      fail("process-pid-invalid");
    seen.add(process.pid);
    return process;
  });
}

export function parseIOSDriverService(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > MAX_OUTPUT)
    fail("driver-services-invalid");
  const matches = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes(DRIVER_BUNDLE)) continue;
    const row = line.match(/^\s*(\d+|-)\s+(-?\d+)\s+(\S+)\s*$/);
    if (!row) fail("driver-service-invalid");
    const label = row[3].replace(/^UIKitApplication:/, "").split("[")[0];
    if (label !== DRIVER_BUNDLE) fail("driver-service-identity-invalid");
    const pid = row[1] === "-" ? null : Number(row[1]);
    if (pid !== null && (!Number.isSafeInteger(pid) || pid < 2))
      fail("driver-service-pid-invalid");
    matches.push(pid);
  }
  if (matches.length > 1) fail("driver-service-ambiguous");
  return matches[0] ?? null;
}

function identityEqual(left, right) {
  return (
    left.pid === right.pid &&
    left.pgid === right.pgid &&
    left.started === right.started &&
    left.command === right.command
  );
}

export function iosMaestroArguments(scope, simulator) {
  if (!IOS_SCOPES.includes(scope) || !UUID.test(simulator))
    fail("ios-scope-invalid");
  return [
    "--device",
    simulator,
    "test",
    "--driver-host-port",
    String(scope.port),
    "--test-output-dir",
    join("native-results", scope.output),
    "-e",
    "APP_ID=com.example.whimway",
    "-e",
    `IOS_DRIVER_PORT=${scope.port}`,
    "-e",
    `EXPO_DEV_URL=${EXPO_URL}`,
    join("e2e-native", scope.flow),
  ];
}

export function isOwnedMaestroRoot(process, scope, groupId, simulator) {
  if (process.pid !== groupId || process.pgid !== groupId) return false;
  const args = iosMaestroArguments(scope, simulator).join(" ");
  // The official launcher execs Java. Accept its brief shell phase too, but
  // never signal another Java command or a Maestro invocation with other args.
  return (
    (/^\S*\/bin\/java\s/.test(process.command) &&
      / -classpath \/\S+\/\.maestro\/lib\/\* /.test(process.command) &&
      process.command.endsWith(` maestro.cli.AppKt ${args}`)) ||
    (new RegExp(`^(?:/bin/(?:sh|bash) )?/\\S+/\\.maestro/bin/maestro `).test(
      process.command,
    ) &&
      process.command.endsWith(`/maestro ${args}`))
  );
}

function driverProcess(process, simulator) {
  // CoreSimulator launches this executable through launchd, outside Maestro's
  // process group. Require both the selected device path and launchctl's exact
  // bundle/PID, rather than killing every process named *Runner*.
  const prefix = `/Library/Developer/CoreSimulator/Devices/${simulator}/data/Containers/Bundle/Application/`;
  const executable = process.command.split(/\s/)[0];
  return (
    executable.startsWith("/") &&
    executable.includes(prefix) &&
    executable.endsWith(`/${DRIVER_EXECUTABLE}.app/${DRIVER_EXECUTABLE}`)
  );
}

function xcodeProcess(process, simulator) {
  const words = process.command.split(/\s+/);
  return (
    /(?:^|\/)xcodebuild$/.test(words[0]) &&
    words.length === 8 &&
    words[1] === "test-without-building" &&
    words[2] === "-xctestrun" &&
    words[3].startsWith("/") &&
    words[3].endsWith("/maestro-driver-ios-config.xctestrun") &&
    words[4] === "-destination" &&
    words[5] === `id=${simulator}` &&
    words[6] === "-derivedDataPath" &&
    /^\/.+\/maestro_xctestrunner_xcodebuild_output\d+$/.test(words[7])
  );
}

function selectedXcodeReference(process, simulator) {
  return (
    process.command.includes("xcodebuild") &&
    process.command.includes(simulator) &&
    /maestro|xctestrun/.test(process.command)
  );
}

export function createIOSScopeTracker(simulator, groupId) {
  if (!UUID.test(simulator) || !Number.isSafeInteger(groupId) || groupId < 2)
    fail("scope-identity-invalid");
  const owned = new Map();
  let sawXcode = false;
  const remember = (process, kind) => {
    const previous = owned.get(process.pid);
    if (previous && !identityEqual(previous, process)) fail("owned-pid-reused");
    if (!previous) {
      if (owned.size >= MAX_IDENTITIES) fail("scope-process-limit");
      owned.set(process.pid, Object.freeze({ ...process, kind }));
    }
  };
  return {
    observe(snapshot) {
      const { processes, driverPid } = snapshot;
      for (const process of processes) {
        if (!selectedXcodeReference(process, simulator)) continue;
        if (!xcodeProcess(process, simulator))
          fail("xctest-command-unrecognized");
        if (process.pgid !== groupId) fail("xctest-process-not-owned");
        sawXcode = true;
        remember(process, "xcodebuild");
      }
      const drivers = processes.filter((process) =>
        driverProcess(process, simulator),
      );
      if (drivers.length > 1) fail("selected-driver-ambiguous");
      if (
        driverPid !== null &&
        !drivers.some((process) => process.pid === driverPid)
      )
        fail("driver-service-process-mismatch");
      for (const process of drivers) {
        if (!sawXcode || process.pid !== driverPid)
          fail("driver-process-not-owned");
        remember(process, "simulator-runner");
      }
      // A PID that has been recycled must never inherit an earlier kill grant.
      for (const process of processes) {
        const previous = owned.get(process.pid);
        if (previous && !identityEqual(previous, process))
          fail("owned-pid-reused");
      }
      return {
        live: processes.filter((process) => owned.has(process.pid)),
        group: processes.filter((process) => process.pgid === groupId),
        identities: [...owned.values()],
      };
    },
    identities() {
      return [...owned.values()];
    },
  };
}

export function assertIOSRunnerAbsent(snapshot, simulator) {
  if (
    snapshot.driverPid !== null ||
    snapshot.processes.some(
      (process) =>
        driverProcess(process, simulator) ||
        selectedXcodeReference(process, simulator),
    )
  )
    fail("selected-simulator-runner-already-live");
}

export async function readIOSRunnerSnapshot(simulator, run, sleep) {
  // ps and launchctl cannot be read atomically. A runner can start or exit
  // between them; require a coherent pair before granting any signal rights.
  for (let attempt = 0; attempt < 3; attempt++) {
    const [ps, services] = await Promise.all([
      run("/bin/ps", ["-ww", "-axo", "pid=,ppid=,pgid=,lstart=,command="]),
      run("xcrun", ["simctl", "spawn", simulator, "launchctl", "list"]),
    ]);
    if (ps.status !== 0 || services.status !== 0)
      fail("runner-snapshot-failed");
    const processes = parseIOSProcessTable(ps.stdout);
    const driverPid = parseIOSDriverService(services.stdout);
    const drivers = processes.filter((process) =>
      driverProcess(process, simulator),
    );
    if (drivers.length > 1) fail("selected-driver-ambiguous");
    if (
      driverPid === null
        ? drivers.length === 0
        : drivers.length === 1 && drivers[0].pid === driverPid
    )
      return { processes, driverPid };
    if (attempt < 2) await sleep(50);
  }
  fail("driver-service-process-mismatch");
}

function command(command, args, options = {}) {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        encoding: "utf8",
        timeout: 5000,
        maxBuffer: MAX_OUTPUT,
        ...options,
        env: { ...process.env, LC_ALL: "C" },
      },
      (error, stdout, stderr) =>
        resolve({
          status: error
            ? typeof error.code === "number"
              ? error.code
              : null
            : 0,
          error: error ? String(error.code ?? "command-failed") : null,
          stdout: stdout ?? "",
          stderr: stderr ?? "",
        }),
    );
  });
}

export function iosRunnerDependencies(workspace, simulator) {
  const directory = join(
    workspace,
    "native-test-artifacts",
    "ios-runner-lifecycle",
  );
  const run = (executable, args, options) =>
    command(executable, args, { cwd: workspace, ...options });
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  return {
    now: Date.now,
    sleep,
    run,
    snapshot: () => readIOSRunnerSnapshot(simulator, run, sleep),
    start(scope) {
      const child = spawn("maestro", iosMaestroArguments(scope, simulator), {
        cwd: workspace,
        env: process.env,
        detached: true,
        stdio: "inherit",
      });
      // If identity inspection itself fails, never keep Node alive indefinitely
      // merely because an unproven child cannot safely be signalled.
      child.unref();
      const done = new Promise((resolve) => {
        child.once("error", () => resolve({ code: 1, signal: null }));
        child.once("exit", (code, signal) =>
          resolve({ code: code ?? 1, signal }),
        );
      });
      return { pid: child.pid, done };
    },
    signal(pid, signal) {
      process.kill(pid, signal);
    },
    async record(name, value) {
      await mkdir(directory, { recursive: true });
      await writeFile(
        join(directory, `${name}.json`),
        JSON.stringify(value, null, 2) + "\n",
      );
    },
    async diagnose(scope, reason) {
      const target = join(directory, scope.name);
      await mkdir(target, { recursive: true });
      const captures = [
        [
          "processes",
          "/bin/ps",
          ["-ww", "-axo", "pid=,ppid=,pgid=,lstart=,command="],
          5000,
        ],
        [
          "services",
          "xcrun",
          ["simctl", "spawn", simulator, "launchctl", "list"],
          5000,
        ],
        [
          "simulator-xctest",
          "xcrun",
          [
            "simctl",
            "spawn",
            simulator,
            "log",
            "show",
            "--style",
            "compact",
            "--last",
            "5m",
            "--info",
            "--debug",
            "--predicate",
            'process CONTAINS[c] "maestro-driver" OR process == "testmanagerd" OR ((process == "SpringBoard" OR process == "runningboardd" OR process == "launchd_sim") AND (messageType == error OR messageType == fault))',
          ],
          15000,
        ],
        [
          "host-xctest",
          "/usr/bin/log",
          [
            "show",
            "--style",
            "compact",
            "--last",
            "5m",
            "--info",
            "--debug",
            "--predicate",
            'process == "xcodebuild" OR process == "testmanagerd" OR process == "testmanagerd_sim" OR (process == "CoreSimulatorService" AND (messageType == error OR messageType == fault))',
          ],
          15000,
        ],
      ];
      const evidence = await Promise.all(
        captures.map(async ([name, executable, args, timeout]) => {
          const result = await run(executable, args, { timeout });
          // execFile already bounds each pipe; retain an explicit byte cap too.
          for (const pipe of ["stdout", "stderr"])
            await writeFile(
              join(target, `${name}.${pipe}.txt`),
              Buffer.from(result[pipe]).subarray(0, MAX_OUTPUT),
            );
          return { name, status: result.status, error: result.error };
        }),
      );
      await writeFile(
        join(target, "diagnostics.json"),
        JSON.stringify(
          {
            scope: scope.name,
            port: scope.port,
            simulator,
            reason,
            observedAt: new Date().toISOString(),
            captures: evidence,
          },
          null,
          2,
        ) + "\n",
      );
    },
    async keychain() {
      const result = await run(
        process.execPath,
        ["scripts/check-ios-simulator-keychain.mjs"],
        { timeout: 60000 },
      );
      await writeFile(
        join(workspace, "native-test-artifacts", "ios-keychain-proof.json"),
        result.stdout,
      );
      await writeFile(
        join(
          workspace,
          "native-test-artifacts",
          "ios-keychain-diagnostics.json",
        ),
        result.stderr,
      );
      return result.status === 0;
    },
    async keychainSkipped() {
      await writeFile(
        join(workspace, "native-test-artifacts", "ios-keychain-proof.json"),
        JSON.stringify({
          registrationRead: false,
          installationRead: false,
          installationStable: false,
        }) + "\n",
      );
      await writeFile(
        join(
          workspace,
          "native-test-artifacts",
          "ios-keychain-diagnostics.json",
        ),
        JSON.stringify({ stage: "ui-readiness", reason: "app-not-ready" }) +
          "\n",
      );
    },
    async largeText() {
      const changed = await run("xcrun", [
        "simctl",
        "ui",
        simulator,
        "content_size",
        "accessibility-extra-extra-extra-large",
      ]);
      if (changed.status !== 0) fail("large-text-setting-failed");
      const actual = await run("xcrun", [
        "simctl",
        "ui",
        simulator,
        "content_size",
      ]);
      await writeFile(
        join(workspace, "native-test-artifacts", "ios-content-size.txt"),
        actual.stdout,
      );
      if (actual.status !== 0) fail("large-text-read-failed");
    },
  };
}

export async function settleIOSMaestroRoot(
  identity,
  scope,
  simulator,
  dependencies,
) {
  const started = dependencies.now();
  const sent = new Set();
  while (dependencies.now() - started <= 10000) {
    const current = (await dependencies.snapshot()).processes.find(
      (row) => row.pid === identity.pid,
    );
    if (!current) return;
    if (
      !identityEqual(identity, current) ||
      !isOwnedMaestroRoot(current, scope, identity.pid, simulator)
    )
      fail("maestro-root-identity-changed");
    const signal = dependencies.now() - started >= 5000 ? "SIGKILL" : "SIGTERM";
    if (!sent.has(signal)) {
      try {
        dependencies.signal(current.pid, signal);
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
      sent.add(signal);
    }
    await dependencies.sleep(250);
  }
  fail("maestro-root-settle-timeout");
}

export async function fenceIOSScope(
  tracker,
  groupId,
  dependencies,
  options = {},
) {
  const { now, sleep, snapshot, signal } = dependencies;
  const timeoutMs = options.timeoutMs ?? 20000;
  const quietMs = options.quietMs ?? 2000;
  const started = now();
  let quietSince = null;
  const sent = new Set();
  while (now() - started <= timeoutMs) {
    const currentSnapshot = await snapshot();
    const observed = tracker.observe(currentSnapshot);
    const root =
      options.rootIdentity &&
      currentSnapshot.processes.find((process) => process.pid === groupId);
    if (
      root &&
      (!identityEqual(root, options.rootIdentity) ||
        !isOwnedMaestroRoot(root, options.scope, groupId, options.simulator))
    )
      fail("maestro-root-identity-changed");
    const live = root ? [root, ...observed.live] : observed.live;
    if (!live.length && !observed.group.length) {
      quietSince ??= now();
      if (now() - quietSince >= quietMs) return;
    } else {
      quietSince = null;
      // Stop the host installer first so it cannot launch another runner after
      // the simulator process has been stopped. Never signal a whole group.
      const ordered = live.sort(
        (a, b) =>
          Number(driverProcess(a, options.simulator ?? "")) -
          Number(driverProcess(b, options.simulator ?? "")),
      );
      for (const process of ordered) {
        const kind = now() - started >= 5000 ? "SIGKILL" : "SIGTERM";
        const key = `${process.pid}:${kind}`;
        if (sent.has(key)) continue;
        // Freshly revalidate birth time, command and scope PGID immediately
        // before each individual signal. PID reuse revokes the entire fence.
        const fresh = await snapshot();
        const freshOwned = tracker.observe(fresh).live;
        const current =
          process.pid === groupId && options.rootIdentity
            ? fresh.processes.find((item) => item.pid === groupId)
            : freshOwned.find((item) => item.pid === process.pid);
        if (!current) continue;
        if (!identityEqual(current, process)) fail("signal-identity-changed");
        if (
          current.pid === groupId &&
          !isOwnedMaestroRoot(
            current,
            options.scope,
            groupId,
            options.simulator,
          )
        )
          fail("signal-root-not-owned");
        if (
          !driverProcess(current, options.simulator ?? "") &&
          current.pgid !== groupId
        )
          fail("signal-process-not-owned");
        try {
          signal(current.pid, kind);
        } catch (error) {
          if (error?.code !== "ESRCH") throw error;
        }
        sent.add(key);
      }
    }
    await sleep(250);
  }
  fail("runner-absence-fence-timeout");
}

export async function runOwnedIOSScope(scope, simulator, dependencies) {
  const { snapshot, start, now, sleep, record, diagnose } = dependencies;
  assertIOSRunnerAbsent(await snapshot(), simulator);
  const child = start(scope);
  if (!Number.isSafeInteger(child.pid) || child.pid < 2)
    fail("maestro-start-failed");
  const tracker = createIOSScopeTracker(simulator, child.pid);
  let exited = false;
  let result;
  let failure = null;
  let diagnosticFailure = null;
  let settleFailure = null;
  let rootIdentity;
  const completion = child.done.then((value) => {
    exited = true;
    result = value;
  });
  const started = now();
  try {
    while (!exited) {
      const current = await snapshot();
      const root = current.processes.find(
        (process) => process.pid === child.pid,
      );
      if (root) {
        if (!isOwnedMaestroRoot(root, scope, child.pid, simulator))
          fail("maestro-root-not-owned");
        // The launcher may exec Java without changing PID/birth time. The
        // latest observed identity is required if monitoring itself fails.
        if (rootIdentity && rootIdentity.started !== root.started)
          fail("maestro-pid-reused");
        rootIdentity = root;
      }
      tracker.observe(current);
      await Promise.race([completion, sleep(1000)]);
    }
    await completion;
  } catch (error) {
    failure = error instanceof Error ? error.message : "runner-monitor-failed";
  }
  const passed = !failure && result?.code === 0;
  // Capture at the failing phase, before another scope can replace the driver
  // and before the final workflow's last-five-minute window loses the cause.
  const capture = async (reason) => {
    try {
      await diagnose(scope, reason);
    } catch {
      diagnosticFailure = "failure-diagnostics-unavailable";
    }
  };
  if (!passed) await capture(failure ?? "maestro-failed");
  if (!exited && rootIdentity) {
    try {
      await settleIOSMaestroRoot(rootIdentity, scope, simulator, dependencies);
    } catch (error) {
      settleFailure =
        error instanceof Error ? error.message : "maestro-root-settle-failed";
    }
  }
  let fenced = false;
  try {
    await fenceIOSScope(tracker, child.pid, dependencies, {
      simulator,
      rootIdentity,
      scope,
    });
    fenced = true;
  } catch (error) {
    failure ??= error instanceof Error ? error.message : "runner-fence-failed";
    if (passed) await capture(failure);
  }
  const outcome = {
    scope: scope.name,
    port: scope.port,
    passed,
    fenced,
    code: result?.code ?? null,
    signal: result?.signal ?? null,
    reason: failure,
    diagnosticFailure,
    settleFailure,
    durationMs: now() - started,
    identities: tracker.identities(),
  };
  await record(scope.name, outcome);
  return outcome;
}

export async function runIOSNativeQA(simulator, dependencies) {
  if (!UUID.test(simulator)) fail("selected-simulator-required");
  let failed = false;
  const outcomes = [];
  for (const scope of IOS_SCOPES) {
    if (scope.name === "large-text") await dependencies.largeText();
    let outcome;
    try {
      outcome = await runOwnedIOSScope(scope, simulator, dependencies);
    } catch (error) {
      await dependencies.diagnose(
        scope,
        error instanceof Error ? error.message : "scope-start-failed",
      );
      outcome = {
        scope: scope.name,
        passed: false,
        fenced: false,
        reason: error instanceof Error ? error.message : "scope-start-failed",
      };
      await dependencies.record(scope.name, outcome);
    }
    outcomes.push(outcome);
    failed ||= !outcome.passed || !outcome.fenced;
    if (scope.name === "ready") {
      if (outcome.passed && outcome.fenced)
        failed = !(await dependencies.keychain()) || failed;
      else await dependencies.keychainSkipped();
    }
    // An unproven absence can no longer leak a runner into another scope.
    if (!outcome.fenced) break;
  }
  await dependencies.record("summary", { passed: !failed, outcomes });
  return failed ? 1 : 0;
}

export async function main(args = process.argv.slice(2), env = process.env) {
  if (
    args.length ||
    process.platform !== "darwin" ||
    env.CI !== "true" ||
    !UUID.test(env.WHIMWAY_SIMULATOR_ID ?? "") ||
    env.USE_XCODE_TEST_RUNNER
  )
    fail("disposable-ci-simulator-required");
  const workspace = resolve(env.GITHUB_WORKSPACE ?? ".");
  return runIOSNativeQA(
    env.WHIMWAY_SIMULATOR_ID,
    iosRunnerDependencies(workspace, env.WHIMWAY_SIMULATOR_ID),
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(
        error instanceof Error ? error.message : "ios-native-runner-failed",
      );
      process.exitCode = 1;
    },
  );
}
