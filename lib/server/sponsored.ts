import { randomUUID } from "node:crypto";
import { Campaign, type NewCampaign } from "../sponsored";
import { serviceClient } from "./supabase";
import type { z } from "zod";

/**
 * Where campaigns and their impression/click counts live. Supabase when configured: the
 * tables are closed to clients and the functions run only for the service role, so all
 * access goes through this server. Otherwise memory, so development exercises the full
 * flow; memory is per-process and not durable.
 */
export interface SponsoredStore {
  /** Campaigns that could be served now. */
  list(): Promise<Campaign[]>;
  /** Every campaign, including paused, scheduled and ended ones (admin only). */
  listAll(): Promise<Campaign[]>;
  create(input: z.infer<typeof NewCampaign>): Promise<Campaign>;
  /** Merge a patch into a campaign and validate the result as a whole. */
  update(id: string, patch: Record<string, unknown>): Promise<Campaign>;
  remove(id: string): Promise<void>;
  /** One view or tap, counted once per network per day. */
  record(event: {
    campaignId: string;
    network: string;
    kind: "impression" | "click";
  }): Promise<void>;
  stats(): Promise<Record<string, { impressions: number; clicks: number }>>;
}

const cloud = () =>
  Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
const running = (c: Campaign, now = Date.now()) =>
  c.active && Date.parse(c.startsAt) <= now && now < Date.parse(c.endsAt);

class MemoryStore implements SponsoredStore {
  campaigns = new Map<string, Campaign>();
  // campaign -> kind -> set of "network|day"
  events = new Map<string, { impression: Set<string>; click: Set<string> }>();
  async list() {
    const stats = await this.stats();
    return [...this.campaigns.values()].filter(
      (c) =>
        running(c) &&
        (!c.impressionCap || (stats[c.id]?.impressions ?? 0) < c.impressionCap),
    );
  }
  async listAll() {
    return [...this.campaigns.values()];
  }
  async create(input: z.infer<typeof NewCampaign>) {
    const c = Campaign.parse({ ...input, id: randomUUID() });
    this.campaigns.set(c.id, c);
    return c;
  }
  async update(id: string, patch: Record<string, unknown>) {
    const current = this.campaigns.get(id);
    if (!current) throw new Error("not_found");
    const c = Campaign.parse({ ...current, ...patch, id });
    this.campaigns.set(id, c);
    return c;
  }
  async remove(id: string) {
    this.campaigns.delete(id);
    this.events.delete(id);
  }
  async record(e: {
    campaignId: string;
    network: string;
    kind: "impression" | "click";
  }) {
    if (!this.campaigns.has(e.campaignId)) return;
    const day = new Date().toISOString().slice(0, 10);
    const bucket = this.events.get(e.campaignId) ?? {
      impression: new Set(),
      click: new Set(),
    };
    bucket[e.kind].add(`${e.network}|${day}`);
    this.events.set(e.campaignId, bucket);
  }
  async stats() {
    const out: Record<string, { impressions: number; clicks: number }> = {};
    for (const id of this.campaigns.keys()) {
      const b = this.events.get(id);
      out[id] = {
        impressions: b?.impression.size ?? 0,
        clicks: b?.click.size ?? 0,
      };
    }
    return out;
  }
}

class SupabaseStore implements SponsoredStore {
  private rpc(name: string, args: Record<string, unknown> = {}) {
    return serviceClient().rpc(name, args);
  }
  private secret() {
    return { admin_secret: process.env.ADMIN_KEY ?? "" };
  }
  async list() {
    const { data, error } = await this.rpc("active_campaigns");
    if (error) throw new Error("campaigns");
    return ((data ?? []) as unknown[]).map((c) => Campaign.parse(c));
  }
  async listAll() {
    const { data, error } = await this.rpc(
      "admin_list_campaigns",
      this.secret(),
    );
    if (error) throw new Error("campaigns");
    return ((data ?? []) as unknown[]).map((c) => Campaign.parse(c));
  }
  private async save(c: Campaign) {
    const { data, error } = await this.rpc("admin_save_campaign", {
      ...this.secret(),
      campaign: c,
    });
    if (error) throw new Error("campaigns");
    return Campaign.parse(data);
  }
  async create(input: z.infer<typeof NewCampaign>) {
    return this.save(Campaign.parse({ ...input, id: randomUUID() }));
  }
  async update(id: string, patch: Record<string, unknown>) {
    const current = (await this.listAll()).find((c) => c.id === id);
    if (!current) throw new Error("not_found");
    return this.save(Campaign.parse({ ...current, ...patch, id }));
  }
  async remove(id: string) {
    const { error } = await this.rpc("admin_delete_campaign", {
      ...this.secret(),
      campaign_id: id,
    });
    if (error) throw new Error("campaigns");
  }
  async record(e: {
    campaignId: string;
    network: string;
    kind: "impression" | "click";
  }) {
    const { error } = await this.rpc("record_ad_event", {
      campaign: e.campaignId,
      install: e.network,
      what: e.kind,
    });
    if (error) throw new Error("ad_event");
  }
  async stats() {
    const { data, error } = await this.rpc("campaign_stats", this.secret());
    if (error) throw new Error("campaign_stats");
    return (data ?? {}) as Record<
      string,
      { impressions: number; clicks: number }
    >;
  }
}

const memory = new MemoryStore();
export const sponsoredStore = (): SponsoredStore =>
  cloud() ? new SupabaseStore() : memory;
/** Test hook. */
export const memorySponsored = memory;

/**
 * Serving reads campaigns and their counts on every screen that shows a slot; cache that
 * for a minute so a busy app, or someone hammering the endpoint, costs one query a minute.
 */
let served: {
  at: number;
  value: Promise<{
    campaigns: Campaign[];
    impressions: Record<string, number>;
  }>;
} | null = null;
export function servable() {
  if (served && Date.now() - served.at < 60_000) return served.value;
  const store = sponsoredStore();
  const value = Promise.all([store.list(), store.stats()]).then(
    ([campaigns, stats]) => ({
      campaigns,
      impressions: Object.fromEntries(
        Object.entries(stats).map(([id, s]) => [id, s.impressions]),
      ),
    }),
  );
  served = { at: Date.now(), value };
  value.catch(() => (served = null));
  return value;
}
/** Campaign changes take effect immediately. */
export function invalidateServable() {
  served = null;
}
