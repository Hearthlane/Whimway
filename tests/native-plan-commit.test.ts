import { beforeEach, describe, expect, it, vi } from "vitest";
import { schedule } from "@/lib/planner";
import { fixturePlaces, FixtureRoutes } from "@/lib/providers/fixtures";
import type { Itinerary } from "@/lib/schema";
import { spec } from "./helpers";
import { commitPlan } from "../apps/mobile/src/core/plan-commit";

const device = vi.hoisted(() => ({
  contents: new Map<string, string>(),
  beforeWrite: undefined as
    undefined | ((key: string, value: string) => Promise<void>),
  afterWrite: undefined as undefined | (() => Promise<void>),
}));
vi.mock(
  "../apps/mobile/node_modules/@react-native-async-storage/async-storage",
  () => ({
    default: {
      getItem: async (key: string) => device.contents.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        await device.beforeWrite?.(key, value);
        device.contents.set(key, value);
        await device.afterWrite?.();
      },
      removeItem: async (key: string) => {
        device.contents.delete(key);
      },
    },
  }),
);
vi.mock("../apps/mobile/src/services/notifications", () => ({
  cancelPlanReminders: async () => {},
}));
vi.mock("../apps/mobile/src/services/diagnostics", () => ({
  recordDiagnostic: () => {},
}));
import {
  getSavedPlans,
  savePlan,
  saveRecoveredPlan,
  removePlan,
} from "../apps/mobile/src/services/storage";

const PLANS = "whimway:native:plans:v1";
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function plan(): Promise<Itinerary> {
  const original = spec();
  return schedule(
    original,
    fixturePlaces(original.request),
    new FixtureRoutes(),
  );
}
function delayedFirstWrite() {
  const started = deferred(),
    release = deferred();
  let first = true;
  device.beforeWrite = async (key) => {
    if (key === PLANS && first) {
      first = false;
      started.resolve();
      await release.promise;
    }
  };
  return { started, release };
}
beforeEach(() => {
  device.contents.clear();
  device.beforeWrite = undefined;
  device.afterWrite = undefined;
});

describe("Native plan acceptance with the real serialized storage adapter", () => {
  it("restores the exact previous saved revision when cancelled during an asynchronous write", async () => {
    const original = await plan(),
      next = { ...original, revision: 1, title: "Edited outing" };
    await savePlan(original);
    const previousContents = device.contents.get(PLANS);
    const gate = delayedFirstWrite(),
      controller = new AbortController();
    let displayed = original;
    const refreshReminders = vi.fn(async () => {});
    const pending = commitPlan(
      next,
      {
        persist: savePlan,
        commit: (value) => {
          displayed = value;
        },
        refreshReminders,
      },
      { signal: controller.signal },
    );
    const rejected = expect(pending).rejects.toThrow("cancelled");
    await gate.started.promise;
    controller.abort();
    gate.release.resolve();
    await rejected;
    expect(device.contents.get(PLANS)).toBe(previousContents);
    expect((await getSavedPlans())[0].revision).toBe(0);
    expect(displayed).toBe(original);
    expect(refreshReminders).not.toHaveBeenCalled();
  });
  it("removes a newly generated cancelled plan instead of leaving an unseen Saved entry", async () => {
    const next = await plan(),
      gate = delayedFirstWrite(),
      controller = new AbortController();
    const pending = commitPlan(
      next,
      { persist: savePlan, commit: () => {}, refreshReminders: async () => {} },
      { signal: controller.signal },
    );
    const rejected = expect(pending).rejects.toThrow("cancelled");
    await gate.started.promise;
    controller.abort();
    gate.release.resolve();
    await rejected;
    expect(await getSavedPlans()).toEqual([]);
    expect(device.contents.has(PLANS)).toBe(false);
  });
  it("keeps queued newer revisions and unrelated saves after a cancelled write rolls back", async () => {
    const original = await plan(),
      next = { ...original, revision: 1 },
      latest = { ...original, revision: 2, title: "Latest accepted edit" };
    const other = {
      ...original,
      id: "00000000-0000-4000-8000-000000000002",
      title: "Another outing",
    };
    await savePlan(original);
    const gate = delayedFirstWrite(),
      controller = new AbortController();
    const pending = commitPlan(
      next,
      { persist: savePlan, commit: () => {}, refreshReminders: async () => {} },
      { signal: controller.signal },
    );
    const rejected = expect(pending).rejects.toThrow("cancelled");
    await gate.started.promise;
    const laterSave = savePlan(latest),
      otherSave = savePlan(other);
    controller.abort();
    gate.release.resolve();
    await rejected;
    await Promise.all([laterSave, otherSave]);
    const saved = await getSavedPlans();
    expect(saved.map((row) => row.id)).toEqual([other.id, original.id]);
    expect(saved.find((row) => row.id === original.id)).toMatchObject({
      revision: 2,
      title: latest.title,
    });
    expect(saved.find((row) => row.id === other.id)?.title).toBe(other.title);
  });
  it("cancels a queued save before touching storage while retaining the writer ahead of it", async () => {
    const next = await plan(),
      other = { ...next, id: "00000000-0000-4000-8000-000000000003" };
    const gate = delayedFirstWrite(),
      controller = new AbortController();
    const first = savePlan(other);
    await gate.started.promise;
    const pending = commitPlan(
      next,
      { persist: savePlan, commit: () => {}, refreshReminders: async () => {} },
      { signal: controller.signal },
    );
    const rejected = expect(pending).rejects.toThrow("cancelled");
    controller.abort();
    gate.release.resolve();
    await first;
    await rejected;
    expect((await getSavedPlans()).map((row) => row.id)).toEqual([other.id]);
  });
  it("keeps Saved reads behind rollback and queued later writes, never exposing a tentative cancelled plan", async () => {
    const original = await plan(),
      next = { ...original, revision: 1 },
      latest = { ...original, revision: 2 };
    await savePlan(original);
    const entered = deferred(),
      release = deferred(),
      controller = new AbortController();
    let first = true;
    device.afterWrite = async () => {
      if (first) {
        first = false;
        entered.resolve();
        await release.promise;
      }
    };
    const pending = commitPlan(
      next,
      { persist: savePlan, commit: () => {}, refreshReminders: async () => {} },
      { signal: controller.signal },
    );
    const rejected = expect(pending).rejects.toThrow("cancelled");
    await entered.promise;
    expect(JSON.parse(device.contents.get(PLANS)!)[0].revision).toBe(1);
    controller.abort();
    const laterSave = savePlan(latest);
    let readFinished = false;
    const savedScreenRead = getSavedPlans().then((rows) => {
      readFinished = true;
      return rows;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(readFinished).toBe(false);
    release.resolve();
    await rejected;
    await laterSave;
    expect((await savedScreenRead)[0].revision).toBe(2);
    expect((await getSavedPlans())[0].revision).toBe(2);
  });
  it("restores stored contents after a storage rejection that occurs after changing the value", async () => {
    const original = await plan();
    await savePlan(original);
    const previousContents = device.contents.get(PLANS);
    let fail = true;
    device.afterWrite = async () => {
      if (fail) {
        fail = false;
        throw new Error("Storage rejected");
      }
    };
    let displayed = original;
    await expect(
      commitPlan(
        { ...original, revision: 1 },
        {
          persist: savePlan,
          commit: (value) => {
            displayed = value;
          },
          refreshReminders: async () => {},
        },
      ),
    ).rejects.toThrow("storage");
    expect(device.contents.get(PLANS)).toBe(previousContents);
    expect(displayed).toBe(original);
  });
  it("rejects a stale edit without replacing a newer saved revision", async () => {
    const original = await plan(),
      latest = { ...original, revision: 3 };
    await savePlan(latest);
    const previousContents = device.contents.get(PLANS);
    const commit = vi.fn();
    await expect(
      commitPlan(
        { ...original, revision: 2 },
        { persist: savePlan, commit, refreshReminders: async () => {} },
      ),
    ).rejects.toThrow("changed during");
    expect(device.contents.get(PLANS)).toBe(previousContents);
    expect(commit).not.toHaveBeenCalled();
  });
  it("does not continue after Back during reminders or roll back a newer accepted saved revision", async () => {
    const original = await plan(),
      next = { ...original, revision: 1 },
      latest = { ...original, revision: 2 };
    await savePlan(original);
    const entered = deferred(),
      release = deferred(),
      controller = new AbortController();
    let displayed = original;
    const pending = commitPlan(
      next,
      {
        persist: savePlan,
        commit: (value) => {
          displayed = value;
        },
        refreshReminders: async () => {
          entered.resolve();
          await release.promise;
        },
      },
      { signal: controller.signal },
    );
    const continuation = vi.fn();
    const routed = pending.then(() => {
      if (!controller.signal.aborted) continuation();
    });
    const rejected = expect(routed).rejects.toThrow("cancelled");
    await entered.promise;
    // Acceptance is complete before postcommit reminder work begins.
    expect(displayed).toBe(next);
    expect((await getSavedPlans())[0].revision).toBe(1);
    controller.abort();
    await commitPlan(latest, {
      persist: savePlan,
      commit: (value) => {
        displayed = value;
      },
      refreshReminders: async () => {},
    });
    release.resolve();
    await rejected;
    expect(continuation).not.toHaveBeenCalled();
    expect(displayed).toBe(latest);
    expect((await getSavedPlans())[0].revision).toBe(2);
  });
  it("hands off a generated plan immediately after acceptance without waiting for unrequested reminders", async () => {
    const next = await plan();
    let displayed: Itinerary | undefined;
    const reminders = vi.fn(() => new Promise<void>(() => {}));
    await commitPlan(
      next,
      {
        persist: savePlan,
        commit: (value) => {
          displayed = value;
        },
        refreshReminders: reminders,
      },
      { refreshReminders: false },
    );
    expect(displayed).toBe(next);
    expect((await getSavedPlans())[0].id).toBe(next.id);
    expect(reminders).not.toHaveBeenCalled();
  });
  it("restores the persisted snapshot if state acceptance rejects a stale runtime revision", async () => {
    const original = await plan();
    await savePlan(original);
    const previousContents = device.contents.get(PLANS);
    await expect(
      commitPlan(
        { ...original, revision: 1 },
        {
          persist: savePlan,
          commit: () => {
            throw new Error("Runtime revision changed during this request");
          },
          refreshReminders: async () => {},
        },
      ),
    ).rejects.toThrow("Runtime revision changed");
    expect(device.contents.get(PLANS)).toBe(previousContents);
  });
  it("keeps recovery and deletion transactions working without re-entering the public read queue", async () => {
    const original = await plan();
    original.stops[0].locked = true;
    await savePlan(original);
    const recovered = {
      ...original,
      revision: 1,
      stops: original.stops.map((stop) => ({ ...stop, locked: false })),
    };
    await saveRecoveredPlan(original, recovered);
    expect((await getSavedPlans())[0]).toMatchObject({ revision: 1 });
    expect((await getSavedPlans())[0].stops.every((stop) => !stop.locked)).toBe(
      true,
    );
    await removePlan(original.id);
    expect(await getSavedPlans()).toEqual([]);
  });
});
