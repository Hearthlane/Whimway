// Android 14 may kill a newly launched process while an older task's deferred
// removal is pending. Observe that teardown before launching, never retry an app
// crash: frameworks/base ActivityTaskSupervisor.java killTaskProcessesIfPossible
// and Task.java's dumped mKillProcessesOnDestroyed flag (android14-release).
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";

const appId = "com.example.whimway";
const scopes = new Set(["smoke", "reminders", "large-text"]);
const repository = fileURLToPath(new URL("../../", import.meta.url));
const ownPackage = /(?:^|[^\w.])com\.example\.whimway(?=$|[^\w.])/;

export function androidResetState(processes, activities) {
  const rows = processes.trim().split(/\r?\n/);
  if (!/^\s*PID\s+NAME\s*$/.test(rows.shift() || ""))
    throw Error("Unrecognized Android process-list format.");
  const names = rows
    .filter((row) => row.trim())
    .map((row) => {
      const match = row.match(/^\s*([1-9]\d*)\s+(\S+)\s*$/);
      if (!match) throw Error("Unrecognized Android process row.");
      return match[2];
    });
  if (!activities.includes("ACTIVITY MANAGER ACTIVITIES"))
    throw Error("Unrecognized Android activity-dump format.");
  const tasks = [
    ...activities.matchAll(/^([ \t]*)(?:\*[ \t]*)?Task\{[^\r\n]*$/gm),
  ];
  if (!tasks.length) throw Error("Android task state is unavailable.");
  const ownTasks = tasks.filter((match) => ownPackage.test(match[0]));
  const ownActivities = [
    ...activities.matchAll(
      /ActivityRecord\{[^\r\n}]*\bcom\.example\.whimway\//g,
    ),
  ];
  // TaskDisplayArea retains this historical focus pointer after task removal.
  // Ignore only its observed Android 14 format for the unknown-reference check;
  // actual Task/ActivityRecord/process/pending-kill observations remain intact.
  // AOSP TaskDisplayArea.java mLastFocusedRootTask; CI run38664294144 line141.
  const currentReferences = activities.replace(
    /^[ \t]*mLastFocusedRootTask=Task\{[a-f0-9]+ #\d+ type=standard A=\d+:com\.example\.whimway\}[ \t]*\r?$/gm,
    "",
  );
  if (
    ownPackage.test(currentReferences) &&
    !ownTasks.length &&
    !ownActivities.length
  )
    throw Error("Unrecognized package-specific Android task state.");
  const pendingKill = ownTasks.some((task) => {
    const end =
      tasks.find(
        (candidate) =>
          candidate.index > task.index && candidate[1].length <= task[1].length,
      )?.index ?? activities.length;
    return /\bmKillProcessesOnDestroyed=true\b/.test(
      activities.slice(task.index, end),
    );
  });
  const ownProcesses = names.filter(
    (name) => name === appId || name.startsWith(appId + ":"),
  );
  return {
    processes: ownProcesses.length,
    tasks: ownTasks.length,
    activities: ownActivities.length,
    pending_kill: pendingKill,
    quiet:
      !ownProcesses.length &&
      !ownTasks.length &&
      !ownActivities.length &&
      !pendingKill,
  };
}

/**
 * @param {{serial?: string, scope?: string, env?: {CI?: string},
 * run?: (command: string, args: string[], options: {encoding: 'utf8', timeout: number, maxBuffer: number}) => {status: number|null, signal?: string|null, stdout?: string, stderr?: string, error?: {code?: string}},
 * now?: () => number, pause?: (milliseconds: number) => Promise<unknown>,
 * write?: (name: string, value: string) => unknown}} [options]
 */
export async function prepareAndroidApp({
  serial,
  scope,
  env = process.env,
  run = spawnSync,
  now = Date.now,
  pause = setTimeout,
  write,
} = {}) {
  if (
    env.CI !== "true" ||
    !/^emulator-[0-9]+$/.test(serial || "") ||
    !scopes.has(scope)
  )
    throw Error(
      "Android reset requires a disposable CI emulator and a known Debug scope.",
    );
  const directory = path.join(
    repository,
    "native-test-artifacts/android-reset",
    scope,
  );
  const save =
    write ||
    ((name, value) => {
      mkdirSync(directory, { recursive: true });
      writeFileSync(path.join(directory, name), value);
    });
  const started = now(),
    deadline = started + 30000;
  const evidence = {
    app_id: appId,
    emulator: serial,
    scope,
    prepared: false,
    stable_quiet_ms: 0,
    commands: [],
    observations:
      /** @type {Array<ReturnType<typeof androidResetState> & {elapsed_ms: number}>} */ ([]),
  };
  const persist = () =>
    save("reset-evidence.json", JSON.stringify(evidence, null, 2) + "\n");
  const command = (label, args, timeout = 5000) => {
    const remaining = deadline - now();
    if (remaining <= 0)
      throw Error("Android reset exceeded its 30-second deadline.");
    const number = String(evidence.commands.length + 1).padStart(3, "0");
    const result = run("adb", ["-s", serial, ...args], {
      encoding: "utf8",
      timeout: Math.min(timeout, remaining),
      maxBuffer: 1024 * 1024,
    });
    save(number + "-" + label + ".stdout.txt", result.stdout || "");
    save(number + "-" + label + ".stderr.txt", result.stderr || "");
    evidence.commands.push({
      command: label,
      elapsed_ms: now() - started,
      status: result.status,
      signal: result.signal || null,
      error: result.error?.code || null,
    });
    persist();
    if (result.status !== 0 || result.error || result.signal)
      throw Error("Android reset command failed: " + label + ".");
    return result.stdout || "";
  };
  try {
    if (command("serial", ["get-serialno"]).trim() !== serial)
      throw Error("Android reset emulator identity did not match.");
    command("force-stop", ["shell", "am", "force-stop", "--user", "0", appId]);
    if (
      command(
        "clear-data",
        ["shell", "pm", "clear", "--user", "0", appId],
        10000,
      ).trim() !== "Success"
    )
      throw Error("Android clear-data did not report Success.");
    let quietSince = null;
    while (now() < deadline && evidence.observations.length < 60) {
      const processes = command("processes", [
        "shell",
        "ps",
        "-A",
        "-o",
        "PID,NAME",
      ]);
      const activities = command("tasks", [
        "shell",
        "dumpsys",
        "activity",
        "-a",
        "activities",
      ]);
      const state = androidResetState(processes, activities),
        observed = now();
      evidence.observations.push({ elapsed_ms: observed - started, ...state });
      if (state.quiet) {
        quietSince ??= observed;
        evidence.stable_quiet_ms = observed - quietSince;
        if (evidence.stable_quiet_ms >= 2000) {
          evidence.prepared = true;
          persist();
          return evidence;
        }
      } else {
        quietSince = null;
        evidence.stable_quiet_ms = 0;
      }
      persist();
      await pause(Math.min(500, Math.max(0, deadline - now())));
    }
    throw Error(
      "Android app/task teardown did not become stably quiet before launch.",
    );
  } catch (error) {
    evidence.failure =
      error instanceof Error ? error.message : "Android reset failed.";
    persist();
    throw error;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (process.argv.length !== 4)
      throw Error(
        "Usage: prepare-android.mjs emulator-serial smoke|reminders|large-text",
      );
    const evidence = await prepareAndroidApp({
      serial: process.argv[2],
      scope: process.argv[3],
    });
    console.log(
      JSON.stringify({
        scope: evidence.scope,
        prepared: evidence.prepared,
        stable_quiet_ms: evidence.stable_quiet_ms,
      }),
    );
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Android reset failed.",
    );
    process.exitCode = 1;
  }
}
