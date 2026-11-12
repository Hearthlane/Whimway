import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { LoggedEvent } from "../metrics";

/**
 * Anonymous product event history for the metrics dashboard.
 *
 * Events are kept in memory and appended to a JSON-lines file so history survives
 * restarts on a single server (development, a VM, a container with a volume). On
 * serverless hosts the file is not durable: there, Supabase's `events` table (written by
 * the same API call) is the record, queried with docs/metrics.sql.
 */
const file =
  process.env.WHIMWAY_EVENT_LOG ??
  path.join(process.cwd(), ".data", "events.jsonl");
const MAX = 50000;
let events: LoggedEvent[] | null = null;

async function load() {
  if (events) return events;
  events = [];
  try {
    const text = await readFile(file, "utf8");
    for (const line of text.split("\n")) {
      if (!line) continue;
      try {
        events.push(JSON.parse(line));
      } catch {
        // Skip a torn line rather than lose the log.
      }
    }
    events = events.slice(-MAX);
  } catch {
    // No history yet.
  }
  return events;
}

export async function logEvent(event: LoggedEvent) {
  const all = await load();
  all.push(event);
  if (all.length > MAX) all.splice(0, all.length - MAX);
  if (process.env.WHIMWAY_EVENT_LOG === "off") return;
  try {
    await mkdir(path.dirname(file), { recursive: true });
    await appendFile(file, JSON.stringify(event) + "\n");
  } catch {
    // Read-only filesystem (serverless): memory only.
  }
}
export async function allEvents() {
  return [...(await load())];
}
/** Test hook. */
export function resetEventLog() {
  events = [];
}
