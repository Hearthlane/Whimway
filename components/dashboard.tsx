"use client";
import { useCallback, useEffect, useState } from "react";
import { sentiment } from "@/lib/crowd";
import type { MetricsSummary } from "@/lib/metrics";

type Data = {
  summary: MetricsSummary;
  tallies: Record<string, { up: number; down: number }>;
  polls: Record<string, { a: number; b: number }>;
};
const pct = (n: number | null) =>
  n === null ? "—" : `${Math.round(n * 100)}%`;
const label = (name: string) =>
  name.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** Founder dashboard: real recorded history from the anonymous event log. */
export function Dashboard() {
  const [key, setKey] = useState("");
  const [data, setData] = useState<Data>();
  const [error, setError] = useState("");
  const load = useCallback(async (k: string) => {
    setError("");
    try {
      const r = await fetch("/api/admin/metrics", {
        headers: k ? { "x-admin-key": k } : {},
        cache: "no-store",
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "Could not load metrics.");
      setData(body);
      if (k) sessionStorage.setItem("whimway:admin", k);
    } catch (e) {
      setData(undefined);
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    const saved = sessionStorage.getItem("whimway:admin") ?? "";
    setKey(saved);
    void load(saved);
  }, [load]);

  if (!data)
    return (
      <main className="wrap legal-page">
        <h1>Metrics</h1>
        <p>{error || "Loading…"}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void load(key);
          }}
          style={{ display: "flex", gap: 8, marginTop: 16, maxWidth: 420 }}
        >
          <label style={{ flex: 1 }}>
            <span className="sr-only">Admin key</span>
            <input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Admin key"
              type="password"
              style={{
                width: "100%",
                padding: 12,
                borderRadius: 12,
                border: "1px solid var(--line)",
              }}
            />
          </label>
          <button className="button primary" type="submit">
            View metrics
          </button>
        </form>
      </main>
    );

  const s = data.summary;
  const maxPlans = Math.max(1, ...s.series.map((d) => d.plans));
  const maxFunnel = Math.max(1, ...s.funnel.map((f) => f.installs));
  const ranked = Object.entries(data.tallies)
    .map(([k, t]) => ({ key: k, ...t, score: sentiment(t) }))
    .sort((a, b) => b.score - a.score);
  const tiles: [string, string, string][] = [
    ["People", String(s.totals.installs), "anonymous installs seen"],
    [
      "Plans made",
      String(s.totals.plans),
      s.timeToPlanMs === null
        ? "no timing yet"
        : `median ${(s.timeToPlanMs / 1000).toFixed(1)}s to a plan`,
    ],
    ["Went on the plan", pct(s.wentRate), `${s.feedbackCount} rated`],
    [
      "Came back in 7 days",
      s.repeat.cohort ? pct(s.repeat.within7d / s.repeat.cohort) : "—",
      `${s.repeat.within7d} of ${s.repeat.cohort} planners`,
    ],
    [
      "Saved / shared",
      `${s.totals.saves} / ${s.totals.shares}`,
      `${s.totals.shareOpens} share opens`,
    ],
    [
      "Plus conversion",
      pct(s.paywallConversion),
      `${s.totals.plusStarts} of ${s.totals.paywallViews} paywall views (demo)`,
    ],
  ];
  const card = {
    background: "var(--paper)",
    border: "1px solid var(--line)",
    borderRadius: 20,
    padding: 20,
  } as const;
  return (
    <main
      className="wrap"
      style={{ padding: "32px 20px 80px", display: "grid", gap: 20 }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <h1 style={{ fontSize: 32 }}>Metrics</h1>
        <p style={{ color: "var(--muted)" }}>
          Recorded on this server from people who allow usage stats. Updated{" "}
          {new Date(s.generatedAt).toLocaleString()}.{" "}
          <button
            onClick={() => void load(key)}
            style={{
              textDecoration: "underline",
              background: "none",
              border: 0,
              padding: 0,
              color: "inherit",
            }}
          >
            Refresh
          </button>
        </p>
      </header>

      <section
        aria-label="Headline numbers"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
          gap: 12,
        }}
      >
        {tiles.map(([name, value, note]) => (
          <div key={name} style={card}>
            <div style={{ color: "var(--muted)", fontSize: 13 }}>{name}</div>
            <div
              style={{
                fontFamily: "Outfit, sans-serif",
                fontSize: 30,
                lineHeight: 1.2,
              }}
            >
              {value}
            </div>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>{note}</div>
          </div>
        ))}
      </section>

      <section style={card}>
        <h2 style={{ fontSize: 18 }}>
          Plans made per day, last {s.series.length} days
        </h2>
        <div
          role="img"
          aria-label={`Plans per day. Peak ${maxPlans}.`}
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 2,
            height: 140,
            marginTop: 16,
            borderBottom: "1px solid var(--line)",
          }}
        >
          {s.series.map((d) => (
            <div
              key={d.day}
              title={`${d.day}: ${d.plans} plans, ${d.active} active, ${d.saves} saves, ${d.shares} shares`}
              style={{
                flex: 1,
                height: "100%",
                display: "flex",
                alignItems: "flex-end",
              }}
            >
              <div
                style={{
                  width: "100%",
                  height: `${(d.plans / maxPlans) * 100}%`,
                  minHeight: d.plans ? 3 : 0,
                  background: "var(--ink)",
                  borderRadius: "4px 4px 0 0",
                }}
              />
            </div>
          ))}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            color: "var(--muted)",
            fontSize: 12,
            marginTop: 6,
          }}
        >
          <span>{s.series[0].day}</span>
          <span>peak {maxPlans}</span>
          <span>{s.series.at(-1)!.day}</span>
        </div>
        <details style={{ marginTop: 12 }}>
          <summary>Show as a table</summary>
          <table
            style={{
              width: "100%",
              marginTop: 8,
              fontSize: 13,
              borderCollapse: "collapse",
            }}
          >
            <thead>
              <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                <th>Day</th>
                <th>Active</th>
                <th>Plans</th>
                <th>Saves</th>
                <th>Shares</th>
              </tr>
            </thead>
            <tbody>
              {s.series.map((d) => (
                <tr key={d.day} style={{ borderTop: "1px solid var(--line)" }}>
                  <td>{d.day}</td>
                  <td>{d.active}</td>
                  <td>{d.plans}</td>
                  <td>{d.saves}</td>
                  <td>{d.shares}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>

      <section style={card}>
        <h2 style={{ fontSize: 18 }}>Funnel, by people</h2>
        <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
          {s.funnel.map((f) => (
            <div
              key={f.name}
              style={{
                display: "grid",
                gridTemplateColumns: "170px 1fr 48px",
                alignItems: "center",
                gap: 10,
                fontSize: 13,
              }}
              title={`${label(f.name)}: ${f.installs} people`}
            >
              <span>{label(f.name)}</span>
              <div
                style={{
                  height: 14,
                  background: "var(--canvas)",
                  borderRadius: 4,
                }}
              >
                <div
                  style={{
                    width: `${(f.installs / maxFunnel) * 100}%`,
                    height: "100%",
                    background: "var(--ink)",
                    borderRadius: 4,
                  }}
                />
              </div>
              <strong style={{ textAlign: "right" }}>{f.installs}</strong>
            </div>
          ))}
        </div>
      </section>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 20,
        }}
      >
        <section style={card}>
          <h2 style={{ fontSize: 18 }}>What people like and don’t</h2>
          <p style={{ color: "var(--muted)", fontSize: 13 }}>
            Only shown once five different people have reacted.
          </p>
          {ranked.length ? (
            <table
              style={{
                width: "100%",
                marginTop: 8,
                fontSize: 13,
                borderCollapse: "collapse",
              }}
            >
              <thead>
                <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                  <th>Place or type</th>
                  <th>Liked</th>
                  <th>Not for them</th>
                </tr>
              </thead>
              <tbody>
                {ranked.slice(0, 12).map((r) => (
                  <tr
                    key={r.key}
                    style={{ borderTop: "1px solid var(--line)" }}
                  >
                    <td>
                      {r.key
                        .replace(/^(cat|type|place):/, "")
                        .replace(/_/g, " ")}
                    </td>
                    <td>{r.up}</td>
                    <td>{r.down}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p style={{ marginTop: 8 }}>Not enough reactions yet.</p>
          )}
        </section>
        <section style={card}>
          <h2 style={{ fontSize: 18 }}>Why plans miss, and how people book</h2>
          <List
            title="Thumbs-down reasons"
            rows={s.pulseReasons}
            empty="No thumbs-down reasons yet."
          />
          <List
            title="Booking and directions taps"
            rows={s.booking}
            empty="No booking taps yet."
          />
          <List
            title="Poll votes"
            rows={Object.fromEntries(
              Object.entries(data.polls).map(([k, v]) => [k, v.a + v.b]),
            )}
            empty="No poll votes yet."
          />
        </section>
      </div>
    </main>
  );
}

function List({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: Record<string, number>;
  empty: string;
}) {
  const entries = Object.entries(rows).sort((a, b) => b[1] - a[1]);
  return (
    <div style={{ marginTop: 14 }}>
      <h3 style={{ fontSize: 14 }}>{title}</h3>
      {entries.length ? (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: "6px 0 0",
            fontSize: 13,
          }}
        >
          {entries.map(([k, v]) => (
            <li
              key={k}
              style={{
                display: "flex",
                justifyContent: "space-between",
                borderTop: "1px solid var(--line)",
                padding: "4px 0",
              }}
            >
              <span>{label(k)}</span>
              <strong>{v}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>{empty}</p>
      )}
    </div>
  );
}
