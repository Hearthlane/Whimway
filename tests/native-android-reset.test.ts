import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
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

describe("Android fixture reset and task teardown", () => {
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
  it.each([
    { serial: "R58physical" },
    { serial: "emulator-5554;evil" },
    { env: { CI: "false" } },
    { scope: "release" },
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
  it("fails a persistent pending task within the overall deadline without launching or retrying clear", async () => {
    const f = fixture([busy]);
    await expect(prepareAndroidApp(f.options)).rejects.toThrow(
      "did not become stably quiet",
    );
    expect(f.proof()).toMatchObject({ prepared: false });
    expect(f.proof().observations.length).toBeLessThanOrEqual(60);
    expect(f.proof().observations.at(-1).elapsed_ms).toBeLessThanOrEqual(30000);
    expect(
      f.run.mock.calls.filter(([, args]) => args.includes("clear")),
    ).toHaveLength(1);
  });
  it("passes the host-prepared sentinel only after successful Debug resets and preserves manual/iOS defaults", () => {
    const runner = readFileSync(
      path.join(root, "scripts/run-android-native-qa.sh"),
      "utf8",
    );
    expect(runner.match(/-e ANDROID_HOST_PREPARED=1/g)).toHaveLength(3);
    for (const scope of ["smoke", "reminders", "large-text"])
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
});
