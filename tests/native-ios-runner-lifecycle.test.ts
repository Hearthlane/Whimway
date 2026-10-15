import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { execPath } from "node:process";
import {
  DRIVER_BUNDLE,
  IOS_SCOPES,
  assertIOSRunnerAbsent,
  createIOSScopeTracker,
  fenceIOSScope,
  iosMaestroArguments,
  iosRunnerDependencies,
  isOwnedMaestroRoot,
  main,
  parseIOSDriverService,
  parseIOSProcessTable,
  readIOSRunnerSnapshot,
  runIOSNativeQA,
  runIOSHostCommand,
  runOwnedIOSScope,
} from "../scripts/run-ios-native-qa.mjs";

// Failure IDs/times come from retained f17 run38810854902/runtime12011462414:
// ready xcodebuild15864 outlived its CLI timeout; reminders runner35427 later
// died during deviceInfo AX lookup. Process rows below are simulations of the
// pinned XCRunnerCLIUtils command/launcher contracts, not captured ps output.
const SIMULATOR = "10B884BF-749F-4E8B-AFCD-26AB8F1DBD01";
const OTHER_SIMULATOR = "20B884BF-749F-4E8B-AFCD-26AB8F1DBD02";
const STARTED = "Thu Oct 15 22:24:07 2026";
const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      if (
        resolve(dirname(directory)) !== resolve(tmpdir()) ||
        !basename(directory).startsWith("whimway-ios-lifecycle-")
      )
        throw Error("Unexpected test cleanup path");
      await rm(directory, { recursive: true, force: true });
    }),
  );
});
type Process = ReturnType<typeof parseIOSProcessTable>[number];
type Snapshot = { processes: Process[]; driverPid: number | null };
type Scope = (typeof IOS_SCOPES)[number];

function process(
  pid: number,
  command: string,
  pgid = 1000,
  ppid = 1000,
): Process {
  return { pid, ppid, pgid, started: STARTED, command };
}

function xcode(pid = 15864, pgid = 1000, simulator = SIMULATOR) {
  return process(
    pid,
    `/Applications/Xcode.app/Contents/Developer/usr/bin/xcodebuild test-without-building -xctestrun /var/folders/test/T/${simulator}123/maestro-driver-ios-config.xctestrun -destination id=${simulator} -derivedDataPath /var/folders/test/T/maestro_xctestrunner_xcodebuild_output16935324987093540578`,
    pgid,
  );
}

function runner(pid = 35427, simulator = SIMULATOR) {
  return process(
    pid,
    `/Users/runner/Library/Developer/CoreSimulator/Devices/${simulator}/data/Containers/Bundle/Application/ABCDEF12-1234-1234-1234-123456789012/maestro-driver-iosUITests-Runner.app/maestro-driver-iosUITests-Runner -XCTest`,
    35000,
    1,
  );
}

function snapshot(
  processes: Process[],
  driverPid: number | null = null,
): Snapshot {
  return { processes, driverPid };
}

function hostResult(overrides: Record<string, unknown> = {}) {
  return {
    status: 0,
    error: null,
    code: null,
    killed: false,
    signal: null,
    timedOut: false,
    deadlineMs: 5000,
    elapsedMs: 2,
    startedAt: "2026-10-15T23:31:00.000Z",
    stdout: "",
    stderr: "",
    ...overrides,
  };
}

function timedOutService(deadlineMs = 5000) {
  return hostResult({
    status: null,
    error: "command-failed",
    killed: true,
    signal: "SIGTERM",
    timedOut: true,
    deadlineMs,
    elapsedMs: deadlineMs + 2,
  });
}

function psText(rows: Process[]) {
  return (
    rows
      .map(
        (row) =>
          `${row.pid} ${row.ppid} ${row.pgid} ${row.started} ${row.command}`,
      )
      .join("\n") + "\n"
  );
}

function machine(
  options: {
    exitCode?: number;
    stubborn?: boolean;
    unknownGroupMember?: boolean;
    mutateAfterExit?: (rows: Process[]) => Process[];
    baseline?: Snapshot;
    keychainPass?: boolean;
    hangCli?: boolean;
    monitorFailure?: boolean;
    diagnoseFailure?: boolean;
    foreignAfterStart?: boolean;
  } = {},
) {
  let clock = 0;
  let rows: Process[] = options.baseline?.processes ?? [
    xcode(8001, 8000, OTHER_SIMULATOR),
    runner(8002, OTHER_SIMULATOR),
    process(
      8003,
      "/Applications/Xcode.app/Contents/Developer/usr/bin/xcodebuild -workspace Whimway.xcworkspace build",
      8000,
    ),
  ];
  let driverPid: number | null = options.baseline?.driverPid ?? null;
  let groupId = 1000;
  let exitAt = Infinity;
  let finish:
    ((value: { code: number; signal: string | null }) => void) | undefined;
  let inspectionFailed = false;
  const events: string[] = [];
  const signals: [number, string][] = [];
  const records = new Map<string, unknown>();
  const dependencies = {
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms;
      if (clock >= exitAt && finish) {
        rows = rows
          .filter((row) => row.pid !== groupId)
          .map((row) => (row.pgid === groupId ? { ...row, ppid: 1 } : row));
        rows = options.mutateAfterExit?.(rows) ?? rows;
        events.push("maestro-exit");
        const resolve = finish;
        finish = undefined;
        resolve({ code: options.exitCode ?? 1, signal: null });
      }
    },
    snapshot: async () => {
      if (options.monitorFailure && clock >= 1000 && !inspectionFailed) {
        inspectionFailed = true;
        throw Error("simulated-monitor-failure");
      }
      if (options.foreignAfterStart && clock >= 1000)
        rows = rows.map((row) =>
          row.pid === groupId + 1 ? { ...row, pgid: 999 } : row,
        );
      return snapshot(
        rows.map((row) => ({ ...row })),
        driverPid,
      );
    },
    start: (scope: Scope) => {
      events.push(`start:${scope.name}`);
      groupId += 100;
      rows = [
        ...rows,
        process(
          groupId,
          `/usr/bin/java -classpath /Users/runner/.maestro/lib/* maestro.cli.AppKt ${iosMaestroArguments(scope, SIMULATOR).join(" ")}`,
          groupId,
          99,
        ),
        { ...xcode(groupId + 1, groupId), ppid: groupId },
        runner(groupId + 2),
      ];
      if (options.unknownGroupMember)
        rows.push(process(groupId + 3, "/usr/bin/unknown-worker", groupId));
      driverPid = groupId + 2;
      exitAt = options.hangCli ? Infinity : clock + 1000;
      const done = new Promise<{ code: number; signal: string | null }>(
        (resolve) => {
          finish = resolve;
        },
      );
      return { pid: groupId, done };
    },
    signal: (pid: number, signal: string) => {
      signals.push([pid, signal]);
      events.push(`signal:${pid}:${signal}`);
      if (!options.stubborn || signal === "SIGKILL") {
        rows = rows.filter((row) => row.pid !== pid);
        if (driverPid === pid) driverPid = null;
      }
    },
    diagnose: async (scope: Scope, reason: string) => {
      events.push(`diagnose:${scope.name}:${reason}`);
      if (options.diagnoseFailure)
        throw Error("simulated-artifact-write-failure");
    },
    record: async (name: string, value: unknown) => {
      records.set(name, value);
      events.push(`record:${name}`);
    },
    keychain: async () => {
      events.push("keychain");
      return options.keychainPass ?? true;
    },
    keychainSkipped: async () => {
      events.push("keychain-skipped");
    },
    largeText: async () => {
      events.push("large-text");
    },
  };
  return {
    dependencies,
    events,
    signals,
    records,
    current: () => snapshot(rows, driverPid),
    elapsed: () => clock,
  };
}

describe("bounded iOS runner identity parsing", () => {
  it("records macOS ps PID, parent, owned group and stable birth time", () => {
    const row = xcode();
    expect(
      parseIOSProcessTable(
        `  ${row.pid} 123 1000 Thu Oct 15 22:24:07 2026 ${row.command}\n`,
      ),
    ).toEqual([{ ...row, ppid: 123 }]);
    expect(
      parseIOSProcessTable(" 7 1 7 Thu Oct  1 02:03:04 2026 /sbin/launchd\n")[0]
        .started,
    ).toBe("Thu Oct 1 02:03:04 2026");
  });

  it.each([
    "broken process output",
    "1 0 1 missing-birth-identity /sbin/launchd",
    "99999999999999999999 0 0 Thu Oct 15 22:24:07 2026 fake",
    "1 0 1 Thu Oct 15 22:24:07 2026 fake\n1 0 1 Thu Oct 15 22:24:07 2026 duplicate",
    "x".repeat(1024 * 1024 + 1),
  ])(
    "fails closed on malformed, recycled-table or unbounded process output",
    (text) => {
      expect(() => parseIOSProcessTable(text)).toThrow();
    },
  );

  it("corroborates the exact simulator driver launchctl bundle and PID", () => {
    expect(
      parseIOSDriverService(
        `PID\tStatus\tLabel\n35427\t0\tUIKitApplication:${DRIVER_BUNDLE}[abc][rb-legacy]\n`,
      ),
    ).toBe(35427);
    expect(parseIOSDriverService(`- 0 ${DRIVER_BUNDLE}\n`)).toBeNull();
    expect(
      parseIOSDriverService("PID Status Label\n123 0 com.example.whimway\n"),
    ).toBeNull();
  });

  it("allows the OS kernel entry without ever granting it runner ownership", () => {
    const rows = parseIOSProcessTable(
      "0 0 0 Thu Oct 15 22:24:07 2026 kernel_task\n",
    );
    expect(
      createIOSScopeTracker(SIMULATOR, 1000).observe(snapshot(rows)).live,
    ).toEqual([]);
    expect(() => parseIOSDriverService(`0 0 ${DRIVER_BUNDLE}`)).toThrow(
      "pid-invalid",
    );
  });

  it("requires an owned Maestro launcher or Java main class with this scope's exact arguments", () => {
    const args = iosMaestroArguments(IOS_SCOPES[0], SIMULATOR).join(" ");
    const java = process(
      1000,
      `/opt/java/bin/java -classpath /Users/runner/.maestro/lib/* maestro.cli.AppKt ${args}`,
    );
    expect(isOwnedMaestroRoot(java, IOS_SCOPES[0], 1000, SIMULATOR)).toBe(true);
    expect(
      isOwnedMaestroRoot(
        process(1000, `/bin/sh /Users/runner/.maestro/bin/maestro ${args}`),
        IOS_SCOPES[0],
        1000,
        SIMULATOR,
      ),
    ).toBe(true);
    expect(
      isOwnedMaestroRoot(
        { ...java, pgid: 999 },
        IOS_SCOPES[0],
        1000,
        SIMULATOR,
      ),
    ).toBe(false);
    expect(isOwnedMaestroRoot(java, IOS_SCOPES[1], 1000, SIMULATOR)).toBe(
      false,
    );
    expect(isOwnedMaestroRoot(java, IOS_SCOPES[0], 1000, OTHER_SIMULATOR)).toBe(
      false,
    );
    expect(
      isOwnedMaestroRoot(
        { ...java, command: java.command + " --unexpected" },
        IOS_SCOPES[0],
        1000,
        SIMULATOR,
      ),
    ).toBe(false);
    expect(
      isOwnedMaestroRoot(
        {
          ...java,
          command: java.command.replace("maestro.cli.AppKt", "unrelated.Main"),
        },
        IOS_SCOPES[0],
        1000,
        SIMULATOR,
      ),
    ).toBe(false);
  });

  it("waits briefly for a coherent process/service observation but never grants mismatched PID ownership", async () => {
    let attempts = 0;
    let sleeps = 0;
    const row = runner();
    const ps = `${row.pid} ${row.ppid} ${row.pgid} ${row.started} ${row.command}\n`;
    const run = async (executable: string) => {
      if (executable === "/bin/ps") {
        attempts++;
        return { status: 0, stdout: attempts === 1 ? "" : ps };
      }
      return { status: 0, stdout: `${row.pid} 0 ${DRIVER_BUNDLE}\n` };
    };
    expect(
      (
        await readIOSRunnerSnapshot(SIMULATOR, run, async () => {
          sleeps++;
        })
      ).driverPid,
    ).toBe(row.pid);
    expect(attempts).toBe(2);
    expect(sleeps).toBe(1);
    await expect(
      readIOSRunnerSnapshot(
        SIMULATOR,
        async (executable: string) => ({
          status: 0,
          stdout: executable === "/bin/ps" ? "" : `999 0 ${DRIVER_BUNDLE}\n`,
        }),
        async () => {},
      ),
    ).rejects.toThrow("mismatch");
  });

  it.each([
    `35427 0 ${DRIVER_BUNDLE}.unexpected`,
    `35427 0 ${DRIVER_BUNDLE}\n35428 0 ${DRIVER_BUNDLE}`,
    `not-a-pid 0 ${DRIVER_BUNDLE}`,
    `${DRIVER_BUNDLE}`,
  ])("rejects unknown or ambiguous driver service records", (text) => {
    expect(() => parseIOSDriverService(text)).toThrow();
  });

  it("allows other simulators and real app compilation, but rejects any live selected driver before launching", () => {
    expect(() =>
      assertIOSRunnerAbsent(
        snapshot([
          xcode(2, 2, OTHER_SIMULATOR),
          runner(3, OTHER_SIMULATOR),
          process(
            4,
            "/usr/bin/xcodebuild -workspace Whimway.xcworkspace build",
          ),
        ]),
        SIMULATOR,
      ),
    ).not.toThrow();
    expect(() => assertIOSRunnerAbsent(snapshot([xcode()]), SIMULATOR)).toThrow(
      "already-live",
    );
    expect(() =>
      assertIOSRunnerAbsent(snapshot([runner()], 35427), SIMULATOR),
    ).toThrow("already-live");
    expect(() => assertIOSRunnerAbsent(snapshot([], 35427), SIMULATOR)).toThrow(
      "already-live",
    );
  });
});

describe("owned XCTest scope teardown and absence fence", () => {
  it("retains xcodebuild ownership across CLI exit/reparenting, captures failure first, and signals only this scope", async () => {
    const test = machine();
    const result = await runOwnedIOSScope(
      IOS_SCOPES[0],
      SIMULATOR,
      test.dependencies,
    );
    expect(result).toMatchObject({ passed: false, fenced: true, code: 1 });
    expect(result.identities.map((row) => row.pid)).toEqual([1101, 1102]);
    expect(result.identities[0].ppid).toBe(1100);
    expect(test.signals).toEqual([
      [1101, "SIGTERM"],
      [1102, "SIGTERM"],
    ]);
    expect(test.events.indexOf("diagnose:ready:maestro-failed")).toBeLessThan(
      test.events.indexOf("signal:1101:SIGTERM"),
    );
    expect(test.current().processes.map((row) => row.pid)).toEqual([
      8001, 8002, 8003,
    ]);
    expect(test.elapsed()).toBeGreaterThanOrEqual(3000);
  });

  it("cleans a successful scope too, without changing its outcome or app state", async () => {
    const test = machine({ exitCode: 0 });
    const result = await runOwnedIOSScope(
      IOS_SCOPES[1],
      SIMULATOR,
      test.dependencies,
    );
    expect(result).toMatchObject({ passed: true, fenced: true, code: 0 });
    expect(test.events.some((event) => event.startsWith("diagnose:"))).toBe(
      false,
    );
    expect(test.signals.every(([pid]) => pid === 1101 || pid === 1102)).toBe(
      true,
    );
  });

  it("settles a proven root after monitor failure even when TERM is ignored, without retrying the flow", async () => {
    const test = machine({
      monitorFailure: true,
      hangCli: true,
      stubborn: true,
    });
    const result = await runOwnedIOSScope(
      IOS_SCOPES[0],
      SIMULATOR,
      test.dependencies,
    );
    expect(result).toMatchObject({
      passed: false,
      fenced: true,
      reason: "simulated-monitor-failure",
    });
    expect(test.signals.filter(([pid]) => pid === 1100)).toEqual([
      [1100, "SIGTERM"],
      [1100, "SIGKILL"],
    ]);
    expect(test.events.filter((event) => event.startsWith("start:"))).toEqual([
      "start:ready",
    ]);
    expect(test.current().processes.map((row) => row.pid)).toEqual([
      8001, 8002, 8003,
    ]);
    expect(test.elapsed()).toBeLessThan(15000);
  });

  it("does not let unavailable failure diagnostics bypass teardown", async () => {
    const test = machine({ diagnoseFailure: true });
    const result = await runOwnedIOSScope(
      IOS_SCOPES[0],
      SIMULATOR,
      test.dependencies,
    );
    expect(result).toMatchObject({
      passed: false,
      fenced: true,
      diagnosticFailure: "failure-diagnostics-unavailable",
    });
    expect(test.signals).toHaveLength(2);
  });

  it("settles only the proven root when a foreign XCTest identity interrupts monitoring, then blocks later scopes", async () => {
    const test = machine({
      foreignAfterStart: true,
      hangCli: true,
      stubborn: true,
    });
    expect(await runIOSNativeQA(SIMULATOR, test.dependencies)).toBe(1);
    expect(test.events.filter((event) => event.startsWith("start:"))).toEqual([
      "start:ready",
    ]);
    expect(test.signals).toEqual([
      [1100, "SIGTERM"],
      [1100, "SIGKILL"],
    ]);
    expect(test.current().processes.find((row) => row.pid === 1101)?.pgid).toBe(
      999,
    );
    expect(test.elapsed()).toBeLessThan(10000);
  });

  it("escalates only a freshly revalidated owned identity after a bounded TERM grace period", async () => {
    const test = machine({ stubborn: true });
    const result = await runOwnedIOSScope(
      IOS_SCOPES[0],
      SIMULATOR,
      test.dependencies,
    );
    expect(result.fenced).toBe(true);
    expect(test.signals).toEqual([
      [1101, "SIGTERM"],
      [1102, "SIGTERM"],
      [1101, "SIGKILL"],
      [1102, "SIGKILL"],
    ]);
    expect(test.elapsed()).toBeGreaterThanOrEqual(8000);
  });

  it.each([
    (rows: Process[]) =>
      rows.map((row) =>
        row.pid === 1101
          ? { ...row, started: "Thu Oct 15 22:25:00 2026" }
          : row,
      ),
    (rows: Process[]) =>
      rows.map((row) => (row.pid === 1101 ? { ...row, pgid: 9000 } : row)),
    (rows: Process[]) =>
      rows.map((row) =>
        row.pid === 1102
          ? { ...row, command: "/usr/bin/unrelated-recycled-process" }
          : row,
      ),
  ])(
    "revokes ownership when PID birth, group or executable changes before teardown",
    async (mutateAfterExit) => {
      const test = machine({ mutateAfterExit });
      const result = await runOwnedIOSScope(
        IOS_SCOPES[0],
        SIMULATOR,
        test.dependencies,
      );
      expect(result.fenced).toBe(false);
      expect(test.signals).toEqual([]);
    },
  );

  it("cannot signal a same-name runner without selected simulator service corroboration", () => {
    const tracker = createIOSScopeTracker(SIMULATOR, 1000);
    expect(() => tracker.observe(snapshot([xcode(), runner()], null))).toThrow(
      "not-owned",
    );
    expect(() =>
      createIOSScopeTracker(SIMULATOR, 1000).observe(
        snapshot([runner()], 35427),
      ),
    ).toThrow("not-owned");
    expect(() =>
      createIOSScopeTracker(SIMULATOR, 1000).observe(
        snapshot([xcode()], 35427),
      ),
    ).toThrow("mismatch");
  });

  it("never grants a selected simulator xcodebuild from a different process group", () => {
    expect(() =>
      createIOSScopeTracker(SIMULATOR, 1000).observe(
        snapshot([xcode(99, 999)]),
      ),
    ).toThrow("not-owned");
    const unfamiliar = {
      ...xcode(),
      command: xcode().command + " --unknown-option",
    };
    expect(() =>
      createIOSScopeTracker(SIMULATOR, 1000).observe(snapshot([unfamiliar])),
    ).toThrow("unrecognized");
  });

  it("unknown surviving group members block absence without broad process-group killing", async () => {
    const test = machine({ unknownGroupMember: true });
    const result = await runOwnedIOSScope(
      IOS_SCOPES[0],
      SIMULATOR,
      test.dependencies,
    );
    expect(result).toMatchObject({
      fenced: false,
      reason: "runner-absence-fence-timeout",
    });
    expect(test.signals).toEqual([
      [1101, "SIGTERM"],
      [1102, "SIGTERM"],
    ]);
    expect(test.current().processes.some((row) => row.pid === 1103)).toBe(true);
    expect(test.elapsed()).toBeLessThan(22000);
  });

  it("checks absence for a continuous two seconds and catches a late runner during that fence", async () => {
    const tracker = createIOSScopeTracker(SIMULATOR, 1000);
    tracker.observe(snapshot([xcode(), runner()], 35427));
    let clock = 0;
    let signalled = false;
    const calls: [number, string][] = [];
    await fenceIOSScope(
      tracker,
      1000,
      {
        now: () => clock,
        sleep: async (ms: number) => {
          clock += ms;
        },
        snapshot: async () =>
          clock >= 1500 && !signalled
            ? snapshot([runner()], 35427)
            : snapshot([]),
        signal: (pid: number, signal: string) => {
          calls.push([pid, signal]);
          signalled = true;
        },
      },
      { simulator: SIMULATOR },
    );
    expect(calls).toEqual([[35427, "SIGTERM"]]);
    expect(clock).toBeGreaterThanOrEqual(3750);
  });
});

describe("selected simulator service-read latency and exact attempt provenance", () => {
  it("retains real execFile timeout, signal and deadline evidence instead of inferring a null status", async () => {
    const result = await runIOSHostCommand(
      execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { timeout: 80 },
    );
    expect(result).toMatchObject({
      status: null,
      code: null,
      error: "command-failed",
      killed: true,
      signal: "SIGTERM",
      timedOut: true,
      deadlineMs: 80,
      stdout: "",
      stderr: "",
    });
    expect(result.elapsedMs).toBeGreaterThanOrEqual(80);
    expect(Number.isFinite(Date.parse(result.startedAt))).toBe(true);
  });

  it("distinguishes an actual process exit from timeout and retains both output pipes", async () => {
    const result = await runIOSHostCommand(
      execPath,
      [
        "-e",
        "process.stdout.write('out'); process.stderr.write('err'); process.exitCode = 7",
      ],
      { timeout: 3000 },
    );
    expect(result).toMatchObject({
      status: 7,
      code: 7,
      error: "7",
      killed: false,
      signal: null,
      timedOut: false,
      deadlineMs: 3000,
      stdout: "out",
      stderr: "err",
    });
    expect(result.command).toBe(execPath);
    expect(result.args[0]).toBe("-e");
  });

  it("retains actual string spawn errors without reclassifying them as a timeout", async () => {
    const result = await runIOSHostCommand(
      join(tmpdir(), "whimway-intentionally-nonexistent-ios-probe"),
      [],
      { timeout: 1000 },
    );
    expect(result).toMatchObject({
      status: null,
      code: "ENOENT",
      error: "ENOENT",
      killed: false,
      signal: null,
      timedOut: false,
    });
  });

  it("does not let a known service timeout conceal an invalid process table", async () => {
    let serviceCalls = 0;
    await expect(
      readIOSRunnerSnapshot(
        SIMULATOR,
        async (executable: string) => {
          if (executable === "/bin/ps")
            return hostResult({ stdout: "unrecognized process record" });
          serviceCalls++;
          return timedOutService();
        },
        async () => {},
      ),
    ).rejects.toThrow("process-row-invalid");
    expect(serviceCalls).toBe(1);
  });

  it("uses one fresh full pair after a proven service timeout and returns only the new identities", async () => {
    let psCalls = 0;
    let serviceCalls = 0;
    const deadlines: [string, number][] = [];
    const attempts: unknown[] = [];
    const observed = await readIOSRunnerSnapshot(
      SIMULATOR,
      async (
        executable: string,
        _args: string[],
        options: { timeout: number },
      ) => {
        deadlines.push([executable, options.timeout]);
        if (executable === "/bin/ps") {
          psCalls++;
          return hostResult({
            stdout: psText([xcode(), runner(psCalls === 1 ? 35427 : 35428)]),
          });
        }
        serviceCalls++;
        return serviceCalls === 1
          ? timedOutService()
          : hostResult({
              deadlineMs: options.timeout,
              stdout: `35428 0 ${DRIVER_BUNDLE}\n`,
            });
      },
      async () => {},
      async (attempt: unknown) => {
        attempts.push(attempt);
      },
    );
    expect(observed.driverPid).toBe(35428);
    expect(observed.processes.map((row) => row.pid)).toEqual([15864, 35428]);
    expect(deadlines).toEqual([
      ["/bin/ps", 5000],
      ["xcrun", 5000],
      ["xcrun", 15000],
      ["/bin/ps", 5000],
    ]);
    expect(attempts).toMatchObject([
      {
        attempt: 1,
        reason: "runner-snapshot-failed",
        recovery: false,
        services: { killed: true, signal: "SIGTERM", timedOut: true },
      },
      {
        attempt: 2,
        reason: null,
        recovery: true,
        services: { status: 0, deadlineMs: 15000 },
      },
    ]);
  });

  it.each([
    hostResult({ status: 1, code: 1, error: "1", stderr: "permission denied" }),
    hostResult({ status: null, code: null, error: "command-failed" }),
    hostResult({
      status: null,
      code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
      error: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
      killed: true,
      signal: "SIGTERM",
    }),
    hostResult({
      status: null,
      code: null,
      killed: false,
      signal: "SIGTERM",
      timedOut: true,
      elapsedMs: 5002,
    }),
    hostResult({
      status: null,
      code: null,
      killed: true,
      signal: "SIGTERM",
      timedOut: true,
      elapsedMs: 4999,
    }),
  ])(
    "does not retry process exit, unknown failure, output overflow or contradictory timeout metadata",
    async (serviceFailure) => {
      let services = 0;
      await expect(
        readIOSRunnerSnapshot(
          SIMULATOR,
          async (executable: string) => {
            if (executable === "/bin/ps") return hostResult();
            services++;
            return serviceFailure;
          },
          async () => {},
        ),
      ).rejects.toThrow("runner-snapshot-failed");
      expect(services).toBe(1);
    },
  );

  it("bounds consecutive proven service timeouts to two attempts and never starts a journey", async () => {
    const test = machine();
    let serviceCalls = 0;
    test.dependencies.snapshot = () =>
      readIOSRunnerSnapshot(
        SIMULATOR,
        async (
          executable: string,
          _args: string[],
          options: { timeout: number },
        ) => {
          if (executable === "/bin/ps") return hostResult();
          serviceCalls++;
          return timedOutService(options.timeout);
        },
        async () => {},
      );
    expect(await runIOSNativeQA(SIMULATOR, test.dependencies)).toBe(1);
    expect(serviceCalls).toBe(2);
    expect(test.events.filter((event) => event.startsWith("start:"))).toEqual(
      [],
    );
    expect(test.signals).toEqual([]);
  });

  it("revalidates a retried signal observation and never signals an identity that became foreign", async () => {
    const tracker = createIOSScopeTracker(SIMULATOR, 1000);
    tracker.observe(snapshot([xcode(), runner()], 35427));
    let serviceCalls = 0;
    const signals: number[] = [];
    const dependencies = {
      now: () => 0,
      sleep: async () => {},
      signal: (pid: number) => {
        signals.push(pid);
      },
      snapshot: () =>
        readIOSRunnerSnapshot(
          SIMULATOR,
          async (executable: string) => {
            if (executable === "/bin/ps")
              return hostResult({
                stdout: psText([
                  xcode(15864, serviceCalls ? 999 : 1000),
                  runner(),
                ]),
              });
            serviceCalls++;
            return serviceCalls === 1
              ? timedOutService()
              : hostResult({ stdout: `35427 0 ${DRIVER_BUNDLE}\n` });
          },
          async () => {},
        ),
    };
    await expect(
      fenceIOSScope(tracker, 1000, dependencies, { simulator: SIMULATOR }),
    ).rejects.toThrow("not-owned");
    expect(serviceCalls).toBe(2);
    expect(signals).toEqual([]);
  });

  it("observes process birth after the slow recovered service completes and rejects changes before signalling", async () => {
    const tracker = createIOSScopeTracker(SIMULATOR, 1000);
    tracker.observe(snapshot([xcode(), runner()], 35427));
    let current = xcode();
    let services = 0;
    let processReads = 0;
    let finishService!: () => void;
    let serviceStarted!: () => void;
    const heldService = new Promise<void>((resolve) => {
      finishService = resolve;
    });
    const started = new Promise<void>((resolve) => {
      serviceStarted = resolve;
    });
    const signals: number[] = [];
    const dependencies = {
      now: () => 0,
      sleep: async () => {},
      signal: (pid: number) => {
        signals.push(pid);
      },
      snapshot: () =>
        readIOSRunnerSnapshot(
          SIMULATOR,
          async (executable: string) => {
            if (executable === "/bin/ps") {
              processReads++;
              return hostResult({ stdout: psText([current, runner()]) });
            }
            services++;
            if (services === 1) return timedOutService();
            serviceStarted();
            await heldService;
            return hostResult({ stdout: `35427 0 ${DRIVER_BUNDLE}\n` });
          },
          async () => {},
        ),
    };
    const fencing = fenceIOSScope(tracker, 1000, dependencies, {
      simulator: SIMULATOR,
    });
    const rejected = expect(fencing).rejects.toThrow("owned-pid-reused");
    await started;
    expect(processReads).toBe(1);
    current = { ...current, started: "Thu Oct 15 22:25:00 2026" };
    finishService();
    await rejected;
    expect(processReads).toBe(2);
    expect(signals).toEqual([]);
  });

  it("persists every preflight pair with exact failed/recovery output, hashes and command deadline metadata", async () => {
    const directory = await mkdtemp(join(tmpdir(), "whimway-ios-lifecycle-"));
    temporaryDirectories.push(directory);
    let serviceCalls = 0;
    const dependencies = iosRunnerDependencies(
      directory,
      SIMULATOR,
      async (
        executable: string,
        _args: string[],
        options: { timeout?: number } = {},
      ) => {
        if (executable === "/bin/ps")
          return hostResult({
            stdout: psText([process(1, "/sbin/launchd", 1, 0)]),
          });
        serviceCalls++;
        return serviceCalls === 1
          ? timedOutService()
          : hostResult({
              deadlineMs: options.timeout,
              stdout: "PID Status Label\n",
            });
      },
    );
    await dependencies.snapshot({ scope: "ready", phase: "preflight" });
    const path = join(
      directory,
      "native-test-artifacts",
      "ios-runner-lifecycle",
      "ready",
      "snapshots",
    );
    const files = await readdir(path);
    expect(files.filter((file) => file.endsWith("-attempt.json"))).toHaveLength(
      2,
    );
    const first = JSON.parse(
      await readFile(join(path, "1-attempt.json"), "utf8"),
    );
    const second = JSON.parse(
      await readFile(join(path, "2-attempt.json"), "utf8"),
    );
    expect(first).toMatchObject({
      simulator: SIMULATOR,
      phase: "preflight",
      attempt: 1,
      reason: "runner-snapshot-failed",
      commands: {
        services: {
          status: null,
          killed: true,
          signal: "SIGTERM",
          timedOut: true,
          deadlineMs: 5000,
          stdout: { bytes: 0 },
          stderr: { bytes: 0 },
        },
      },
    });
    expect(second).toMatchObject({
      phase: "preflight",
      attempt: 2,
      recovery: true,
      commands: { services: { status: 0, deadlineMs: 15000 } },
    });
    const contents = await readFile(
      join(path, second.commands.services.stdout.file),
    );
    expect(contents.toString()).toBe("PID Status Label\n");
    expect(createHash("sha256").update(contents).digest("hex")).toBe(
      second.commands.services.stdout.sha256,
    );
    expect(
      await readFile(join(path, first.commands.ps.stdout.file), "utf8"),
    ).toContain("/sbin/launchd");
  });
});

describe("four real iOS scopes retain readiness/keychain/font and failure semantics", () => {
  it("continues after fenced failures without retry and keeps ready/keychain failure honest", async () => {
    const test = machine();
    expect(await runIOSNativeQA(SIMULATOR, test.dependencies)).toBe(1);
    expect(test.events.filter((event) => event.startsWith("start:"))).toEqual([
      "start:ready",
      "start:main",
      "start:reminders",
      "start:large-text",
    ]);
    expect(test.events).toContain("keychain-skipped");
    expect(test.events).not.toContain("keychain");
    expect(test.events.indexOf("record:ready")).toBeLessThan(
      test.events.indexOf("start:main"),
    );
    expect(test.events.indexOf("large-text")).toBeLessThan(
      test.events.indexOf("start:large-text"),
    );
  });

  it("runs keychain only after genuine ready success, still fails when that proof fails", async () => {
    const test = machine({ exitCode: 0, keychainPass: false });
    expect(await runIOSNativeQA(SIMULATOR, test.dependencies)).toBe(1);
    expect(test.events.indexOf("record:ready")).toBeLessThan(
      test.events.indexOf("keychain"),
    );
    expect(test.events.indexOf("keychain")).toBeLessThan(
      test.events.indexOf("start:main"),
    );
    expect(test.events).not.toContain("keychain-skipped");
    expect(
      test.events.filter((event) => event.startsWith("start:")),
    ).toHaveLength(4);
  });

  it("returns success only when all scopes and keychain proof pass", async () => {
    const test = machine({ exitCode: 0 });
    expect(await runIOSNativeQA(SIMULATOR, test.dependencies)).toBe(0);
    expect(test.records.get("summary")).toMatchObject({ passed: true });
  });

  it("blocks every later scope when a process cannot safely be fenced", async () => {
    const test = machine({ exitCode: 0, unknownGroupMember: true });
    expect(await runIOSNativeQA(SIMULATOR, test.dependencies)).toBe(1);
    expect(test.events.filter((event) => event.startsWith("start:"))).toEqual([
      "start:ready",
    ]);
    expect(test.events).toContain("keychain-skipped");
    expect(test.events).not.toContain("large-text");
  });

  it("does not start or kill a preexisting selected simulator runner", async () => {
    const test = machine({
      baseline: snapshot([xcode(999, 999), runner()], 35427),
    });
    expect(await runIOSNativeQA(SIMULATOR, test.dependencies)).toBe(1);
    expect(test.signals).toEqual([]);
    expect(test.events.filter((event) => event.startsWith("start:"))).toEqual(
      [],
    );
    expect(test.events).toContain(
      "diagnose:ready:selected-simulator-runner-already-live",
    );
  });

  it("requires the disposable macOS CI simulator guard before any host operation", async () => {
    await expect(main(["unexpected"], { NODE_ENV: "test" })).rejects.toThrow(
      "disposable-ci-simulator-required",
    );
    await expect(
      main([], {
        NODE_ENV: "test",
        CI: "false",
        WHIMWAY_SIMULATOR_ID: SIMULATOR,
      }),
    ).rejects.toThrow("disposable-ci-simulator-required");
    await expect(
      runIOSNativeQA("booted", machine().dependencies),
    ).rejects.toThrow("selected-simulator-required");
  });

  it("wires the existing workflow through the runner after bundle warmup and preserves the outer font restore", () => {
    const workflow = readFileSync(
      new URL("../.github/workflows/native.yml", import.meta.url),
      "utf8",
    );
    const block = workflow.slice(
      workflow.indexOf(
        "- name: Prepare and exercise actual iOS development views",
      ),
      workflow.indexOf("- name: Collect bounded iOS startup diagnostics"),
    );
    expect(block.indexOf("warm-ios-bundle.mjs")).toBeLessThan(
      block.indexOf("node scripts/run-ios-native-qa.mjs"),
    );
    expect(block).toContain("trap 'xcrun simctl ui");
    expect(block).not.toContain("maestro test");
    expect(
      IOS_SCOPES.map((scope) => [scope.port, scope.flow, scope.output]),
    ).toEqual([
      [7001, "ios-ready.yaml", "ios-ready"],
      [7002, "smoke.yaml", "ios"],
      [7003, "reminders-allow.yaml", "ios-reminders"],
      [7004, "large-text.yaml", "ios-large-text"],
    ]);
  });
});
