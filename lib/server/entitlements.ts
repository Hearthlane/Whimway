import { timingSafeEqual } from "node:crypto";
import { AppError } from "../errors";
import { FREE, monthKey, type PlusPlan } from "../plus";
import { demoAllowed } from "./providers";
import { supabase } from "./supabase";

/**
 * Server-side Whimway Plus. The entitlement comes from the billing webhook (store
 * purchases), never from the client. The monthly free allowance is counted per account,
 * or per install for guests. Without Supabase (local development) both fall back to
 * memory so the full flow can be exercised.
 */
export type Entitlement = {
  plus: boolean;
  plan?: PlusPlan;
  until?: string;
  source: "store" | "demo" | "none";
};
const cloud = () =>
  Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
const INSTALL = /^[A-Za-z0-9-]{8,64}$/;

const memoryUsage = new Map<string, number>();
const memoryEntitlements = new Map<
  string,
  { active: boolean; plan: PlusPlan; until?: string }
>();
/** Test hook. */
export function resetEntitlements() {
  memoryUsage.clear();
  memoryEntitlements.clear();
}

export function installOf(request: Request) {
  const id = request.headers.get("x-whimway-install") ?? "";
  return INSTALL.test(id) ? id : undefined;
}

export async function entitlementFor(
  request: Request,
  userId?: string,
): Promise<Entitlement> {
  // Demo purchases are honoured only where demo mode is allowed (never in production).
  if (demoAllowed() && request.headers.get("x-whimway-demo-plus") === "1")
    return { plus: true, source: "demo" };
  if (!userId) return { plus: false, source: "none" };
  let row:
    | { active: boolean; plan: PlusPlan; until?: string | null }
    | undefined
    | null;
  if (cloud()) {
    const db = await supabase();
    row = (
      await db
        .from("entitlements")
        .select("active,plan,until")
        .eq("user_id", userId)
        .maybeSingle()
    ).data;
  } else row = memoryEntitlements.get(userId);
  const live = Boolean(
    row?.active && (!row.until || new Date(row.until) > new Date()),
  );
  return live
    ? {
        plus: true,
        plan: row!.plan,
        until: row!.until ?? undefined,
        source: "store",
      }
    : { plus: false, source: "none" };
}

const usageKey = (identity: string) => `${identity}:${monthKey()}`;
export async function plansThisMonth(
  install: string | undefined,
  userId?: string,
) {
  if (!install && !userId) return 0;
  if (cloud()) {
    const db = await supabase();
    const { data } = await db.rpc("plans_this_month", {
      install: install ?? "unknown-install",
    });
    return Number(data ?? 0);
  }
  return (
    memoryUsage.get(usageKey(userId ? `u:${userId}` : `i:${install}`)) ?? 0
  );
}
export async function countPlanMade(
  install: string | undefined,
  userId?: string,
) {
  if (!install && !userId) return;
  if (cloud()) {
    const db = await supabase();
    await db.rpc("count_plan", { install: install ?? "unknown-install" });
    return;
  }
  const key = usageKey(userId ? `u:${userId}` : `i:${install}`);
  memoryUsage.set(key, (memoryUsage.get(key) ?? 0) + 1);
}

/** Refuse a new plan once the free monthly allowance is used. Web guests with no install are covered by the daily cap. */
export async function requirePlanAllowance(request: Request, userId?: string) {
  const install = installOf(request);
  if (!install && !userId) return;
  if ((await entitlementFor(request, userId)).plus) return;
  if ((await plansThisMonth(install, userId)) >= FREE.plansPerMonth)
    throw new AppError(
      "PLAN_LIMIT",
      `You’ve used this month’s ${FREE.plansPerMonth} free plans. Get unlimited plans with Whimway Plus.`,
      402,
    );
}

// ---- Billing webhook (RevenueCat event format) ----
const grants = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "UNCANCELLATION",
  "PRODUCT_CHANGE",
  "NON_RENEWING_PURCHASE",
]);
const revokes = new Set(["EXPIRATION"]);
/** Turn a billing event into an entitlement change, or null when it changes nothing (e.g. CANCELLATION keeps access until expiry). */
export function entitlementChange(event: {
  type?: string;
  app_user_id?: string;
  product_id?: string;
  expiration_at_ms?: number | null;
}) {
  const user = event.app_user_id ?? "";
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      user,
    )
  )
    return null;
  const type = event.type ?? "";
  if (!grants.has(type) && !revokes.has(type)) return null;
  return {
    user,
    active: grants.has(type),
    plan: (/year|annual/i.test(event.product_id ?? "")
      ? "yearly"
      : "monthly") as PlusPlan,
    until: event.expiration_at_ms
      ? new Date(event.expiration_at_ms).toISOString()
      : undefined,
  };
}

export async function handleBillingWebhook(request: Request) {
  const secret = process.env.BILLING_WEBHOOK_SECRET;
  if (!secret)
    throw new AppError("NOT_CONFIGURED", "Billing is not configured.", 503);
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    throw new AppError("FORBIDDEN", "Invalid webhook credentials.", 401);
  const text = await request.text();
  if (text.length > 65536)
    throw new AppError("TOO_LARGE", "The request is too large.", 413);
  let payload: { event?: Parameters<typeof entitlementChange>[0] };
  try {
    payload = JSON.parse(text);
  } catch {
    throw new AppError("INVALID_JSON", "Invalid request.");
  }
  const change = entitlementChange(payload.event ?? {});
  if (!change) return { applied: false };
  if (cloud()) {
    const db = await supabase();
    const { error } = await db.rpc("apply_entitlement", {
      secret,
      target: change.user,
      is_active: change.active,
      plan_name: change.plan,
      expires: change.until ?? null,
      src: "store",
    });
    if (error)
      throw new AppError(
        "SAVE_FAILED",
        "Could not record the entitlement.",
        503,
      );
  } else
    memoryEntitlements.set(change.user, {
      active: change.active,
      plan: change.plan,
      until: change.until,
    });
  return { applied: true };
}
