import { describe, expect, it, vi } from "vitest";
import {
  readFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import {
  androidResetState,
  prepareAndroidApp,
} from "../e2e-native/helpers/prepare-android.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const yaml = createRequire(import.meta.url)("js-yaml") as {
  load: (source: string) => unknown;
};
const quietProcesses =
  "  PID NAME\n  525 system_server\n 1104 com.google.android.apps.nexuslauncher\n";
const quietTasks =
  "ACTIVITY MANAGER ACTIVITIES (dumpsys activity activities)\nDisplay #0\n  * Task{launcher #7 type=home A=10123:com.google.android.apps.nexuslauncher}\n    Activities=[ActivityRecord{home com.google.android.apps.nexuslauncher/.NexusLauncherActivity}]\n";
const pendingTask =
  quietTasks +
  "  * Task{old #10 type=standard A=10192:com.example.whimway}\n    Activities=[ActivityRecord{old com.example.whimway/.MainActivity}]\n    mKillProcessesOnDestroyed=true\n";
const busyProcesses =
  quietProcesses +
  "8180 com.example.whimway\n8181 com.example.whimway:worker\n";
type Snapshot = { processes: string; tasks: string };
const quiet = { processes: quietProcesses, tasks: quietTasks };
const busy = { processes: busyProcesses, tasks: pendingTask };
// Retained Android14/API34 snapshots from hosted run38664294144; only trailing
// line padding is normalized. No Whimway process/task was still alive before
// this rejected large-text launch.
const historicalFocus = {
  processes: readFileSync(
    path.join(root, "tests/fixtures/android-reset-38664294144/processes.txt"),
    "utf8",
  ),
  tasks: readFileSync(
    path.join(root, "tests/fixtures/android-reset-38664294144/tasks.txt"),
    "utf8",
  ),
};
// Exact failed-before-launch process/task dumps from hosted Android14 run
// 38670492664. Message 11/12 is a queue index; what=4 hides package warnings.
const queuedWarnings = [
  {
    scope: "smoke",
    processHash:
      "5cceb8282290a8583245c83bab255ef6c2d43faf416f42ec581802a66efaed55",
    taskHash:
      "05bd28582beefb51437f51c448a52975362633c6f2a089e291efb28c106fec07",
  },
  {
    scope: "reminders",
    processHash:
      "21382ce43bab279892f88b39be14d94d0bc52a015d5289b8301931145fe0e06a",
    taskHash:
      "85391c77ae96af10b122bb72870e4f6f69fa1e9e796c616cf0e24281560723f6",
  },
].map((source) => {
  const directory = path.join(
    root,
    "tests/fixtures/android-reset-38670492664",
    source.scope,
  );
  return {
    ...source,
    processes: readFileSync(path.join(directory, "processes.txt"), "utf8"),
    tasks: readFileSync(path.join(directory, "tasks.txt"), "utf8"),
  };
});

function fixture(snapshots: Snapshot[] = [quiet]) {
  let time = 0,
    observation = 0;
  const files = new Map<string, string>();
  const run = vi.fn((_command: string, args: string[]) => {
    time += 10;
    const command = args.slice(2).join(" ");
    let stdout = "";
    if (command === "get-serialno") stdout = "emulator-5554\n";
    else if (command.startsWith("shell pm clear")) stdout = "Success\n";
    else if (command.startsWith("shell ps"))
      stdout = snapshots[Math.min(observation, snapshots.length - 1)].processes;
    else if (command.startsWith("shell dumpsys")) {
      stdout = snapshots[Math.min(observation, snapshots.length - 1)].tasks;
      observation++;
    }
    return { status: 0, signal: null, stdout, stderr: "" };
  });
  const options = {
    serial: "emulator-5554",
    scope: "smoke",
    env: { CI: "true" },
    run,
    now: () => time,
    pause: async (milliseconds: number) => {
      time += milliseconds;
    },
    write: (name: string, value: string) => files.set(name, value),
  };
  return {
    options,
    files,
    run,
    proof: () => JSON.parse(files.get("reset-evidence.json") || "{}"),
  };
}

// Execute the actual runner's shell branches with isolated fake executables.
// No adb, Maestro, APK install, emulator or app process is started by this test.
function runNativeRunner(override: Record<string, string> = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "whimway-release-reset-"));
  try {
    mkdirSync(path.join(directory, "native-test-artifacts"), {
      recursive: true,
    });
    writeFileSync(
      path.join(directory, "native-test-artifacts/ready.json"),
      "{}",
    );
    const release = path.join(
      directory,
      "apps/mobile/android/app/build/outputs/apk/release/app-release.apk",
    );
    mkdirSync(path.dirname(release), { recursive: true });
    writeFileSync(release, "isolated runner fixture");
    const stubs = `
record() { printf '%s\\n' "$*" >> harness-trace.txt; }
adb() {
  record "adb $*"
  if [[ "$1" == get-serialno ]]; then printf 'emulator-5554\\n'; return 0; fi
  [[ "$1" == -s && "$2" == emulator-5554 ]] || return 99
  shift 2
  case "$*" in
    "shell cmd package resolve-activity "*)
      printf '%s\\n' "\${HARNESS_ACTIVITY:-com.example.whimway/.MainActivity}" ;;
    "shell am start -W -n "*)
      printf 'Status: ok\\n'; return "\${HARNESS_COLD_STATUS:-0}" ;;
  esac
  return 0
}
node() {
  record "node $*"
  if [[ "\${3:-}" == release ]]; then return "\${HARNESS_RESET_STATUS:-0}"; fi
  return 0
}
maestro() {
  record "maestro $*"
  if [[ "$*" == *e2e-native/release-launch.yaml ]]; then return "\${HARNESS_FLOW_STATUS:-0}"; fi
  return 0
}
`;
    const runner = readFileSync(
      path.join(root, "scripts/run-android-native-qa.sh"),
      "utf8",
    ).replaceAll("\r\n", "\n");
    const bash =
      process.platform === "win32"
        ? path.join(
            process.env.ProgramFiles || "C:/Program Files",
            "Git/bin/bash.exe",
          )
        : "bash";
    const result = spawnSync(bash, ["--noprofile", "--norc", "-s"], {
      cwd: directory,
      input: stubs + runner,
      encoding: "utf8",
      timeout: 10000,
      env: { ...process.env, CI: "true", ...override },
    });
    if (result.error) throw result.error;
    return {
      status: result.status,
      stderr: result.stderr,
      trace: readFileSync(path.join(directory, "harness-trace.txt"), "utf8")
        .trim()
        .split(/\r?\n/),
      coldStart: readFileSync(
        path.join(
          directory,
          "native-test-artifacts/android-release-activity-cold-start.txt",
        ),
        "utf8",
      ),
    };
  } finally {
    if (
      path.resolve(path.dirname(directory)) !== path.resolve(tmpdir()) ||
      !path.basename(directory).startsWith("whimway-release-reset-")
    )
      throw Error("Refusing cleanup outside the runner test directory.");
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("Android fixture reset and task teardown", () => {
  it.each(queuedWarnings)(
    "recognizes the actual retained $scope warning-dismissal queue without a live package task",
    ({ processes, tasks, processHash, taskHash }) => {
      expect(createHash("sha256").update(processes).digest("hex")).toBe(
        processHash,
      );
      expect(createHash("sha256").update(tasks).digest("hex")).toBe(taskHash);
      expect(tasks).toMatch(
        /Message \d+: \{ when=-\d+ms what=4 obj=com\.example\.whimway target=com\.android\.server\.wm\.AppWarnings\$UiHandler \}/,
      );
      expect(androidResetState(processes, tasks)).toEqual({
        processes: 0,
        tasks: 0,
        activities: 0,
        pending_kill: false,
        quiet: true,
      });
      expect(
        androidResetState(
          processes.replace(/\r?\n/g, "\r\n"),
          tasks.replace(/\r?\n/g, "\r\n"),
        ),
      ).toMatchObject({ quiet: true });
    },
  );
  it.each(queuedWarnings)(
    "requires continuous two-second quiet and one clear for the retained $scope queue",
    async (snapshot) => {
      const f = fixture([snapshot, snapshot, busy, snapshot]);
      const proof = await prepareAndroidApp({
        ...f.options,
        scope: snapshot.scope,
      });
      const lastBusy = proof.observations
        .map((value) => value.quiet)
        .lastIndexOf(false);
      expect(lastBusy).toBe(2);
      expect(proof.stable_quiet_ms).toBeGreaterThanOrEqual(2000);
      expect(proof.observations.length - lastBusy - 1).toBeGreaterThanOrEqual(
        5,
      );
      expect(proof).toMatchObject({ prepared: true, scope: snapshot.scope });
      expect(
        f.run.mock.calls.filter(([, args]) => args.includes("clear")),
      ).toHaveLength(1);
      expect(f.run.mock.calls.some(([, args]) => args.includes("start"))).toBe(
        false,
      );
    },
  );
  it.each(queuedWarnings)(
    "retains all live package guards alongside the known $scope warning queue",
    ({ processes, tasks }) => {
      expect(
        androidResetState(
          processes +
            "8180 com.example.whimway\n8181 com.example.whimway:worker\n",
          tasks,
        ),
      ).toMatchObject({ processes: 2, quiet: false });
      expect(
        androidResetState(
          processes,
          tasks +
            "\n  * Task{old #10 type=standard A=10192:com.example.whimway}\n",
        ),
      ).toMatchObject({ tasks: 1, activities: 0, quiet: false });
      expect(
        androidResetState(
          processes,
          tasks + "\nActivityRecord{old com.example.whimway/.MainActivity}\n",
        ),
      ).toMatchObject({ activities: 1, tasks: 0, quiet: false });
      expect(
        androidResetState(
          processes,
          tasks.replace(
            "obj=com.example.whimway",
            "obj=ActivityRecord{old com.example.whimway/.MainActivity}",
          ),
        ),
      ).toMatchObject({ activities: 1, quiet: false });
      expect(androidResetState(processes, tasks + pendingTask)).toMatchObject({
        tasks: 1,
        activities: 1,
        pending_kill: true,
        quiet: false,
      });
    },
  );
  it.each(queuedWarnings)(
    "fails closed on unknown or extended package queue forms beside the retained $scope snapshot",
    ({ processes, tasks }) => {
      const original = tasks.match(
        /^[ \t]*Message \d+: \{ when=-\d+ms what=4 obj=com\.example\.whimway target=com\.android\.server\.wm\.AppWarnings\$UiHandler \}[ \t]*\r?$/m,
      )?.[0];
      expect(original).toBeTruthy();
      for (const changed of [
        original!.replace("what=4", "what=5"),
        original!.replace("what=4", "what=14"),
        original!.replace(
          "AppWarnings$UiHandler",
          "AppWarnings$UnknownHandler",
        ),
        original!.replace(
          "AppWarnings$UiHandler",
          "ActivityTaskSupervisor$UiHandler",
        ),
        original!.replace(
          "obj=com.example.whimway",
          "obj=com.example.whimway:worker",
        ),
        original!.replace("what=4", "what=4 arg1=1"),
        original!.replace("what=4", "callback=com.example.whimway what=4"),
        original!.replace(/when=-\d+ms/, "when=unrecognized"),
        original! + " extra-state=true",
        "unknown-prefix " + original!,
      ]) {
        expect(() =>
          androidResetState(processes, tasks.replace(original!, changed)),
        ).toThrow("Unrecognized package-specific");
      }
      expect(() =>
        androidResetState(
          processes,
          tasks + "\nunknown-format com.example.whimway\n",
        ),
      ).toThrow("Unrecognized package-specific");
    },
  );
  it("recognizes the actual retained historical-focus snapshot without mistaking it for a live task", () => {
    expect(historicalFocus.tasks).toContain(
      "mLastFocusedRootTask=Task{b8f2cc1 #10 type=standard A=10192:com.example.whimway}",
    );
    expect(
      androidResetState(historicalFocus.processes, historicalFocus.tasks),
    ).toEqual({
      processes: 0,
      tasks: 0,
      activities: 0,
      pending_kill: false,
      quiet: true,
    });
  });
  it("still requires at least two stable seconds when the retained historical-focus snapshot repeats", async () => {
    const f = fixture([historicalFocus]);
    const proof = await prepareAndroidApp({
      ...f.options,
      scope: "large-text",
    });
    expect(proof).toMatchObject({ prepared: true, scope: "large-text" });
    expect(proof.stable_quiet_ms).toBeGreaterThanOrEqual(2000);
    expect(
      f.run.mock.calls.filter(([, args]) => args.includes("clear")),
    ).toHaveLength(1);
  });
  it("does not ignore a live own process, task, activity or pending kill beside the historical focus field", () => {
    expect(
      androidResetState(
        historicalFocus.processes + "\n8180 com.example.whimway\n",
        historicalFocus.tasks,
      ),
    ).toMatchObject({ processes: 1, quiet: false });
    expect(
      androidResetState(
        historicalFocus.processes,
        historicalFocus.tasks + pendingTask,
      ),
    ).toMatchObject({
      tasks: 1,
      activities: 1,
      pending_kill: true,
      quiet: false,
    });
  });
  it("still rejects other unknown package references and altered historical-field formats", () => {
    for (const tasks of [
      historicalFocus.tasks + "\nunknown-format com.example.whimway\n",
      historicalFocus.tasks.replace(
        "mLastFocusedRootTask=",
        "mUnknownFocusedRootTask=",
      ),
      historicalFocus.tasks.replace(
        "mLastFocusedRootTask=",
        "unrecognized mLastFocusedRootTask=",
      ),
      historicalFocus.tasks.replace(
        "A=10192:com.example.whimway}",
        "A=10192:com.example.whimway unexpected=true}",
      ),
    ])
      expect(() => androidResetState(historicalFocus.processes, tasks)).toThrow(
        "Unrecognized package-specific",
      );
  });
  it("observes current and child processes plus the old task's pending kill, excluding another package", () => {
    expect(androidResetState(busyProcesses, pendingTask)).toEqual({
      processes: 2,
      tasks: 1,
      activities: 1,
      pending_kill: true,
      quiet: false,
    });
    expect(
      androidResetState(
        quietProcesses + "9000 com.example.whimway.other\n",
        quietTasks.replace(
          "Activities=",
          "mKillProcessesOnDestroyed=true\n    Activities=",
        ),
      ),
    ).toMatchObject({
      processes: 0,
      tasks: 0,
      pending_kill: false,
      quiet: true,
    });
  });
  it("accepts CRLF task dumps and still detects pending package-specific teardown", () => {
    expect(
      androidResetState(
        busyProcesses.replaceAll("\n", "\r\n"),
        pendingTask.replaceAll("\n", "\r\n"),
      ),
    ).toMatchObject({ pending_kill: true, quiet: false });
  });
  it.each([
    ["unexpected output", quietTasks],
    ["PID NAME\nnot a process\n", quietTasks],
    [quietProcesses, "unavailable"],
    [quietProcesses, "ACTIVITY MANAGER ACTIVITIES\nunknown layout"],
    [quietProcesses, quietTasks + "unknown-format com.example.whimway\n"],
  ])("refuses unknown process/task formats %#", (processes, tasks) => {
    expect(() => androidResetState(processes, tasks)).toThrow();
  });
  it("clears once and waits for at least two continuous quiet seconds before allowing a single launch elsewhere", async () => {
    const f = fixture([busy, busy, quiet]);
    const proof = await prepareAndroidApp(f.options);
    expect(proof).toMatchObject({ prepared: true, scope: "smoke" });
    expect(proof.stable_quiet_ms).toBeGreaterThanOrEqual(2000);
    expect(
      f.run.mock.calls.filter(([, args]) => args.includes("clear")),
    ).toHaveLength(1);
    expect(f.run.mock.calls.some(([, args]) => args.includes("start"))).toBe(
      false,
    );
    expect(f.proof()).toMatchObject({ prepared: true });
    expect(
      [...f.files.keys()].some((name) => name.endsWith("-tasks.stdout.txt")),
    ).toBe(true);
  });
  it("resets the quiet interval when a delayed task reappears", async () => {
    const f = fixture([quiet, quiet, busy, quiet]);
    const proof = await prepareAndroidApp(f.options);
    const lastBusy = proof.observations
      .map((value) => value.quiet)
      .lastIndexOf(false);
    expect(lastBusy).toBe(2);
    expect(proof.observations.length - lastBusy - 1).toBeGreaterThanOrEqual(5);
    expect(proof.stable_quiet_ms).toBeGreaterThanOrEqual(2000);
  });
  it("accepts Release only after its old package process/task removal stays quiet for two continuous seconds", async () => {
    const f = fixture([busy, quiet, quiet, busy, quiet]);
    const proof = await prepareAndroidApp({ ...f.options, scope: "release" });
    expect(proof).toMatchObject({ prepared: true, scope: "release" });
    expect(proof.stable_quiet_ms).toBeGreaterThanOrEqual(2000);
    expect(
      proof.observations.map((state) => state.quiet).lastIndexOf(false),
    ).toBe(3);
    expect(
      f.run.mock.calls.filter(([, args]) => args.includes("clear")),
    ).toHaveLength(1);
    expect(f.run.mock.calls.some(([, args]) => args.includes("start"))).toBe(
      false,
    );
  });
  it.each([
    { serial: "R58physical" },
    { serial: "emulator-5554;evil" },
    { env: { CI: "false" } },
    { scope: "unsupported" },
  ])(
    "refuses non-CI, physical, malformed, or unsupported targets before issuing adb %#",
    async (override) => {
      const f = fixture();
      await expect(
        prepareAndroidApp({ ...f.options, ...override }),
      ).rejects.toThrow();
      expect(f.run).not.toHaveBeenCalled();
      expect(f.files.size).toBe(0);
    },
  );
  it("requires pm clear's exact Success result and retains the failed reset", async () => {
    const f = fixture();
    f.run.mockImplementation((_command, args) => ({
      status: 0,
      signal: null,
      stdout: args.includes("get-serialno") ? "emulator-5554\n" : "Failure\n",
      stderr: "",
    }));
    await expect(prepareAndroidApp(f.options)).rejects.toThrow(
      "did not report Success",
    );
    expect(f.proof()).toMatchObject({ prepared: false });
    expect(f.run.mock.calls.some(([, args]) => args.includes("ps"))).toBe(
      false,
    );
    expect([...f.files.values()].some((value) => value === "Failure\n")).toBe(
      true,
    );
  });
  it("fails closed on adb errors with bounded calls and retained diagnostics", async () => {
    const f = fixture();
    f.run.mockReturnValue({
      status: 1,
      signal: null,
      stdout: "",
      stderr: "device unavailable",
    });
    await expect(prepareAndroidApp(f.options)).rejects.toThrow(
      "command failed",
    );
    expect(f.proof()).toMatchObject({ prepared: false });
    expect(f.run).toHaveBeenCalledTimes(1);
    expect([...f.files.values()]).toContain("device unavailable");
  });
  it.each(["smoke", "release"])(
    "fails %s with a persistent pending task within the overall deadline without launching or retrying clear",
    async (scope) => {
      const f = fixture([busy]);
      await expect(prepareAndroidApp({ ...f.options, scope })).rejects.toThrow(
        "did not become stably quiet",
      );
      expect(f.proof()).toMatchObject({ prepared: false });
      expect(f.proof().observations.length).toBeLessThanOrEqual(60);
      expect(f.proof().observations.at(-1).elapsed_ms).toBeLessThanOrEqual(
        30000,
      );
      expect(
        f.run.mock.calls.filter(([, args]) => args.includes("clear")),
      ).toHaveLength(1);
    },
  );
  it("passes the host-prepared sentinel only after successful native resets and preserves manual/iOS defaults", () => {
    const runner = readFileSync(
      path.join(root, "scripts/run-android-native-qa.sh"),
      "utf8",
    );
    expect(runner.match(/-e ANDROID_HOST_PREPARED=1/g)).toHaveLength(4);
    for (const scope of ["smoke", "reminders", "large-text", "release"])
      expect(runner).toContain(
        `if node e2e-native/helpers/prepare-android.mjs "$emulator_serial" ${scope}; then`,
      );
    expect(runner.indexOf('"$emulator_serial" large-text; then')).toBeLessThan(
      runner.indexOf("settings put system font_scale 2.0"),
    );
    const boot = yaml.load(
      readFileSync(
        path.join(root, "e2e-native/helpers/boot.yaml"),
        "utf8",
      ).split(/\r?\n---\r?\n/)[1],
    ) as {
      runFlow?: {
        when: Record<string, unknown>;
        commands: { launchApp: Record<string, unknown> }[];
      };
    }[];
    const branches = boot
      .filter((command) => command.runFlow?.commands?.[0]?.launchApp)
      .map((command) => command.runFlow!);
    expect(branches).toHaveLength(2);
    expect(branches[0].when.true).toContain("maestro.platform !== 'android'");
    expect(branches[0].commands[0].launchApp.clearState).toBe(true);
    expect(branches[1].when).toMatchObject({ platform: "Android" });
    expect(branches[1].when.true).toContain("ANDROID_HOST_PREPARED === '1'");
    expect(branches[1].commands[0].launchApp).toMatchObject({
      clearState: false,
      stopApp: false,
    });
  });

  it("launches Release only after APK replacement and successful host preparation, without another clear/stop", () => {
    const execution = runNativeRunner();
    expect(execution.status, execution.stderr).toBe(0);
    const releaseInstall = execution.trace.findIndex((line) =>
      line.includes(
        "install apps/mobile/android/app/build/outputs/apk/release/app-release.apk",
      ),
    );
    const releaseReset = execution.trace.findIndex(
      (line) =>
        line ===
        "node e2e-native/helpers/prepare-android.mjs emulator-5554 release",
    );
    const coldStart = execution.trace.findIndex((line) =>
      line.includes("shell am start -W -n com.example.whimway/.MainActivity"),
    );
    const releaseFlow = execution.trace.findIndex(
      (line) =>
        line.startsWith("maestro ") &&
        line.includes("e2e-native/release-launch.yaml"),
    );
    expect(releaseInstall).toBeGreaterThan(-1);
    expect(releaseReset).toBeGreaterThan(releaseInstall);
    expect(coldStart).toBeGreaterThan(releaseReset);
    expect(releaseFlow).toBeGreaterThan(coldStart);
    expect(execution.trace[releaseFlow]).toContain(
      "-e ANDROID_HOST_PREPARED=1",
    );
    expect(
      execution.trace
        .slice(releaseReset + 1)
        .some((line) => /shell (?:am force-stop|pm clear)/.test(line)),
    ).toBe(false);
    expect(
      execution.trace.filter((line) => line.includes("shell am start -W")),
    ).toHaveLength(1);
    expect(execution.coldStart).toContain("Status: ok");
  });

  it("fails a refused Release reset without resolving, launching or running a Release UI flow", () => {
    const execution = runNativeRunner({ HARNESS_RESET_STATUS: "1" });
    expect(execution.status).toBe(1);
    expect(
      execution.trace.some((line) => line.includes("resolve-activity")),
    ).toBe(false);
    expect(
      execution.trace.some((line) => line.includes("shell am start -W")),
    ).toBe(false);
    expect(
      execution.trace.some((line) =>
        line.includes("e2e-native/release-launch.yaml"),
      ),
    ).toBe(false);
    expect(execution.coldStart).toContain(
      "no cold launch or UI probe attempted",
    );
    expect(
      execution.trace.some((line) =>
        line.includes("shell dumpsys meminfo com.example.whimway"),
      ),
    ).toBe(true);
  });

  it.each([
    ["foreign launcher", { HARNESS_ACTIVITY: "com.another.app/.MainActivity" }],
    ["failed native cold launch", { HARNESS_COLD_STATUS: "1" }],
  ])(
    "retains a %s failure without launching the Release Maestro flow",
    (_name, override) => {
      const execution = runNativeRunner(override);
      expect(execution.status).toBe(1);
      expect(
        execution.trace.some((line) =>
          line.includes("e2e-native/release-launch.yaml"),
        ),
      ).toBe(false);
      expect(
        execution.trace.filter((line) =>
          line.endsWith("emulator-5554 release"),
        ),
      ).toHaveLength(1);
      expect(
        execution.trace.some((line) =>
          line.includes("shell dumpsys gfxinfo com.example.whimway"),
        ),
      ).toBe(true);
    },
  );

  it("retains a genuine Release UI failure with one probe and no automatic relaunch", () => {
    const execution = runNativeRunner({ HARNESS_FLOW_STATUS: "1" });
    expect(execution.status).toBe(1);
    expect(
      execution.trace.filter((line) =>
        line.includes("e2e-native/release-launch.yaml"),
      ),
    ).toHaveLength(1);
    expect(
      execution.trace.filter((line) => line.includes("shell am start -W")),
    ).toHaveLength(1);
  });

  it("uses a no-clear/no-stop prepared Release branch while preserving the clean manual launch and real 120-second Explore assertion", () => {
    const release = yaml.load(
      readFileSync(
        path.join(root, "e2e-native/release-launch.yaml"),
        "utf8",
      ).split(/\r?\n---\r?\n/)[1],
    ) as {
      runFlow?: {
        when: Record<string, unknown>;
        commands: { launchApp: Record<string, unknown> }[];
      };
      extendedWaitUntil?: { visible: string; timeout: number };
    }[];
    const branches = release
      .filter((command) => command.runFlow?.commands?.[0]?.launchApp)
      .map((command) => command.runFlow!);
    expect(branches).toHaveLength(2);
    expect(branches[0].when.true).toContain("ANDROID_HOST_PREPARED !== '1'");
    expect(branches[0].commands[0].launchApp.clearState).toBe(true);
    expect(branches[0].commands[0].launchApp.stopApp).toBeUndefined();
    expect(branches[1].when).toMatchObject({ platform: "Android" });
    expect(branches[1].when.true).toContain("ANDROID_HOST_PREPARED === '1'");
    expect(branches[1].commands[0].launchApp).toEqual({
      clearState: false,
      stopApp: false,
      permissions: { location: "deny", notifications: "deny" },
    });
    expect(
      release.find((command) => command.extendedWaitUntil)?.extendedWaitUntil,
    ).toEqual({
      visible: "Where are we heading[?]",
      timeout: 120000,
    });
  });
});
