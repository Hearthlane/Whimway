import { describe, expect, it, vi } from "vitest";
import {
  collectionAccount,
  collectionDeleted,
  collectionSynced,
  deleteSavedCollectionPlan,
  emptyCloudCollection,
  syncedAccountForPlan,
} from "../apps/mobile/src/core/cloud-collection";

const status = (id: string | null, cloud = true) => ({
  user: id ? { id } : null,
  cloud,
});
const synced = () =>
  collectionSynced(
    collectionAccount(emptyCloudCollection(), status("account-a")),
    "account-a",
    ["plan-a"],
  );
function setup() {
  let account: string | null = "account-a";
  const events: string[] = [];
  let local = ["plan-a"];
  let collection = synced();
  const actions = {
    currentAccount: () => account,
    readStatus: vi.fn(async () => status(account)),
    deleteCloud: vi.fn(async () => {
      events.push("cloud");
    }),
    deleteDevice: vi.fn(async (id: string) => {
      events.push("device");
      local = local.filter((value) => value !== id);
    }),
    cloudDeleted: vi.fn((owner: string, id: string) => {
      events.push("confirmed");
      collection = collectionDeleted(collection, owner, id);
    }),
  };
  return {
    actions,
    events,
    local: () => local,
    collection: () => collection,
    switchAccount: (value: string | null) => {
      account = value;
    },
  };
}

describe("Native cloud collection provenance", () => {
  it("retains a successful account sync when the next collection fetch fails", () => {
    const original = synced();
    // Status is refreshed independently; a failing collection fetch never
    // replaces its previous verified account-specific references with [].
    const refreshed = collectionAccount(original, status("account-a"));
    expect(syncedAccountForPlan(refreshed, "plan-a")).toBe("account-a");
    expect(syncedAccountForPlan(refreshed, "device-only")).toBeUndefined();
  });
  it("never applies another account’s synced references after switch or sign-out", () => {
    const a = synced(),
      b = collectionAccount(a, status("account-b"));
    expect(syncedAccountForPlan(b, "plan-a")).toBeUndefined();
    expect(collectionSynced(b, "account-a", ["late-a-response"])).toBe(b);
    expect(
      syncedAccountForPlan(collectionAccount(b, status(null)), "plan-a"),
    ).toBeUndefined();
    expect(
      syncedAccountForPlan(collectionAccount(b, status("account-a")), "plan-a"),
    ).toBe("account-a");
    expect(
      syncedAccountForPlan(
        collectionAccount(a, status("account-a", false)),
        "plan-a",
      ),
    ).toBeUndefined();
  });
  it("replaces only the refreshed account’s references and safely handles unusual account strings", () => {
    let collection = synced();
    collection = collectionAccount(collection, status("account-b"));
    collection = collectionSynced(collection, "account-b", [
      "plan-b",
      "plan-b",
    ]);
    expect(collection.syncedByAccount["account-a"]).toEqual(["plan-a"]);
    expect(collection.syncedByAccount["account-b"]).toEqual(["plan-b"]);
    expect(
      syncedAccountForPlan(
        collectionAccount(collection, status("toString")),
        "plan-b",
      ),
    ).toBeUndefined();
  });
});

describe("Truthful native collection deletion", () => {
  it("uses the server path before local removal after a successful sync and failed refresh", async () => {
    const test = setup();
    const afterFailedRefresh = collectionAccount(
      test.collection(),
      status("account-a"),
    );
    const accountId = syncedAccountForPlan(afterFailedRefresh, "plan-a");
    await expect(
      deleteSavedCollectionPlan({ planId: "plan-a", accountId }, test.actions),
    ).resolves.toBe("account-and-device");
    expect(test.actions.readStatus).toHaveBeenCalledOnce();
    expect(test.actions.deleteCloud).toHaveBeenCalledWith("plan-a");
    expect(test.events).toEqual(["cloud", "confirmed", "device"]);
    expect(test.local()).toEqual([]);
    expect(syncedAccountForPlan(test.collection(), "plan-a")).toBeUndefined();
  });
  it("preserves the device copy and confirmed provenance when cloud deletion fails", async () => {
    const test = setup();
    test.actions.deleteCloud.mockRejectedValue(
      new Error("Cloud deletion unavailable"),
    );
    await expect(
      deleteSavedCollectionPlan(
        { planId: "plan-a", accountId: "account-a" },
        test.actions,
      ),
    ).rejects.toThrow("Cloud deletion unavailable");
    expect(test.local()).toEqual(["plan-a"]);
    expect(test.actions.deleteDevice).not.toHaveBeenCalled();
    expect(test.actions.cloudDeleted).not.toHaveBeenCalled();
    expect(syncedAccountForPlan(test.collection(), "plan-a")).toBe("account-a");
  });
  it("keeps local data if current account verification fails, expires, or returns another account", async () => {
    for (const result of [
      "offline",
      "signed-out",
      "different-account",
      "cloud-off",
    ] as const) {
      const test = setup();
      if (result === "offline")
        test.actions.readStatus.mockRejectedValue(
          new Error("Network unavailable"),
        );
      else
        test.actions.readStatus.mockResolvedValue(
          result === "signed-out"
            ? status(null)
            : result === "different-account"
              ? status("account-b")
              : status("account-a", false),
        );
      await expect(
        deleteSavedCollectionPlan(
          { planId: "plan-a", accountId: "account-a" },
          test.actions,
        ),
      ).rejects.toThrow("device copy");
      expect(test.actions.deleteCloud).not.toHaveBeenCalled();
      expect(test.local()).toEqual(["plan-a"]);
    }
  });
  it("fences account switches and sign-out while verification is in flight", async () => {
    for (const account of ["account-b", null]) {
      const test = setup();
      test.actions.readStatus.mockImplementation(async () => {
        test.switchAccount(account);
        return status("account-a");
      });
      await expect(
        deleteSavedCollectionPlan(
          { planId: "plan-a", accountId: "account-a" },
          test.actions,
        ),
      ).rejects.toThrow("account changed");
      expect(test.actions.deleteCloud).not.toHaveBeenCalled();
      expect(test.local()).toEqual(["plan-a"]);
    }
  });
  it("does not delete a local copy after an aborted cloud request", async () => {
    const test = setup(),
      controller = new AbortController();
    test.actions.deleteCloud.mockImplementation(async () => {
      controller.abort();
    });
    await expect(
      deleteSavedCollectionPlan(
        { planId: "plan-a", accountId: "account-a" },
        test.actions,
        controller.signal,
      ),
    ).rejects.toThrow("cancelled");
    expect(test.actions.deleteDevice).not.toHaveBeenCalled();
    expect(test.actions.cloudDeleted).not.toHaveBeenCalled();
  });
  it("reports an account-only partial deletion honestly if local removal fails", async () => {
    const test = setup();
    test.actions.deleteDevice.mockRejectedValue(
      new Error("Storage unavailable"),
    );
    await expect(
      deleteSavedCollectionPlan(
        { planId: "plan-a", accountId: "account-a" },
        test.actions,
      ),
    ).rejects.toThrow(
      "account copy and its share links were deleted, but this device copy could not",
    );
    expect(test.local()).toEqual(["plan-a"]);
    expect(syncedAccountForPlan(test.collection(), "plan-a")).toBeUndefined();
  });
  it("removes guest or explicitly local-only copies without any cloud request or claim", async () => {
    for (const account of ["account-a", null]) {
      const test = setup();
      test.switchAccount(account);
      await expect(
        deleteSavedCollectionPlan({ planId: "plan-a" }, test.actions),
      ).resolves.toBe("device-only");
      expect(test.actions.readStatus).not.toHaveBeenCalled();
      expect(test.actions.deleteCloud).not.toHaveBeenCalled();
      expect(test.actions.cloudDeleted).not.toHaveBeenCalled();
      expect(test.local()).toEqual([]);
    }
  });
});
