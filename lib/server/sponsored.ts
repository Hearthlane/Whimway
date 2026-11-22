import { randomUUID } from "node:crypto";
import { Campaign, type AdEvent, type NewCampaign } from "../sponsored";
import { supabase } from "./supabase";
import type { z } from "zod";

/**
 * Where campaigns and their impression/click counts live. Supabase when configured
 * (tables are closed to clients; only security-definer functions touch them). Otherwise
 * memory, so development exercises the full flow; memory is per-process and not durable.
 */
export interface SponsoredStore {
  list(): Promise<Campaign[]>;
  create(input: z.infer<typeof NewCampaign>): Promise<Campaign>;
  update(
    id: string,
    patch: Partial<z.infer<typeof NewCampaign>>,
  ): Promise<Campaign>;
  remove(id: string): Promise<void>;
  record(event: AdEvent): Promise<void>;
  /** Per campaign: impressions and clicks (unique per install per day). */
  stats(): Promise<Record<string, { impressions: number; clicks: number }>>;
}

const cloud = () =>
  Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );

class MemoryStore implements SponsoredStore {
  campaigns = new Map<string, Campaign>();
  // campaign -> kind -> set of "install|day" (unique per install per day, like the SQL)
  events = new Map<string, { impression: Set<string>; click: Set<string> }>();
  async list() {
    return [...this.campaigns.values()];
  }
  async create(input: z.infer<typeof NewCampaign>) {
    const c = Campaign.parse({ ...input, id: randomUUID() });
    this.campaigns.set(c.id, c);
    return c;
  }
  async update(id: string, patch: Partial<z.infer<typeof NewCampaign>>) {
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
  async record(e: AdEvent) {
    if (!this.campaigns.has(e.campaignId)) return;
    const day = new Date().toISOString().slice(0, 10);
    const bucket = this.events.get(e.campaignId) ?? {
      impression: new Set(),
      click: new Set(),
    };
    bucket[e.kind].add(`${e.installId}|${day}`);
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
  // Campaign management needs the service role; the API only calls these after ADMIN_KEY.
  private async admin() {
    const db = await supabase();
    return db;
  }
  async list() {
    const db = await supabase();
    const { data, error } = await db.rpc("active_campaigns");
    if (error) throw new Error("campaigns");
    return ((data ?? []) as unknown[]).map((c) => Campaign.parse(c));
  }
  async create(input: z.infer<typeof NewCampaign>) {
    const db = await this.admin();
    const { data, error } = await db.rpc("admin_save_campaign", {
      admin_secret: process.env.ADMIN_KEY ?? "",
      campaign: { ...input, id: randomUUID() },
    });
    if (error) throw new Error("campaigns");
    return Campaign.parse(data);
  }
  async update(id: string, patch: Partial<z.infer<typeof NewCampaign>>) {
    const current = (await this.list()).find((c) => c.id === id);
    if (!current) throw new Error("not_found");
    const db = await this.admin();
    const { data, error } = await db.rpc("admin_save_campaign", {
      admin_secret: process.env.ADMIN_KEY ?? "",
      campaign: { ...current, ...patch, id },
    });
    if (error) throw new Error("campaigns");
    return Campaign.parse(data);
  }
  async remove(id: string) {
    const db = await this.admin();
    const { error } = await db.rpc("admin_delete_campaign", {
      admin_secret: process.env.ADMIN_KEY ?? "",
      campaign_id: id,
    });
    if (error) throw new Error("campaigns");
  }
  async record(e: AdEvent) {
    const db = await supabase();
    const { error } = await db.rpc("record_ad_event", {
      campaign: e.campaignId,
      install: e.installId,
      what: e.kind,
    });
    if (error) throw new Error("ad_event");
  }
  async stats() {
    const db = await supabase();
    const { data, error } = await db.rpc("campaign_stats", {
      admin_secret: process.env.ADMIN_KEY ?? "",
    });
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
