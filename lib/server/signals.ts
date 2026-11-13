import { slug, toSignals, type CrowdSignals, type Tally } from "../crowd";
import { polls, type PollTally, type SignalBatch } from "../polls";
import { supabase } from "./supabase";

/**
 * Where community signals live. Supabase (durable, aggregated in SQL with a
 * k-anonymity threshold) when configured; otherwise an in-memory store so local
 * development and demo mode exercise the full loop. Memory is per-process and not
 * durable — production needs Supabase for this to learn across users.
 */
interface SignalStore {
  record(batch: SignalBatch): Promise<void>;
  answer(
    pollId: string,
    installId: string,
    choice: "a" | "b",
  ): Promise<PollTally>;
  tallies(): Promise<Record<string, Tally>>;
  polls(): Promise<Record<string, PollTally>>;
}

const cloud = () =>
  Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );

class MemoryStore implements SignalStore {
  // key -> installId|source -> value (latest opinion wins, like the SQL primary key)
  signals = new Map<string, Map<string, 1 | -1>>();
  answers = new Map<string, Map<string, "a" | "b">>();
  async record(batch: SignalBatch) {
    for (const e of batch.entries) {
      const votes = this.signals.get(e.key) ?? new Map();
      votes.set(`${batch.installId}|${batch.source}`, e.value);
      this.signals.set(e.key, votes);
    }
  }
  async answer(pollId: string, installId: string, choice: "a" | "b") {
    const votes = this.answers.get(pollId) ?? new Map();
    votes.set(installId, choice);
    this.answers.set(pollId, votes);
    return (await this.polls())[pollId];
  }
  async tallies() {
    const out: Record<string, Tally> = {};
    for (const [key, votes] of this.signals) {
      const people = new Set([...votes.keys()].map((k) => k.split("|")[0]));
      if (people.size < 5) continue; // same k-anonymity rule as SQL
      const values = [...votes.values()];
      out[key] = {
        up: values.filter((v) => v === 1).length,
        down: values.filter((v) => v === -1).length,
      };
    }
    return out;
  }
  async polls() {
    const out: Record<string, PollTally> = {};
    for (const [id, votes] of this.answers) {
      const values = [...votes.values()];
      out[id] = {
        a: values.filter((v) => v === "a").length,
        b: values.filter((v) => v === "b").length,
      };
    }
    return out;
  }
}

class SupabaseStore implements SignalStore {
  async record(batch: SignalBatch) {
    const db = await supabase();
    const { error } = await db.rpc("record_signals", {
      install: batch.installId,
      src: batch.source,
      entries: batch.entries,
      why: batch.reason ?? null,
    });
    if (error) throw new Error("signals");
  }
  async answer(pollId: string, installId: string, choice: "a" | "b") {
    const db = await supabase();
    const { data, error } = await db.rpc("answer_poll", {
      poll: pollId,
      install: installId,
      pick: choice,
    });
    if (error) throw new Error("poll");
    return data as PollTally;
  }
  async tallies() {
    const db = await supabase();
    const { data } = await db.rpc("crowd_tallies");
    return (data ?? {}) as Record<string, Tally>;
  }
  async polls() {
    const db = await supabase();
    const { data } = await db.rpc("poll_tallies");
    return (data ?? {}) as Record<string, PollTally>;
  }
}

const memory = new MemoryStore();
export const signalStore = (): SignalStore =>
  cloud() ? new SupabaseStore() : memory;
/** Test hook. */
export const memoryStore = memory;

// Crowd signals change slowly; cache them briefly so planning stays fast and cheap.
let cache: { at: number; value: CrowdSignals } | null = null;
export async function crowdSignals(): Promise<CrowdSignals> {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.value;
  try {
    const value = toSignals(await signalStore().tallies());
    cache = { at: Date.now(), value };
    return value;
  } catch {
    return cache?.value ?? {}; // never block planning on analytics
  }
}
export function invalidateCrowd() {
  cache = null;
}

/** A poll answer is also a community signal for the chosen/other options' place types. */
export function pollSignals(pollId: string, choice: "a" | "b") {
  const poll = polls.find((p) => p.id === pollId);
  if (!poll) return [];
  const other = choice === "a" ? "b" : "a";
  return [
    ...poll[choice].signals.map((s) => ({
      key: `type:${slug(s)}`,
      value: 1 as const,
    })),
    ...poll[other].signals.map((s) => ({
      key: `type:${slug(s)}`,
      value: -1 as const,
    })),
  ].slice(0, 16);
}
