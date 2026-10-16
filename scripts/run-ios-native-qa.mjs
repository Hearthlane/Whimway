// Maestro 2.11 can leave xcodebuild alive when driver.open fails before its
// session shutdown hook is installed. Keep each failed scope failed, and fence
// its owned runner before starting another scope on the same simulator.
// Pinned upstream cleanup and generated command contracts:
// https://github.com/mobile-dev-inc/maestro/blob/cli-2.11.0/maestro-cli/src/main/java/maestro/cli/session/MaestroSessionManager.kt
// https://github.com/mobile-dev-inc/maestro/blob/cli-2.11.0/maestro-ios-driver/src/main/kotlin/xcuitest/installer/LocalXCTestInstaller.kt
// https://github.com/mobile-dev-inc/maestro/blob/cli-2.11.0/maestro-ios-driver/src/main/kotlin/util/XCRunnerCLIUtils.kt
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

export const DRIVER_BUNDLE = "dev.mobile.maestro-driver-iosUITests.xctrunner";
const DRIVER_EXECUTABLE = "maestro-driver-iosUITests-Runner";
const SIMCTL_EXECUTABLE =
  "/Library/Developer/PrivateFrameworks/CoreSimulator.framework/Versions/A/Resources/bin/simctl";
const UUID = /^[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}$/;
const MAX_PROCESSES = 4096;
const MAX_IDENTITIES = 32;
const MAX_OUTPUT = 1024 * 1024;
const SNAPSHOT_TIMEOUT_MS = 5000;
const SERVICE_RECOVERY_TIMEOUT_MS = 15000;
const MAX_SNAPSHOT_EVIDENCE = 64;
const MAX_SNAPSHOT_EVIDENCE_BYTES = 16 * 1024 * 1024;
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
    `native-results/${scope.output}`,
    "-e",
    "APP_ID=com.example.whimway",
    "-e",
    `IOS_DRIVER_PORT=${scope.port}`,
    "-e",
    `EXPO_DEV_URL=${EXPO_URL}`,
    `e2e-native/${scope.flow}`,
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

function selectedDriverReference(process, simulator) {
  return (
    process.command.includes(`/CoreSimulator/Devices/${simulator}/`) &&
    process.command.includes("maestro-driver")
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

function maestroLogStream(process, simulator) {
  return (
    process.command ===
    `${SIMCTL_EXECUTABLE} spawn ${simulator} log stream --style syslog`
  );
}

export function createIOSScopeTracker(simulator, groupId, scope) {
  if (!UUID.test(simulator) || !Number.isSafeInteger(groupId) || groupId < 2)
    fail("scope-identity-invalid");
  const owned = new Map();
  let sawXcode = false;
  let rootBirth = null;
  const remember = (process, kind) => {
    const previous = owned.get(process.pid);
    if (previous && !identityEqual(previous, process)) fail("owned-pid-reused");
    if (!previous) {
      if (owned.size >= MAX_IDENTITIES) fail("scope-process-limit");
      owned.set(process.pid, Object.freeze({ ...process, kind }));
    }
  };
  const observeHost = (processes) => {
    for (const process of processes) {
      if (!selectedXcodeReference(process, simulator)) continue;
      if (!xcodeProcess(process, simulator))
        fail("xctest-command-unrecognized");
      if (process.pgid !== groupId) fail("xctest-process-not-owned");
      sawXcode = true;
      remember(process, "xcodebuild");
    }
    const root = scope && processes.find((process) => process.pid === groupId);
    if (root) {
      if (!isOwnedMaestroRoot(root, scope, groupId, simulator))
        fail("maestro-root-not-owned");
      if (rootBirth && rootBirth !== root.started)
        fail("maestro-root-identity-changed");
      rootBirth ??= root.started;
      const rootBorn = Date.parse(root.started);
      for (const process of processes) {
        // Pinned LocalSimulatorUtils.startDeviceLogStream returns this exact
        // direct child; IOSDriver owns its lifecycle. An unbound orphan or a
        // bare log process never acquires authority from group membership.
        if (
          process.ppid === root.pid &&
          process.pgid === groupId &&
          maestroLogStream(process, simulator) &&
          Number.isFinite(rootBorn) &&
          Number.isFinite(Date.parse(process.started)) &&
          Date.parse(process.started) >= rootBorn
        )
          remember(process, "maestro-log-stream");
      }
    }
    const drivers = processes.filter((process) =>
      selectedDriverReference(process, simulator),
    );
    if (drivers.length > 1) fail("selected-driver-ambiguous");
    for (const process of drivers) {
      if (!driverProcess(process, simulator))
        fail("driver-command-unrecognized");
      if (!sawXcode) fail("driver-process-not-owned");
    }
    for (const process of processes) {
      const previous = owned.get(process.pid);
      if (previous && !identityEqual(previous, process))
        fail("owned-pid-reused");
    }
    return {
      drivers,
      needsBinding: drivers.some((process) => !owned.has(process.pid)),
      host: processes.filter((process) =>
        ["xcodebuild", "maestro-log-stream"].includes(
          owned.get(process.pid)?.kind,
        ),
      ),
    };
  };
  return {
    // Passive monitoring can recognize an already bound native identity. It
    // cannot bind a new one or produce native signal/absence authority.
    observeHost,
    observe(snapshot) {
      const { processes, driverPid } = snapshot;
      const { drivers } = observeHost(processes);
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
        selectedDriverReference(process, simulator) ||
        selectedXcodeReference(process, simulator),
    )
  )
    fail("selected-simulator-runner-already-live");
}

function provenCommandTimeout(result) {
  return (
    result.status === null &&
    result.code === null &&
    result.killed === true &&
    result.signal === "SIGTERM" &&
    result.timedOut === true &&
    Number.isFinite(result.deadlineMs) &&
    result.deadlineMs > 0 &&
    Number.isFinite(result.elapsedMs) &&
    result.elapsedMs >= result.deadlineMs
  );
}

export async function readIOSRunnerSnapshot(
  simulator,
  run,
  sleep,
  recordAttempt = async (attempt) => {
    void attempt;
  },
  observeHost = (processes) => {
    void processes;
  },
  serviceFirst = false,
) {
  // ps and launchctl cannot be read atomically. A runner can start or exit
  // between them; require a coherent pair before granting any signal rights.
  let recoveredTimeout = false;
  let interrupted = false;
  let serviceTimeout = SNAPSHOT_TIMEOUT_MS;
  for (let attempt = 0; attempt < 3; attempt++) {
    const readProcesses = () =>
      run("/bin/ps", ["-ww", "-axo", "pid=,ppid=,pgid=,lstart=,command="], {
        timeout: SNAPSHOT_TIMEOUT_MS,
      });
    const readServices = () =>
      run("xcrun", ["simctl", "spawn", simulator, "launchctl", "list"], {
        timeout: serviceTimeout,
      });
    let ps, services;
    if (serviceFirst || recoveredTimeout) {
      // A parallel ps could be fourteen seconds old by the time a slow
      // recovered launchctl returns. Observe process birth/command only after
      // that read completes, including when this snapshot guards a signal.
      services = await readServices();
      ps = await readProcesses();
    } else
      [ps, services] = await Promise.all([readProcesses(), readServices()]);
    /** @type {ReturnType<typeof parseIOSProcessTable>} */
    let processes = [];
    if (ps.status === 0) {
      try {
        processes = parseIOSProcessTable(ps.stdout);
        // Host birth/group/argv evidence stands independently of a failed
        // simulator RPC; retain it before the paired service result is judged.
        observeHost(processes);
      } catch (error) {
        await recordAttempt({
          attempt: attempt + 1,
          ps,
          services,
          recovery: recoveredTimeout,
          reason:
            error instanceof Error ? error.message : "process-table-invalid",
        });
        throw error;
      }
    }
    if (ps.status !== 0 || services.status !== 0) {
      await recordAttempt({
        attempt: attempt + 1,
        ps,
        services,
        recovery: recoveredTimeout,
        reason: "runner-snapshot-failed",
      });
      // The 1d8 artifact retained two empty failed five-second service reads,
      // then a successful identical read with a fifteen-second diagnostic bound.
      // That artifact did not preserve timeout proof. Recover only a newly
      // proven timeout, once, with an entirely fresh process/service pair.
      if (
        (ps.status === 0 || provenCommandTimeout(ps)) &&
        (services.status === 0 || provenCommandTimeout(services)) &&
        !recoveredTimeout &&
        attempt < 2
      ) {
        recoveredTimeout = true;
        interrupted = true;
        serviceTimeout =
          services.status === 0
            ? SNAPSHOT_TIMEOUT_MS
            : SERVICE_RECOVERY_TIMEOUT_MS;
        await sleep(100);
        continue;
      }
      fail("runner-snapshot-failed");
    }
    let driverPid, coherent;
    try {
      driverPid = parseIOSDriverService(services.stdout);
      const drivers = processes.filter((process) =>
        driverProcess(process, simulator),
      );
      if (drivers.length > 1) fail("selected-driver-ambiguous");
      coherent =
        driverPid === null
          ? drivers.length === 0
          : drivers.length === 1 && drivers[0].pid === driverPid;
    } catch (error) {
      await recordAttempt({
        attempt: attempt + 1,
        ps,
        services,
        recovery: recoveredTimeout,
        reason: error instanceof Error ? error.message : "snapshot-invalid",
      });
      throw error;
    }
    await recordAttempt({
      attempt: attempt + 1,
      ps,
      services,
      recovery: recoveredTimeout,
      reason: coherent ? null : "driver-service-process-mismatch",
    });
    if (coherent) return { processes, driverPid, interrupted };
    interrupted = true;
    serviceTimeout = SNAPSHOT_TIMEOUT_MS;
    if (attempt < 2) await sleep(50);
  }
  fail("driver-service-process-mismatch");
}

export function runIOSHostCommand(command, args, options = {}) {
  const deadlineMs = options.timeout ?? SNAPSHOT_TIMEOUT_MS;
  const started = performance.now();
  const startedAt = new Date().toISOString();
  const timing = {
    execFileReturnMs: null,
    spawnEventMs: null,
    exitEventMs: null,
    closeEventMs: null,
    callbackMs: null,
  };
  return new Promise((resolve) => {
    const child = execFile(
      command,
      args,
      {
        encoding: "utf8",
        timeout: deadlineMs,
        maxBuffer: MAX_OUTPUT,
        ...options,
        env: { ...process.env, LC_ALL: "C" },
      },
      (error, stdout, stderr) => {
        const elapsedMs = Math.round(performance.now() - started);
        timing.callbackMs = elapsedMs;
        const code =
          typeof error?.code === "number" || typeof error?.code === "string"
            ? error.code
            : null;
        resolve({
          command,
          args: [...args],
          status: error
            ? typeof error.code === "number"
              ? error.code
              : null
            : 0,
          error: error ? String(error.code ?? "command-failed") : null,
          code,
          killed: error?.killed === true,
          signal: error?.signal ?? null,
          timedOut:
            error?.killed === true &&
            error.signal === "SIGTERM" &&
            code === null &&
            elapsedMs >= deadlineMs,
          deadlineMs,
          elapsedMs,
          startedAt,
          timing,
          stdout: stdout ?? "",
          stderr: stderr ?? "",
        });
      },
    );
    timing.execFileReturnMs = Math.round(performance.now() - started);
    child.once("spawn", () => {
      timing.spawnEventMs = Math.round(performance.now() - started);
    });
    child.once("exit", () => {
      timing.exitEventMs = Math.round(performance.now() - started);
    });
    child.once("close", () => {
      timing.closeEventMs = Math.round(performance.now() - started);
    });
  });
}

export function iosRunnerDependencies(
  workspace,
  simulator,
  hostCommand = runIOSHostCommand,
) {
  const directory = join(
    workspace,
    "native-test-artifacts",
    "ios-runner-lifecycle",
  );
  const run = (executable, args, options) =>
    hostCommand(executable, args, { cwd: workspace, ...options });
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let evidenceCount = 0;
  let evidenceBytes = 0;
  const firstHostRecorded = new Set();
  const recordSnapshotAttempt = async (context, attempt) => {
    if (
      !context ||
      !IOS_SCOPES.some((scope) => scope.name === context.scope) ||
      !["preflight", "monitor", "fence", "root-settle"].includes(context.phase)
    )
      fail("snapshot-context-invalid");
    if (
      context.phase !== "preflight" &&
      !attempt.reason &&
      !attempt.recovery &&
      !attempt.firstHost
    )
      return;
    const results = {
      ps: attempt.ps,
      ...(attempt.services ? { services: attempt.services } : {}),
    };
    const bytes = Object.values(results).reduce(
      (total, result) =>
        total +
        Buffer.byteLength(result.stdout) +
        Buffer.byteLength(result.stderr),
      0,
    );
    if (
      evidenceCount >= MAX_SNAPSHOT_EVIDENCE ||
      evidenceBytes + bytes > MAX_SNAPSHOT_EVIDENCE_BYTES
    )
      fail("snapshot-evidence-limit");
    evidenceBytes += bytes;
    const sequence = ++evidenceCount;
    const target = join(directory, context.scope, "snapshots");
    await mkdir(target, { recursive: true });
    const metadata = {};
    for (const [name, result] of Object.entries(results)) {
      const { stdout, stderr, ...details } = result;
      const outputs = {};
      for (const [pipe, value] of Object.entries({ stdout, stderr })) {
        const file = `${sequence}-${name}.${pipe}.txt`;
        const buffer = Buffer.from(value);
        await writeFile(join(target, file), buffer);
        outputs[pipe] = {
          file,
          bytes: buffer.length,
          sha256: createHash("sha256").update(buffer).digest("hex"),
        };
      }
      metadata[name] = { ...details, ...outputs };
    }
    await writeFile(
      join(target, `${sequence}-attempt.json`),
      JSON.stringify(
        {
          simulator,
          sequence,
          phase: context.phase,
          attempt: attempt.attempt,
          recovery: attempt.recovery,
          observation: attempt.services ? "native-full" : "host-only",
          reason: attempt.reason,
          commands: metadata,
        },
        null,
        2,
      ) + "\n",
    );
  };
  return {
    now: () => performance.now(),
    sleep,
    run,
    snapshot: (context, observeHost) =>
      readIOSRunnerSnapshot(
        simulator,
        run,
        sleep,
        (attempt) => recordSnapshotAttempt(context, attempt),
        observeHost,
        context.binding === true || context.phase === "fence",
      ),
    async hostSnapshot(context) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        const ps = await run(
          "/bin/ps",
          ["-ww", "-axo", "pid=,ppid=,pgid=,lstart=,command="],
          { timeout: SNAPSHOT_TIMEOUT_MS },
        );
        /** @type {ReturnType<typeof parseIOSProcessTable>} */
        let processes = [];
        let reason = null;
        try {
          if (ps.status !== 0) fail("runner-host-snapshot-failed");
          processes = parseIOSProcessTable(ps.stdout);
        } catch (error) {
          reason =
            error instanceof Error ? error.message : "host-snapshot-invalid";
        }
        const firstHost =
          context.phase === "monitor" && !firstHostRecorded.has(context.scope);
        await recordSnapshotAttempt(context, {
          attempt,
          ps,
          reason,
          recovery: attempt === 2,
          firstHost,
        });
        if (firstHost) firstHostRecorded.add(context.scope);
        if (reason) {
          // A passive read is not a UI attempt or authority to signal. Discard
          // timeout output completely, then obtain one new table at the same
          // bound. Unknown/parse/identity failures never enter this recovery.
          if (attempt === 1 && provenCommandTimeout(ps)) continue;
          fail(reason);
        }
        return processes;
      }
      fail("runner-host-snapshot-failed");
    },
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
        ["host-uptime", "/usr/bin/uptime", [], SNAPSHOT_TIMEOUT_MS],
        ["host-vm-stat", "/usr/bin/vm_stat", [], SNAPSHOT_TIMEOUT_MS],
        [
          "host-memory-load",
          "/usr/sbin/sysctl",
          ["hw.memsize", "vm.loadavg"],
          SNAPSHOT_TIMEOUT_MS,
        ],
        [
          "processes",
          "/bin/ps",
          ["-ww", "-axo", "pid=,ppid=,pgid=,lstart=,command="],
          SNAPSHOT_TIMEOUT_MS,
        ],
        [
          "services",
          "xcrun",
          ["simctl", "spawn", simulator, "launchctl", "list"],
          SERVICE_RECOVERY_TIMEOUT_MS,
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
          return {
            name,
            command: result.command,
            args: result.args,
            status: result.status,
            error: result.error,
            code: result.code,
            killed: result.killed,
            signal: result.signal,
            timedOut: result.timedOut,
            deadlineMs: result.deadlineMs,
            elapsedMs: result.elapsedMs,
            startedAt: result.startedAt,
            timing: result.timing,
          };
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

async function readHostProcesses(dependencies, scope, phase) {
  const context = { scope: scope.name, phase };
  return dependencies.hostSnapshot
    ? dependencies.hostSnapshot(context)
    : (await dependencies.snapshot(context)).processes;
}

export async function settleIOSHostScope(
  identity,
  tracker,
  scope,
  simulator,
  dependencies,
) {
  const started = dependencies.now();
  const sent = new Set();
  let unsafe = null;
  while (dependencies.now() - started <= 10000) {
    const processes = await readHostProcesses(
      dependencies,
      scope,
      "root-settle",
    );
    if (dependencies.now() - started > 10000)
      fail("maestro-host-settle-timeout");
    try {
      tracker.observeHost(processes);
    } catch (error) {
      unsafe ??=
        error instanceof Error ? error.message : "host-observation-failed";
    }
    const root = identity && processes.find((row) => row.pid === identity.pid);
    if (
      root &&
      (root.pgid !== identity.pgid ||
        root.started !== identity.started ||
        !isOwnedMaestroRoot(root, scope, identity.pid, simulator))
    )
      fail("maestro-root-identity-changed");
    // A foreign host never receives a signal, but cannot prevent stopping our
    // separately proven root. Full native absence still fails if it remains.
    const hosts = tracker
      .identities()
      .filter((row) => ["xcodebuild", "maestro-log-stream"].includes(row.kind))
      .filter((row) =>
        processes.some((current) => identityEqual(row, current)),
      );
    const live = root ? [root, ...hosts] : hosts;
    if (!live.length) {
      if (unsafe) fail(unsafe);
      return;
    }
    for (const expected of live) {
      const current = (
        await readHostProcesses(dependencies, scope, "root-settle")
      ).find((row) => row.pid === expected.pid);
      if (dependencies.now() - started > 10000)
        fail("maestro-host-settle-timeout");
      if (!current) continue;
      if (identity && current.pid === identity.pid) {
        // The official launcher may exec Java between observations; only that
        // same birth/group with this scope's exact allowlisted argv is valid.
        if (
          current.pgid !== identity.pgid ||
          current.started !== identity.started ||
          !isOwnedMaestroRoot(current, scope, identity.pid, simulator)
        )
          fail("maestro-root-identity-changed");
      } else if (
        !identityEqual(expected, current) ||
        !(expected.kind === "maestro-log-stream"
          ? maestroLogStream(current, simulator)
          : xcodeProcess(current, simulator))
      )
        fail("host-signal-identity-changed");
      const signal =
        dependencies.now() - started >= 5000 ? "SIGKILL" : "SIGTERM";
      const key = `${expected.pid}:${signal}`;
      if (sent.has(key)) continue;
      try {
        dependencies.signal(current.pid, signal);
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
      sent.add(key);
    }
    await dependencies.sleep(250);
  }
  fail("maestro-host-settle-timeout");
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
    const context = { scope: options.scope?.name, phase: "fence" };
    const currentSnapshot = await snapshot(context);
    if (now() - started > timeoutMs) fail("runner-absence-fence-timeout");
    options.observe?.(currentSnapshot);
    if (currentSnapshot.interrupted === true) quietSince = null;
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
        const fresh = await snapshot(context);
        if (now() - started > timeoutMs) fail("runner-absence-fence-timeout");
        options.observe?.(fresh);
        if (fresh.interrupted === true) quietSince = null;
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
  assertIOSRunnerAbsent(
    await snapshot({ scope: scope.name, phase: "preflight" }),
    simulator,
  );
  const child = start(scope);
  if (!Number.isSafeInteger(child.pid) || child.pid < 2)
    fail("maestro-start-failed");
  const tracker = createIOSScopeTracker(simulator, child.pid, scope);
  let exited = false;
  let result;
  let failure = null;
  let diagnosticFailure = null;
  let settleFailure = null;
  let fenceFailure = null;
  let fenceEvidence = null;
  let rootIdentity;
  const completion = child.done.then((value) => {
    exited = true;
    result = value;
  });
  const started = now();
  const retainHost = (processes) => {
    const root = processes.find((process) => process.pid === child.pid);
    if (root) {
      if (!isOwnedMaestroRoot(root, scope, child.pid, simulator))
        fail("maestro-root-not-owned");
      if (
        rootIdentity &&
        (rootIdentity.started !== root.started ||
          rootIdentity.pgid !== root.pgid)
      )
        fail("maestro-pid-reused");
      rootIdentity = root;
    }
    return tracker.observeHost(processes);
  };
  try {
    while (!exited) {
      const host = await readHostProcesses(dependencies, scope, "monitor");
      const passive = retainHost(host);
      if (passive.needsBinding) {
        // Newly observed runners bind only through selected launchctl plus a
        // post-service ps read. Existing native identity is passive cache only.
        const current = await snapshot(
          { scope: scope.name, phase: "monitor", binding: true },
          retainHost,
        );
        retainHost(current.processes);
        tracker.observe(current);
      }
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
  const settleHost = async () => {
    if (
      !rootIdentity &&
      !tracker
        .identities()
        .some((row) => ["xcodebuild", "maestro-log-stream"].includes(row.kind))
    )
      return;
    try {
      await settleIOSHostScope(
        rootIdentity,
        tracker,
        scope,
        simulator,
        dependencies,
      );
    } catch (error) {
      settleFailure ??=
        error instanceof Error ? error.message : "xctest-host-settle-failed";
    }
  };
  if (!passed) await settleHost();
  let fenced = false;
  try {
    await fenceIOSScope(tracker, child.pid, dependencies, {
      simulator,
      rootIdentity,
      scope,
      observe: (current) => {
        const relevant = current.processes.filter(
          (row) =>
            row.pgid === child.pid || selectedDriverReference(row, simulator),
        );
        fenceEvidence = {
          driverPid: current.driverPid,
          interrupted: current.interrupted === true,
          processes: relevant.slice(0, MAX_IDENTITIES),
          truncated: relevant.length > MAX_IDENTITIES,
        };
      },
    });
    fenced = true;
  } catch (error) {
    fenceFailure =
      error instanceof Error ? error.message : "runner-fence-failed";
    failure ??= fenceFailure;
    if (passed) {
      await capture(failure);
      await settleHost();
    }
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
    fenceFailure,
    fenceEvidence: fenced ? null : fenceEvidence,
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
