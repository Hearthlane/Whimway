import { describe, expect, it, vi } from "vitest";
import { schedule } from "../lib/planner";
import { fixturePlaces, FixtureRoutes } from "../lib/providers/fixtures";
import { spec } from "./helpers";
import type { DayProgress } from "../apps/mobile/src/services/storage-core";
import {
  completionCancellationWarning,
  createDayCompletionCoordinator,
} from "../apps/mobile/src/services/day-completion";

async function fixture() {
  const request = spec();
  const plan = await schedule(
    request,
    fixturePlaces(request.request),
    new FixtureRoutes(),
  );
  const progress: DayProgress = {
    planId: plan.id,
    startedAt: "2026-10-14T10:00:00.000Z",
    completed: plan.stops.slice(0, -1).map((stop) => stop.placeId),
    skipped: [],
  };
  const saveProgress = vi
    .fn<(value: DayProgress) => Promise<void>>()
    .mockResolvedValue(undefined);
  const updateReminders = vi.fn().mockResolvedValue(undefined);
  const cancelReminders = vi
    .fn<(planId: string) => Promise<void>>()
    .mockResolvedValue(undefined);
  const coordinator = createDayCompletionCoordinator({
    saveProgress,
    updateReminders,
    cancelReminders,
  });
  const onSaved = vi.fn();
  const finish = (isActive = () => true) =>
    coordinator.finish({
      plan,
      progress,
      placeId: plan.stops.at(-1)!.placeId,
      status: "completed",
      isActive,
      onSaved,
    });
  return {
    plan,
    progress,
    saveProgress,
    updateReminders,
    cancelReminders,
    coordinator,
    onSaved,
    finish,
  };
}
function deferred() {
  let resolve!: () => void, reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("Day completion and plan-specific reminder recovery", () => {
  it("persists the final completed stop despite cancellation rejection, then retries only that plan without resetting progress", async () => {
    const f = await fixture();
    f.cancelReminders.mockRejectedValueOnce(
      new Error("native cancellation rejected"),
    );
    const result = await f.finish();
    expect(result).toMatchObject({
      status: "saved",
      complete: true,
      reminderWarning: completionCancellationWarning,
    });
    expect(f.saveProgress).toHaveBeenCalledTimes(1);
    const saved = f.saveProgress.mock.calls[0][0];
    expect(saved).toMatchObject({
      startedAt: f.progress.startedAt,
      planId: f.plan.id,
      skipped: [],
    });
    expect(saved.completed).toEqual(f.plan.stops.map((stop) => stop.placeId));
    expect(f.onSaved).toHaveBeenCalledWith(saved);
    expect(f.coordinator.cancellationFailure(f.plan.id)).toBe(
      completionCancellationWarning,
    );
    expect(await f.coordinator.cancelRemaining(f.plan.id, () => true)).toEqual({
      status: "cancelled",
    });
    expect(f.cancelReminders.mock.calls).toEqual([[f.plan.id], [f.plan.id]]);
    expect(f.coordinator.cancellationFailure(f.plan.id)).toBeUndefined();
    expect(f.saveProgress).toHaveBeenCalledTimes(1);
    expect(f.onSaved).toHaveBeenCalledTimes(1);
    expect(f.updateReminders).not.toHaveBeenCalled();
  });
  it("keeps the recorded failure visible during a retry and after another rejection, clearing only on successful cancellation", async () => {
    const f = await fixture(),
      retry = deferred();
    f.cancelReminders
      .mockRejectedValueOnce(new Error("first rejection"))
      .mockImplementationOnce(() => retry.promise);
    await f.finish();
    const operation = f.coordinator.cancelRemaining(f.plan.id, () => true);
    await Promise.resolve();
    expect(await f.coordinator.cancelRemaining(f.plan.id, () => true)).toEqual({
      status: "busy",
    });
    expect(f.coordinator.cancellationFailure(f.plan.id)).toBe(
      completionCancellationWarning,
    );
    retry.reject(new Error("retry rejected"));
    expect(await operation).toEqual({ status: "failed" });
    expect(f.coordinator.cancellationFailure(f.plan.id)).toBe(
      completionCancellationWarning,
    );
    await f.coordinator.cancelRemaining(f.plan.id, () => true);
    expect(f.coordinator.cancellationFailure(f.plan.id)).toBeUndefined();
    expect(f.saveProgress).toHaveBeenCalledTimes(1);
  });
  it("does not cancel reminders or report saved progress when persistence fails", async () => {
    const f = await fixture();
    const original = structuredClone(f.progress);
    f.saveProgress.mockRejectedValueOnce(new Error("storage rejected"));
    await expect(f.finish()).rejects.toThrow("storage rejected");
    expect(f.progress).toEqual(original);
    expect(f.onSaved).not.toHaveBeenCalled();
    expect(f.cancelReminders).not.toHaveBeenCalled();
    expect(f.coordinator.cancellationFailure(f.plan.id)).toBeUndefined();
  });
  it("blocks duplicate taps during final save and cancellation, including concurrent retry taps", async () => {
    const f = await fixture(),
      saved = deferred(),
      cancelled = deferred();
    f.saveProgress.mockImplementationOnce(() => saved.promise);
    f.cancelReminders.mockImplementationOnce(() => cancelled.promise);
    const first = f.finish();
    expect(await f.finish()).toEqual({ status: "busy" });
    expect(await f.coordinator.cancelRemaining(f.plan.id, () => true)).toEqual({
      status: "busy",
    });
    saved.resolve();
    await vi.waitFor(() => expect(f.cancelReminders).toHaveBeenCalledTimes(1));
    expect(await f.finish()).toEqual({ status: "busy" });
    cancelled.resolve();
    expect(await first).toMatchObject({ status: "saved", complete: true });
    expect(f.saveProgress).toHaveBeenCalledTimes(1);
    expect(f.cancelReminders).toHaveBeenCalledTimes(1);
  });
  it("does not start after blur and suppresses stale UI callbacks while finishing an already authorized save", async () => {
    const f = await fixture(),
      saved = deferred();
    let active = true;
    f.saveProgress.mockImplementationOnce(() => saved.promise);
    const operation = f.finish(() => active);
    await Promise.resolve();
    active = false;
    saved.resolve();
    await operation;
    expect(f.onSaved).not.toHaveBeenCalled();
    expect(f.cancelReminders).toHaveBeenCalledExactlyOnceWith(f.plan.id);
    expect(await f.finish(() => false)).toEqual({ status: "inactive" });
    expect(await f.coordinator.cancelRemaining(f.plan.id, () => false)).toEqual(
      { status: "inactive" },
    );
    expect(f.saveProgress).toHaveBeenCalledTimes(1);
  });
  it("waits for an outstanding completion before a resumed screen reloads progress", async () => {
    const f = await fixture(),
      cancelled = deferred();
    f.cancelReminders.mockImplementationOnce(() => cancelled.promise);
    const operation = f.finish();
    let ready = false;
    const waiting = f.coordinator.whenIdle(f.plan.id).then(() => {
      ready = true;
    });
    await Promise.resolve();
    expect(ready).toBe(false);
    cancelled.resolve();
    await operation;
    await waiting;
    expect(ready).toBe(true);
    expect(f.saveProgress.mock.calls[0][0].completed).toHaveLength(
      f.plan.stops.length,
    );
  });
  it("updates reminders for a non-final stop while preserving saved progress on update rejection", async () => {
    const f = await fixture();
    f.updateReminders.mockRejectedValueOnce(new Error("update rejected"));
    const result = await f.coordinator.finish({
      plan: f.plan,
      progress: { ...f.progress, completed: [] },
      placeId: f.plan.stops[0].placeId,
      status: "completed",
      isActive: () => true,
      onSaved: f.onSaved,
    });
    expect(result).toMatchObject({
      status: "saved",
      complete: false,
      reminderWarning: expect.stringContaining("Progress saved"),
    });
    expect(f.cancelReminders).not.toHaveBeenCalled();
    expect(f.updateReminders).toHaveBeenCalledExactlyOnceWith(f.plan);
    expect(f.saveProgress.mock.calls[0][0].completed).toEqual([
      f.plan.stops[0].placeId,
    ]);
  });
  it("keeps failure ownership scoped to a plan and preserves skipped final progress", async () => {
    const f = await fixture();
    f.cancelReminders.mockRejectedValueOnce(new Error("own plan rejected"));
    const result = await f.coordinator.finish({
      plan: f.plan,
      progress: f.progress,
      placeId: f.plan.stops.at(-1)!.placeId,
      status: "skipped",
      isActive: () => true,
      onSaved: f.onSaved,
    });
    expect(result).toMatchObject({ status: "saved", complete: true });
    expect(f.saveProgress.mock.calls[0][0].skipped).toEqual([
      f.plan.stops.at(-1)!.placeId,
    ]);
    await f.coordinator.cancelRemaining("explicit-other-plan", () => true);
    expect(f.coordinator.cancellationFailure(f.plan.id)).toBe(
      completionCancellationWarning,
    );
    expect(
      f.coordinator.cancellationFailure("explicit-other-plan"),
    ).toBeUndefined();
    expect(f.cancelReminders.mock.calls).toEqual([
      [f.plan.id],
      ["explicit-other-plan"],
    ]);
  });
});
