"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Bookmark,
  MapPin,
  Clock,
  ArrowUpRight,
  Trash2,
  Plus,
  Cloud,
  HardDrive,
} from "lucide-react";
import { getLocal, removeLocal } from "@/lib/storage";
import { api, type Status } from "@/lib/client";
import type { PlanSpec } from "@/lib/schema";
import { Button, Empty, Notice, Modal } from "./ui";
export function Saved() {
  const [plans, setPlans] = useState<{ spec: PlanSpec; cloud: boolean }[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<{ spec: PlanSpec; cloud: boolean }>();
  async function load() {
    setLoading(true);
    const local = Object.values(getLocal()).map((spec) => ({
      spec,
      cloud: false,
    }));
    setPlans(local);
    try {
      const s = await api<Status>("status");
      if (s.user && s.cloud) {
        const rows = await api<{ spec: PlanSpec }[]>("plans");
        const map = new Map(local.map((p) => [p.spec.id, p]));
        for (const row of rows) {
          const device = map.get(row.spec.id);
          map.set(row.spec.id, {
            spec:
              device && device.spec.revision > row.spec.revision
                ? device.spec
                : row.spec,
            cloud: true,
          });
        }
        setPlans([...map.values()]);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function remove() {
    if (!pending) return;
    setError("");
    try {
      if (pending.cloud)
        await api(`plans/${pending.spec.id}`, undefined, { method: "DELETE" });
      removeLocal(pending.spec.id);
      setPlans((p) => p.filter((x) => x.spec.id !== pending.spec.id));
      setPending(undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="wrap collection-page">
      <div className="collection-heading">
        <div>
          <div className="eyebrow">GOOD DAYS, KEPT CLOSE</div>
          <h1>
            A few plans.
            <br />A lot to <span className="serif">look forward to.</span>
          </h1>
          <p>Your outings, ready whenever you are.</p>
        </div>
        <Link className="button primary" href="/create">
          <Plus size={18} />
          Plan something new
        </Link>
      </div>
      {error ? <Notice error>{error}</Notice> : null}
      {loading ? (
        <p role="status">Opening your collection…</p>
      ) : plans.length ? (
        <div className="saved-grid">
          {plans.map(({ spec, cloud }) => (
            <article className="saved-card" key={spec.id}>
              <div
                className={`saved-art ${spec.request.location.currency === "JPY" ? "lavender" : "mint"}`}
              >
                <MapPin size={52} strokeWidth={1} />
                <span>✦</span>
                <small>
                  {spec.demo
                    ? "DEVELOPMENT FIXTURE"
                    : "YOUR NEXT LITTLE ADVENTURE"}
                </small>
              </div>
              <div className="saved-card-content">
                <span className="card-place">
                  <MapPin size={13} />
                  {spec.request.location.name}
                </span>
                <h2>
                  <Link href={`/plan/${spec.id}`}>{spec.title}</Link>
                </h2>
                <p>
                  <Clock size={14} />
                  {spec.request.date} · {spec.stops.length} stops
                </p>
                <div className="saved-card-bottom">
                  <span>
                    {cloud ? <Cloud size={15} /> : <HardDrive size={15} />}{" "}
                    {cloud ? "Account + device" : "This device"}
                  </span>
                  <Link
                    className="icon-button"
                    href={`/plan/${spec.id}`}
                    aria-label={`Open ${spec.title}`}
                  >
                    <ArrowUpRight size={20} />
                  </Link>
                  <button
                    className="icon-button"
                    onClick={() => setPending({ spec, cloud })}
                    aria-label={`Delete ${spec.title}`}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          title="Your good days will live here."
          text="Make a plan and it saves on this device. Sign in when you want to take it across devices."
        >
          <Link className="button primary" href="/create">
            <Bookmark size={17} />
            Find your next outing
          </Link>
        </Empty>
      )}
      <p className="collection-note">
        Saved plans keep stop IDs and your choices. Venue details, photos and
        routes refresh when you reopen them.
      </p>
      <Modal
        open={Boolean(pending)}
        onClose={() => setPending(undefined)}
        title="Let this plan go?"
        description="This deletes the device copy, any account copy and its public share links."
      >
        <div className="share-actions">
          <Button className="danger" onClick={remove}>
            Delete plan
          </Button>
          <Button className="secondary" onClick={() => setPending(undefined)}>
            Keep it
          </Button>
        </div>
      </Modal>
    </div>
  );
}
