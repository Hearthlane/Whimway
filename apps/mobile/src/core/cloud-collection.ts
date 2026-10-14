export type CloudStatus = { user: { id: string } | null; cloud: boolean };
export type CloudCollection = {
  accountId: string | null | undefined;
  enabled: boolean;
  syncedByAccount: Record<string, string[]>;
};
export const emptyCloudCollection = (): CloudCollection => ({
  accountId: undefined,
  enabled: false,
  syncedByAccount: {},
});
export function collectionAccount(
  previous: CloudCollection,
  status: CloudStatus,
): CloudCollection {
  return {
    ...previous,
    accountId: status.user?.id ?? null,
    enabled: status.cloud,
  };
}
export function collectionSynced(
  previous: CloudCollection,
  accountId: string,
  planIds: string[],
): CloudCollection {
  if (previous.accountId !== accountId || !previous.enabled) return previous;
  return {
    ...previous,
    syncedByAccount: {
      ...previous.syncedByAccount,
      [accountId]: [...new Set(planIds)],
    },
  };
}
export function syncedAccountForPlan(
  collection: CloudCollection,
  planId: string,
): string | undefined {
  const accountId = collection.accountId;
  if (
    !accountId ||
    !collection.enabled ||
    !Object.hasOwn(collection.syncedByAccount, accountId)
  )
    return undefined;
  return collection.syncedByAccount[accountId].includes(planId)
    ? accountId
    : undefined;
}
export function collectionDeleted(
  previous: CloudCollection,
  accountId: string,
  planId: string,
): CloudCollection {
  if (!Object.hasOwn(previous.syncedByAccount, accountId)) return previous;
  return {
    ...previous,
    syncedByAccount: {
      ...previous.syncedByAccount,
      [accountId]: previous.syncedByAccount[accountId].filter(
        (id) => id !== planId,
      ),
    },
  };
}

export type SavedDeletionTarget = { planId: string; accountId?: string };
export async function deleteSavedCollectionPlan(
  target: SavedDeletionTarget,
  actions: {
    currentAccount: () => string | null | undefined;
    readStatus: () => Promise<CloudStatus>;
    deleteCloud: (id: string) => Promise<void>;
    deleteDevice: (id: string) => Promise<void>;
    cloudDeleted: (accountId: string, planId: string) => void;
  },
  signal?: AbortSignal,
): Promise<"account-and-device" | "device-only"> {
  const check = () => {
    if (signal?.aborted) throw new Error("The deletion was cancelled.");
    if (target.accountId && actions.currentAccount() !== target.accountId)
      throw new Error(
        "Your account changed. Keep this device copy and confirm deletion again in the account that saved it.",
      );
  };
  check();
  if (target.accountId) {
    let status: CloudStatus;
    try {
      status = await actions.readStatus();
    } catch {
      throw new Error(
        "Your account could not be verified. This device copy was kept. Check your connection and try again.",
      );
    }
    check();
    if (!status.cloud || status.user?.id !== target.accountId)
      throw new Error(
        "Sign in to the account that saved this plan before deleting its cloud copy. This device copy was kept.",
      );
    // A cloud failure must never fall through to deleting the device copy.
    await actions.deleteCloud(target.planId);
    check();
    actions.cloudDeleted(target.accountId, target.planId);
  }
  check();
  try {
    await actions.deleteDevice(target.planId);
  } catch (error) {
    if (target.accountId)
      throw new Error(
        "The account copy and its share links were deleted, but this device copy could not be removed. Try removing the device copy again.",
      );
    throw error;
  }
  return target.accountId ? "account-and-device" : "device-only";
}
