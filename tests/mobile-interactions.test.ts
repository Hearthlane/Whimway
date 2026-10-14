import { describe, expect, it, vi } from "vitest";
import { DateTime } from "luxon";
import { z } from "zod";
import {
  fixtureLocations,
  fixturePlaces,
  FixtureRoutes,
} from "../lib/providers/fixtures";
import { schedule } from "../lib/planner";
import { spec } from "./helpers";
import {
  applySavedPreferences,
  choosePreferences,
  plannerPrompt,
  requestFromDraft,
  withLocation,
  type Draft,
} from "../apps/mobile/src/core/planning";
import { toggleStopLock } from "../apps/mobile/src/core/plan-edit";
import { shouldDismissSheet } from "../apps/mobile/src/core/sheet-gesture";
import {
  defaultPreferences,
  rememberPlacePreference,
} from "../apps/mobile/src/services/storage-core";
import {
  sanitizedDiagnostic,
  readDiagnosticEvents,
  appendDiagnostic,
  formatDiagnosticReport,
  type DiagnosticEvent,
} from "../apps/mobile/src/services/diagnostics-core";
import { requestJson } from "../apps/mobile/src/services/http";
import { ensurePkceCrypto } from "../apps/mobile/src/services/pkce-crypto";
import {
  canUnlockSavedStops,
  unlockedSavedStops,
  commitRecoveredSavedPlan,
} from "../apps/mobile/src/core/saved-recovery";

const now = DateTime.fromISO("2026-10-13T20:00:00Z");
const draft = (): Draft => ({
  prompt: "An afternoon outside",
  known: [],
  demo: false,
});

describe("Native preference control", () => {
  it("remembers explicit avoid choices without activating unrelated saved defaults", () => {
    const previous = {
      ...defaultPreferences,
      enabled: false,
      cuisines: "Thai",
      mode: "DRIVE" as const,
    };
    const remembered = rememberPlacePreference(previous, "chosen-place");
    expect(remembered).toMatchObject({
      enabled: false,
      cuisines: "Thai",
      mode: "DRIVE",
      disliked: ["chosen-place"],
    });
    expect(previous.disliked).toEqual([]);
    const next = applySavedPreferences(
      { ...draft(), excludedPlaceIds: ["existing-place"] },
      remembered,
    );
    expect(next.excludedPlaceIds).toEqual(["existing-place", "chosen-place"]);
    expect(next.mode).toBeUndefined();
    expect(next.savedPersonalization).toBeUndefined();
    expect(next.budget).toBeUndefined();
    expect(next.known).toEqual([]);
  });
  it("deduplicates avoided places and caps their persisted references", () => {
    const previous = {
      ...defaultPreferences,
      disliked: Array.from({ length: 100 }, (_, index) => `place-${index}`),
    };
    const next = rememberPlacePreference(previous, "place-new");
    expect(next.disliked).toHaveLength(100);
    expect(next.disliked).not.toContain("place-0");
    expect(
      rememberPlacePreference(next, "place-99").disliked.filter(
        (id) => id === "place-99",
      ),
    ).toHaveLength(1);
    expect(() => rememberPlacePreference(previous, "")).toThrow("valid place");
  });
  it("applies enabled defaults without replacing explicit choices or assuming a currency", () => {
    const preferences = {
      ...defaultPreferences,
      enabled: true,
      mode: "DRIVE" as const,
      budget: 70,
      budgetCurrency: "CAD",
      cuisines: "Japanese",
      atmosphere: "quiet",
    };
    const source = applySavedPreferences(
      { ...draft(), mode: "WALK", known: ["mode"] },
      preferences,
    );
    expect(source.mode).toBe("WALK");
    expect(source.budget).toBeUndefined();
    const toronto = withLocation(source, fixtureLocations[0], now);
    expect(toronto.budget).toBe(70);
    expect(toronto.known).toContain("budget");
    const tokyo = withLocation(toronto, fixtureLocations[1], now);
    expect(tokyo.budget).toBeUndefined();
    expect(
      withLocation(
        choosePreferences(tokyo, { budget: 15000 }),
        fixtureLocations[0],
        now,
      ).budget,
    ).toBe(15000);
  });
  it("adds secondary cuisine and atmosphere preferences only to generation, preserving the raw request", () => {
    const source = withLocation(
      applySavedPreferences(draft(), {
        ...defaultPreferences,
        enabled: true,
        cuisines: "Thai",
        atmosphere: "quiet",
      }),
      fixtureLocations[0],
      now,
    );
    expect(source.prompt).toBe("An afternoon outside");
    const request = requestFromDraft(source, now);
    expect(request.prompt).toContain("An afternoon outside");
    expect(request.prompt).toContain(
      "use only when compatible with the request above",
    );
    expect(request.prompt).toContain("Preferred cuisines: Thai");
    expect(request.prompt).toContain("Preferred atmosphere: quiet");
    const maximumRequest = { ...source, prompt: "x".repeat(1500) };
    expect(plannerPrompt(maximumRequest)).toBe(maximumRequest.prompt);
  });
  it("treats the Free choice as a hard zero budget while numeric budgets remain preferences", () => {
    const source = withLocation(draft(), fixtureLocations[0], now);
    expect(requestFromDraft({ ...source, budget: 0 }, now)).toMatchObject({
      budget: 0,
      hardBudget: true,
    });
    expect(requestFromDraft({ ...source, budget: 70 }, now)).toMatchObject({
      budget: 70,
      hardBudget: false,
    });
  });
});

describe("Local locks and sheet gestures", () => {
  it("can unlock an unavailable venue without providers or changing the route, schedule or estimates", async () => {
    const source = spec();
    const original = await schedule(
      source,
      fixturePlaces(source.request),
      new FixtureRoutes(),
    );
    const stop = original.stops[0];
    const locked = toggleStopLock(original, stop.placeId);
    expect(locked.revision).toBe(original.revision + 1);
    expect(locked.stops[0].locked).toBe(true);
    expect(original.stops[0].locked).toBe(false);
    expect(locked.stops[0]).toEqual({ ...stop, locked: true });
    expect(locked.legs).toBe(original.legs);
    expect(locked.cost).toBe(original.cost);
    expect(locked.request).toBe(original.request);
    const unlocked = toggleStopLock(locked, stop.placeId);
    expect(unlocked.stops).toEqual(original.stops);
    expect(unlocked.revision).toBe(original.revision + 2);
    expect(() => toggleStopLock(original, "missing")).toThrow("no longer");
  });
  it("requires a deliberate downward drag or fling and rejects incidental movement", () => {
    expect(shouldDismissSheet(100, 0, 400)).toBe(false);
    expect(shouldDismissSheet(101, 0, 400)).toBe(true);
    expect(shouldDismissSheet(25, 1000, 600)).toBe(true);
    expect(shouldDismissSheet(20, 2000, 600)).toBe(false);
    expect(shouldDismissSheet(-200, -2000, 600)).toBe(false);
    expect(shouldDismissSheet(150, 0, 900)).toBe(false);
    expect(shouldDismissSheet(151, 0, 900)).toBe(true);
    expect(shouldDismissSheet(Number.NaN, 1000, 600)).toBe(false);
  });
});

describe("Explicit saved lock recovery", () => {
  async function lockedPlan() {
    const original = spec();
    original.stops[0].locked = true;
    const unlocked = unlockedSavedStops(original);
    const recovered = await schedule(
      unlocked,
      fixturePlaces(unlocked.request),
      new FixtureRoutes(),
    );
    return { original, unlocked, recovered };
  }
  it("offers unlock recovery only for unavailable locked saved stops and does not mutate their references", async () => {
    const { original, unlocked } = await lockedPlan();
    expect(canUnlockSavedStops(original, { code: "LOCK_CONFLICT" })).toBe(true);
    expect(canUnlockSavedStops(original, { code: "PLACE_UNAVAILABLE" })).toBe(
      true,
    );
    expect(canUnlockSavedStops(original, { code: "NETWORK_ERROR" })).toBe(
      false,
    );
    expect(canUnlockSavedStops(unlocked, { code: "PLACE_UNAVAILABLE" })).toBe(
      false,
    );
    expect(unlocked.stops.every((stop) => !stop.locked)).toBe(true);
    expect(unlocked.revision).toBe(original.revision + 1);
    expect(original.stops[0].locked).toBe(true);
    expect(unlocked.request).toEqual(original.request);
    expect(unlocked.stops).toEqual(
      original.stops.map((stop) => ({ ...stop, locked: false })),
    );
  });
  it("persists recovered references only after successful hydration, excluding current venue details", async () => {
    const { original, recovered } = await lockedPlan();
    let saved = [original];
    await commitRecoveredSavedPlan(original, recovered, {
      read: async () => saved,
      write: async (next) => {
        saved = next;
      },
    });
    expect(saved[0].revision).toBe(original.revision + 1);
    expect(saved[0].stops.every((stop) => !stop.locked)).toBe(true);
    expect(saved[0].stops[0]).not.toHaveProperty("place");
    expect(saved[0].stops[0]).not.toHaveProperty("arrival");
    expect(original.stops[0].locked).toBe(true);
  });
  it("leaves the original intact on a failed write or a cancellation during persistence", async () => {
    const { original, recovered } = await lockedPlan();
    for (const failure of ["cancel", "storage"] as const) {
      const controller = new AbortController();
      let saved = [original],
        writes = 0;
      await expect(
        commitRecoveredSavedPlan(
          original,
          recovered,
          {
            read: async () => saved,
            write: async (next) => {
              saved = next;
              if (writes++ === 0) {
                if (failure === "cancel") controller.abort();
                else throw new Error("Storage failure");
              }
            },
          },
          controller.signal,
        ),
      ).rejects.toThrow(failure === "cancel" ? "cancelled" : "Storage failure");
      expect(saved).toEqual([original]);
      expect(saved[0].stops[0].locked).toBe(true);
      expect(writes).toBe(2);
    }
  });
  it("rejects stale or empty results without overwriting a newer saved revision", async () => {
    const { original, recovered } = await lockedPlan();
    const write = vi.fn();
    await expect(
      commitRecoveredSavedPlan(original, recovered, {
        read: async () => [{ ...original, revision: 3 }],
        write,
      }),
    ).rejects.toThrow("changed during");
    await expect(
      commitRecoveredSavedPlan(
        original,
        { ...recovered, stops: [] },
        { read: async () => [original], write },
      ),
    ).rejects.toThrow("None of these places");
    expect(write).not.toHaveBeenCalled();
  });
});

describe("Local diagnostic privacy and bounded reporting", () => {
  it("keeps only an allowlisted error class, endpoint family and failure status", () => {
    const input = {
      category: "api" as const,
      code: "private-provider-error secret-token",
      operation: "plans/private-plan-id?token=secret-token",
      status: 422,
      message: "personal outing",
      coordinates: [43, -79],
    };
    const event = sanitizedDiagnostic(input, new Date("2026-10-13T20:00:00Z"));
    expect(event).toEqual({
      at: "2026-10-13T20:00:00.000Z",
      category: "api",
      code: "REQUEST_FAILED",
      operation: "plans",
      status: 422,
      occurrences: 1,
    });
    expect(
      sanitizedDiagnostic({
        category: "api",
        code: "NETWORK_ERROR",
        operation: "https://private.example",
        status: 200,
      }),
    ).not.toHaveProperty("operation");
    expect(
      sanitizedDiagnostic({
        category: "api",
        code: "NETWORK_ERROR",
        status: 200,
      }),
    ).not.toHaveProperty("status");
  });
  it("rejects corrupt persisted entries, strips unexpected payloads and bounds storage to thirty", () => {
    const event = sanitizedDiagnostic({
      category: "render",
      code: "SCREEN_ERROR",
    });
    const stored = JSON.stringify([
      ...Array.from({ length: 40 }, () => ({
        ...event,
        token: "secret-token",
      })),
      { ...event, code: "private" },
    ]);
    const entries = readDiagnosticEvents(stored);
    expect(entries).toHaveLength(30);
    expect(JSON.stringify(entries)).not.toContain("secret-token");
    expect(readDiagnosticEvents("not json")).toEqual([]);
    expect(readDiagnosticEvents("x".repeat(50001))).toEqual([]);
    expect(appendDiagnostic(entries, event)).toHaveLength(30);
  });
  it("counts error bursts without flooding the report and does not merge later errors", () => {
    const first = sanitizedDiagnostic(
      { category: "api", code: "TIMEOUT", operation: "generate" },
      new Date("2026-10-13T20:00:00Z"),
    );
    const burst = { ...first, at: "2026-10-13T20:00:00.900Z" };
    const merged = appendDiagnostic([first], burst);
    expect(merged).toHaveLength(1);
    expect(merged[0].occurrences).toBe(2);
    expect(
      appendDiagnostic(merged, { ...first, at: "2026-10-13T20:00:02Z" }),
    ).toHaveLength(2);
    expect(
      appendDiagnostic([{ ...first, occurrences: 999 }], burst)[0].occurrences,
    ).toBe(999);
  });
  it("cannot export arbitrary error payloads or unsafe environment text", () => {
    const event = {
      ...sanitizedDiagnostic({
        category: "auth",
        code: "AUTH_FAILED",
        operation: "sign-in",
      }),
      token: "secret-token",
      email: "private@example.com",
    };
    const report = formatDiagnosticReport([event as DiagnosticEvent], {
      version: "0.2.0",
      platform: "ios",
      osVersion: "19",
      build: "https://private.example?secret-token",
    });
    expect(report).toContain("AUTH_FAILED");
    expect(report).toContain("Build: unavailable");
    expect(report).not.toContain("secret-token");
    expect(report).not.toContain("private@example.com");
  });
  it("records request failures without tokens or payloads and never masks them if reporting fails", async () => {
    const reportFailure = vi.fn(() => {
      throw new Error("storage unavailable");
    });
    await expect(
      requestJson(
        "https://example.com",
        "generate",
        z.object({}),
        { prompt: "private outing" },
        {
          token: "private-token",
          fetcher: vi
            .fn()
            .mockRejectedValue(new Error("private network detail")),
          reportFailure,
        },
      ),
    ).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    expect(reportFailure).toHaveBeenCalledWith({
      code: "NETWORK_ERROR",
      path: "generate",
      status: undefined,
    });
    expect(JSON.stringify(reportFailure.mock.calls)).not.toContain("private");
  });
  it("does not record user cancellations as failures", async () => {
    const controller = new AbortController();
    const reportFailure = vi.fn();
    const fetcher = vi.fn(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          ),
        ),
    );
    const pending = requestJson(
      "https://example.com",
      "generate",
      z.object({}),
      {},
      { fetcher, reportFailure, signal: controller.signal },
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    expect(reportFailure).not.toHaveBeenCalled();
  });
});

describe("Native PKCE crypto adapter", () => {
  it("supplies cryptographic random values and an S256 digest on a Hermes-like target", async () => {
    const target: Parameters<typeof ensurePkceCrypto>[0] = {};
    const fill = vi.fn(
      (values: Uint8Array<ArrayBuffer> | Uint32Array<ArrayBuffer>) => {
        values.fill(17);
        return values;
      },
    );
    const sha256 = vi.fn(async () => new Uint8Array([1, 2, 3]).buffer);
    ensurePkceCrypto(target, {
      fill,
      sha256,
      uuid: () => "native-secure-uuid",
    });
    const bytes = new Uint32Array(8);
    expect(target.crypto?.getRandomValues?.(bytes)).toBe(bytes);
    expect([...bytes]).toEqual(Array(8).fill(17));
    const verifier = new TextEncoder().encode("pkce-verifier");
    expect(
      new Uint8Array(await target.crypto!.subtle!.digest!("SHA-256", verifier)),
    ).toEqual(new Uint8Array([1, 2, 3]));
    expect(sha256).toHaveBeenCalledWith(verifier);
    expect(target.crypto?.randomUUID?.()).toBe("native-secure-uuid");
    await expect(
      target.crypto!.subtle!.digest!("SHA-1", verifier),
    ).rejects.toThrow("Only SHA-256");
  });
  it("preserves an existing full crypto implementation rather than replacing its primitives", () => {
    const fill = vi.fn(
      (values: Uint8Array<ArrayBuffer> | Uint32Array<ArrayBuffer>) => values,
    );
    const digest = vi.fn(async () => new ArrayBuffer(32));
    const uuid = vi.fn(() => "existing-secure-uuid");
    const target = {
      crypto: { getRandomValues: fill, randomUUID: uuid, subtle: { digest } },
    };
    const native = { fill: vi.fn(), sha256: vi.fn(), uuid: vi.fn() };
    ensurePkceCrypto(target, native);
    expect(target.crypto.getRandomValues).toBe(fill);
    expect(target.crypto.randomUUID).toBe(uuid);
    expect(target.crypto.subtle.digest).toBe(digest);
    expect(native.fill).not.toHaveBeenCalled();
  });
});
