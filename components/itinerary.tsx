"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DateTime } from "luxon";
import {
  ArrowLeft,
  ArrowUpRight,
  ArrowDown,
  ArrowUp,
  Clock,
  MapPin,
  Footprints,
  Car,
  Users,
  Bookmark,
  Share2,
  Sparkles,
  Plus,
  LockKeyhole,
  LockKeyholeOpen,
  RefreshCw,
  Trash2,
  Undo2,
  SlidersHorizontal,
  Star,
  GripVertical,
  ChevronRight,
  Copy,
  Map as MapIcon,
  List,
} from "lucide-react";
import {
  Itinerary as ItinerarySchema,
  PlanSpec,
  remixActions,
  type Itinerary,
  type CandidatePlace,
  type PlanRequest,
} from "@/lib/schema";
import { api } from "@/lib/client";
import { saveLocal, getLocal } from "@/lib/storage";
import { money, timeLabel } from "@/lib/time";
import { navigationUrl } from "@/lib/navigation";
import { MapPanel } from "./map";
import { PlacePhoto } from "./place-photo";
import { Button, Notice, Modal, External, Empty } from "./ui";
export function ItineraryView({
  id,
  shared = false,
}: {
  id: string;
  shared?: boolean;
}) {
  const router = useRouter();
  const [plan, setPlan] = useState<Itinerary>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState("");
  const [history, setHistory] = useState<PlanSpec[]>([]);
  const [detailsFromExplore, setDetailsFromExplore] = useState(false);
  const [alternativeSelected, setAlternativeSelected] = useState("");
  const discoveryRequest = useRef<AbortController | null>(null);
  const [details, setDetails] = useState<CandidatePlace>();
  const [explore, setExplore] = useState(false);
  const [replace, setReplace] = useState<string>();
  const [query, setQuery] = useState("");
  const [alternatives, setAlternatives] = useState<CandidatePlace[]>([]);
  const [exploreBusy, setExploreBusy] = useState(false);
  const [exploreError, setExploreError] = useState("");
  const [adjust, setAdjust] = useState(false);
  const [shareLink, setShareLink] = useState("");
  const [shareId, setShareId] = useState("");
  const [view, setView] = useState<"list" | "map">("list");
  const [sheetHeight, setSheetHeight] = useState(58);
  const drag = useRef<number | null>(null);
  const flight = useRef(false);
  const sequence = useRef(0);
  const mounted = useRef(true);
  const request = useRef<AbortController | null>(null);
  const dragStart = useRef<{ y: number; height: number } | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
      discoveryRequest.current?.abort();
    };
  }, []);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const stored = shared
        ? await api<PlanSpec>(`shared/${id}`, undefined, {
            signal: controller.signal,
          })
        : (getLocal()[id] ??
          (await api<PlanSpec>(`plans/${id}`, undefined, {
            signal: controller.signal,
          })));
      const hydrated = await api<Itinerary>("hydrate", stored, {
        signal: controller.signal,
      });
      if (
        mounted.current &&
        request.current === controller &&
        !controller.signal.aborted
      ) {
        setError("");
        setPlan(ItinerarySchema.parse(hydrated));
        setSelected(hydrated.stops[0]?.placeId ?? "");
      }
    } catch (e) {
      if (
        mounted.current &&
        request.current === controller &&
        !controller.signal.aborted
      )
        setError((e as Error).message);
    } finally {
      if (
        mounted.current &&
        request.current === controller &&
        !controller.signal.aborted
      )
        setLoading(false);
    }
  }, [id, shared]);
  useEffect(() => {
    void load();
  }, [load]);
  const select = useCallback((placeId: string) => {
    setSelected(placeId);
    document.getElementById(`stop-${placeId}`)?.scrollIntoView({
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
      block: "nearest",
    });
  }, []);
  function apply(result: Itinerary, remember = true) {
    if (plan && remember)
      setHistory((h) => [...h.slice(-9), PlanSpec.parse(plan)]);
    setPlan(result);
    saveLocal(result);
  }
  async function change(path: string, data: unknown) {
    if (flight.current || shared) return;
    flight.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    const current = ++sequence.current;
    request.current = new AbortController();
    try {
      const result = await api<Itinerary>(path, data, {
        signal: request.current.signal,
      });
      if (current === sequence.current && mounted.current) {
        apply(result);
        setMessage("Your plan is updated. Route, time and costs recalculated.");
        setExplore(false);
        setDetailsFromExplore(false);
        setAdjust(false);
      }
    } catch (e) {
      if (mounted.current) {
        setError((e as Error).message);
        if (explore || detailsFromExplore)
          setExploreError((e as Error).message);
      }
    } finally {
      flight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function edit(stops: PlanSpec["stops"], req?: PlanRequest) {
    if (plan)
      void change("edit", { spec: PlanSpec.parse(plan), stops, request: req });
  }
  function lock(id: string) {
    if (!plan || busy || shared) return;
    const result = {
      ...plan,
      stops: plan.stops.map((s) =>
        s.placeId === id ? { ...s, locked: !s.locked } : s,
      ),
      revision: plan.revision + 1,
    };
    apply(result);
    setMessage(
      result.stops.find((s) => s.placeId === id)?.locked
        ? "Stop locked. Remixes will preserve it."
        : "Stop unlocked.",
    );
  }
  async function undo() {
    if (!history.length || flight.current) return;
    flight.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await api<Itinerary>(
        "hydrate",
        history[history.length - 1],
      );
      apply(result, false);
      setHistory((h) => h.slice(0, -1));
      setMessage("Previous plan restored.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  function reorder(from: number, to: number) {
    if (!plan || from === to || to < 0 || to >= plan.stops.length) return;
    const refs = PlanSpec.parse(plan).stops;
    const [ref] = refs.splice(from, 1);
    refs.splice(to, 0, ref);
    edit(refs);
  }
  async function fetchAlternatives(searchQuery: string) {
    if (!plan) return;
    discoveryRequest.current?.abort();
    const controller = new AbortController();
    discoveryRequest.current = controller;
    setExploreBusy(true);
    setExploreError("");
    try {
      const all = await api<CandidatePlace[]>(
        "explore",
        {
          request: plan.request,
          demo: plan.demo,
          query: searchQuery || undefined,
        },
        { signal: controller.signal },
      );
      if (!controller.signal.aborted && mounted.current) {
        const available = all.filter(
          (p) => !plan.stops.some((s) => s.placeId === p.id),
        );
        setAlternatives(available);
        setAlternativeSelected(available[0]?.id ?? "");
      }
    } catch (error) {
      if (!controller.signal.aborted && mounted.current)
        setExploreError((error as Error).message);
    } finally {
      if (!controller.signal.aborted && mounted.current) setExploreBusy(false);
    }
  }
  async function discover(placeId?: string) {
    setReplace(placeId);
    setExplore(true);
    setQuery("");
    setAlternatives([]);
    await fetchAlternatives("");
  }
  async function search(value = query) {
    await fetchAlternatives(value);
  }
  function selectAlternative(placeId: string) {
    setAlternativeSelected(placeId);
    document.getElementById(`alternative-${placeId}`)?.scrollIntoView({
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
      block: "nearest",
    });
  }
  function closeDetails() {
    setDetails(undefined);
    if (detailsFromExplore) setExplore(true);
    setDetailsFromExplore(false);
  }
  function add(place: CandidatePlace) {
    if (!plan) return;
    const refs = PlanSpec.parse(plan).stops;
    const stop = {
      placeId: place.id,
      minutes: 45,
      locked: false,
      reason: "Added by you.",
    };
    if (replace) {
      const i = refs.findIndex((s) => s.placeId === replace);
      if (i >= 0) refs[i] = { ...stop, minutes: refs[i].minutes };
    } else refs.push(stop);
    edit(refs);
  }
  async function cloudSave() {
    if (!plan) return;
    setBusy(true);
    setError("");
    try {
      saveLocal(plan);
      await api("plans", PlanSpec.parse(plan));
      setMessage("Saved to your account and this device.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function share() {
    if (!plan) return;
    setBusy(true);
    setError("");
    try {
      await api("plans", PlanSpec.parse(plan));
      const result = await api<{ shareId: string }>("share", { id: plan.id });
      setShareId(result.shareId);
      setShareLink(`${window.location.origin}/s/${result.shareId}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function revoke() {
    setError("");
    try {
      await api(`shares/${shareId}`, undefined, { method: "DELETE" });
      setShareLink("");
      setShareId("");
      setMessage("Public link revoked.");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function duplicate() {
    if (!plan) return;
    const copy = {
      ...plan,
      id: crypto.randomUUID(),
      title: `${plan.title} · your copy`,
    };
    saveLocal(copy);
    router.push(`/plan/${copy.id}`);
  }
  async function rememberDislike(place: CandidatePlace) {
    try {
      const previous = JSON.parse(
        localStorage.getItem("whimway:preferences") ?? "{}",
      );
      const prefs = {
        enabled: true,
        interests: [],
        dietary: "",
        accessibility: "",
        mode: "WALK",
        budget: 65,
        cuisines: "",
        atmosphere: "",
        disliked: [],
        ...previous,
      };
      prefs.enabled = true;
      prefs.disliked = [...new Set([...prefs.disliked, place.id])].slice(-100);
      localStorage.setItem("whimway:preferences", JSON.stringify(prefs));
      localStorage.setItem("whimway:preferences:dirty", "skips");
      setMessage(
        "Preference saved: future plans will skip this place. Personalization is enabled on this device.",
      );
      setAlternatives((items) => items.filter((p) => p.id !== place.id));
      closeDetails();
    } catch {
      setError("This browser could not save your preference.");
    }
  }
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareLink);
      setMessage("Link copied.");
    } catch {
      setMessage("Copy the link from the field below.");
    }
  }
  if (loading)
    return (
      <div className="wrap plan-loading">
        <div className="eyebrow">BRINGING YOUR DAY TOGETHER</div>
        <h1>
          A good day is worth
          <br />a little <span className="serif">anticipation.</span>
        </h1>
        <div className="skeleton" />
        <div className="skeleton" />
        <p>Refreshing venue details and routes…</p>
      </div>
    );
  if (!plan)
    return (
      <div className="wrap">
        <Empty
          title="Let’s get you back on track."
          text={error || "This itinerary is unavailable."}
        >
          <Button onClick={() => void load()}>Try again</Button>
          <Link className="button primary" href="/create">
            Plan a new outing
          </Link>
        </Empty>
      </div>
    );
  const zone = plan.request.location.timezone;
  const cost = plan.cost;
  const navUrl = navigationUrl(plan);
  return (
    <div className={`plan-page ${view === "map" ? "map-focused" : ""}`}>
      <div className="wrap plan-top">
        <Link href={shared ? "/" : "/saved"} className="back-link">
          <ArrowLeft size={16} />
          {shared ? "Explore Whimway" : "Your outings"}
        </Link>
        <div className="plan-title-row">
          <div>
            <div className="eyebrow">
              {shared ? "A DAY WORTH SHARING" : "YOUR LITTLE ADVENTURE"}
            </div>
            <h1>{plan.title}</h1>
            <p>
              <MapPin size={15} />
              {plan.request.location.name}
              <span>·</span>
              {DateTime.fromISO(plan.request.date, { zone }).toLocaleString(
                DateTime.DATE_MED,
              )}
            </p>
          </div>
          <div className="plan-actions">
            {shared ? (
              <Button className="primary" onClick={duplicate}>
                <Copy size={17} />
                Make it yours
              </Button>
            ) : (
              <>
                <Button
                  className="secondary"
                  disabled={busy}
                  onClick={cloudSave}
                >
                  <Bookmark size={17} />
                  Save to account
                </Button>
                <Button
                  className="primary"
                  disabled={busy || plan.demo}
                  onClick={share}
                >
                  <Share2 size={17} />
                  Share
                </Button>
              </>
            )}
          </div>
        </div>
        <div className="plan-summary">
          <span>
            <Clock size={16} />
            {Math.floor(plan.totalMinutes / 60)}h {plan.totalMinutes % 60}m
            <span className="summary-light">
              {" "}
              / {plan.request.duration / 60}h window
            </span>
          </span>
          <span>
            {plan.request.mode === "WALK" ? (
              <Footprints size={17} />
            ) : (
              <Car size={17} />
            )}{" "}
            {(plan.totalMeters / 1000).toFixed(1)} km{" "}
            {plan.request.mode === "WALK" ? "walking" : "driving"}
          </span>
          <span>
            <Users size={16} />
            {plan.request.participants}{" "}
            {plan.request.participants === 1 ? "person" : "people"}
          </span>
          <span className="cost-summary">
            {money(cost.low, cost.currency)}
            {cost.high !== cost.low
              ? `–${money(cost.high, cost.currency)}`
              : ""}
            <span className="summary-light">
              {" "}
              / person{cost.unknown ? " + unknown costs" : ""}
            </span>
          </span>
        </div>
        {plan.request.participants > 1 ? (
          <p className="group-cost">
            Known group range:{" "}
            {money(cost.low * plan.request.participants, cost.currency)}
            {cost.high !== cost.low
              ? `–${money(cost.high * plan.request.participants, cost.currency)}`
              : ""}
            . Optional purchases and transport extra.
          </p>
        ) : null}
        {plan.demo ? (
          <Notice>
            Development fixture: synthetic venue data, prices, hours and map. No
            live-provider verification.
          </Notice>
        ) : null}
        {shared ? (
          <Notice>
            Read-only shared copy. Private requirements and route anchors are
            removed; the map centre comes from the public stops.
          </Notice>
        ) : null}
        {error ? <Notice error>{error}</Notice> : null}
        {message ? (
          <p className="success-message" role="status">
            {message}
          </p>
        ) : null}
        {plan.issues.length ? (
          <details className="plan-cautions">
            <summary>
              {plan.issues.length} things to check before you go
              <ChevronRight size={16} />
            </summary>
            {plan.issues.map((i, index) => (
              <p key={index}>{i.message}</p>
            ))}
          </details>
        ) : null}
      </div>
      <div className="mobile-view-switch">
        <button
          className={view === "list" ? "active" : ""}
          onClick={() => {
            setView("list");
            setSheetHeight(88);
          }}
        >
          <List size={17} />
          Your day
        </button>
        <button
          className={view === "map" ? "active" : ""}
          onClick={() => {
            setView("map");
            setSheetHeight(40);
          }}
        >
          <MapIcon size={17} />
          Map
        </button>
      </div>
      <div className="wrap itinerary-layout">
        <section
          className="itinerary-sheet"
          style={
            { "--sheet-height": `${sheetHeight}vh` } as React.CSSProperties
          }
        >
          <div
            className="sheet-handle"
            role="slider"
            aria-orientation="vertical"
            tabIndex={0}
            aria-label="Itinerary sheet height"
            aria-valuemin={25}
            aria-valuemax={88}
            aria-valuenow={sheetHeight}
            onPointerDown={(e) => {
              dragStart.current = { y: e.clientY, height: sheetHeight };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (dragStart.current)
                setSheetHeight(
                  Math.max(
                    25,
                    Math.min(
                      88,
                      dragStart.current.height +
                        ((dragStart.current.y - e.clientY) /
                          window.innerHeight) *
                          100,
                    ),
                  ),
                );
            }}
            onPointerUp={() => {
              dragStart.current = null;
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp")
                setSheetHeight((h) => Math.min(88, h + 10));
              if (e.key === "ArrowDown")
                setSheetHeight((h) => Math.max(25, h - 10));
            }}
          >
            <span />
          </div>
          <div className="timeline-toolbar">
            <h2>
              Your day, <span className="serif">unfolded.</span>
            </h2>
            {!shared ? (
              <div>
                <button
                  className="icon-button"
                  aria-label="Undo last change"
                  title="Undo"
                  disabled={busy || !history.length}
                  onClick={undo}
                >
                  <Undo2 size={19} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Adjust plan constraints"
                  title="Adjust"
                  disabled={busy}
                  onClick={() => {
                    setError("");
                    setAdjust(true);
                  }}
                >
                  <SlidersHorizontal size={19} />
                </button>
              </div>
            ) : null}
          </div>
          <p className="plan-rationale">{plan.summary}</p>
          {!plan.request.start ? (
            <p className="start-note">
              Starts at the first stop · travel from your location is not
              included
            </p>
          ) : null}
          <div className="timeline">
            {plan.stops.map((stop, i) => (
              <div
                key={stop.placeId}
                className="timeline-item"
                id={`stop-${stop.placeId}`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (drag.current !== null && !shared && !busy)
                    reorder(drag.current, i);
                  drag.current = null;
                }}
              >
                {i > 0 ? (
                  <div className="travel-between">
                    <Footprints size={13} />
                    {stop.travel} min{" "}
                    {plan.request.mode === "WALK" ? "walk" : "drive"}
                    {plan.demo ? " · fixture estimate" : ""}
                  </div>
                ) : null}
                <div className="timeline-number">{i + 1}</div>
                <article
                  className={`stop-card ${selected === stop.placeId ? "selected" : ""}`}
                  onClick={() => setSelected(stop.placeId)}
                >
                  <PlacePhoto place={stop.place} demo={plan.demo} />
                  <div className="stop-content">
                    <div className="stop-time">
                      <Clock size={13} />
                      {timeLabel(stop.arrival, zone)}–
                      {timeLabel(stop.departure, zone)}
                      <span>{stop.minutes} min</span>
                    </div>
                    <div className="stop-heading">
                      <h3>
                        <button
                          onClick={() => {
                            select(stop.placeId);
                            setDetails(stop.place);
                          }}
                        >
                          {stop.place.name}
                        </button>
                      </h3>
                      {stop.locked ? (
                        <LockKeyhole
                          size={16}
                          className="locked-indicator"
                          aria-label="Locked"
                        />
                      ) : null}
                    </div>
                    <p className="stop-category">
                      {stop.place.category}
                      {stop.place.rating ? (
                        <span>
                          <Star size={12} />
                          {stop.place.rating}{" "}
                          <small>
                            (
                            {stop.place.reviews?.toLocaleString() ??
                              "unknown count"}
                            ) · Google Maps{plan.demo ? " fixture" : ""}
                          </small>
                        </span>
                      ) : null}
                    </p>
                    <p className="stop-reason">{stop.reason}</p>
                    <div className="stop-cost">
                      {stop.place.price.high === null
                        ? "Price not available"
                        : stop.place.price.source === "free-browse"
                          ? "Browsing / outdoor estimate: free"
                          : `${money(stop.place.price.low!, cost.currency)}–${money(stop.place.price.high, cost.currency)} · published range`}
                      {stop.place.price.optional ? (
                        <small>Purchases or special admission extra</small>
                      ) : null}
                    </div>
                    <p className="hours-label">{stop.hoursStatus}</p>
                    <div className="stop-controls">
                      <button
                        className="text-link"
                        onClick={() => setDetails(stop.place)}
                      >
                        Details
                        <ArrowUpRight size={14} />
                      </button>
                      {!shared ? (
                        <>
                          <div className="stop-edit-actions">
                            <button
                              className="icon-button"
                              aria-label={`${stop.locked ? "Unlock" : "Lock"} ${stop.place.name}`}
                              title={stop.locked ? "Unlock stop" : "Lock stop"}
                              disabled={busy}
                              onClick={() => lock(stop.placeId)}
                            >
                              {stop.locked ? (
                                <LockKeyhole size={16} />
                              ) : (
                                <LockKeyholeOpen size={16} />
                              )}
                            </button>
                            <button
                              className="icon-button"
                              aria-label={`Replace ${stop.place.name}`}
                              title="Replace"
                              disabled={busy || stop.locked}
                              onClick={() => void discover(stop.placeId)}
                            >
                              <RefreshCw size={16} />
                            </button>
                            <button
                              className="icon-button"
                              aria-label={`Remove ${stop.place.name}`}
                              title="Remove"
                              disabled={
                                busy || stop.locked || plan.stops.length === 1
                              }
                              onClick={() =>
                                edit(
                                  PlanSpec.parse(plan).stops.filter(
                                    (s) => s.placeId !== stop.placeId,
                                  ),
                                )
                              }
                            >
                              <Trash2 size={16} />
                            </button>
                            <span className="control-divider" />
                            <button
                              className="icon-button reorder-button"
                              aria-label={`Move ${stop.place.name} up`}
                              disabled={busy || i === 0}
                              onClick={() => reorder(i, i - 1)}
                            >
                              <ArrowUp size={15} />
                            </button>
                            <button
                              className="icon-button reorder-button"
                              aria-label={`Move ${stop.place.name} down`}
                              disabled={busy || i === plan.stops.length - 1}
                              onClick={() => reorder(i, i + 1)}
                            >
                              <ArrowDown size={15} />
                            </button>
                            <span
                              className="drag-grip"
                              draggable={!busy}
                              onDragStart={() => {
                                drag.current = i;
                              }}
                              title="Drag to reorder"
                            >
                              <GripVertical size={16} />
                            </span>
                          </div>
                        </>
                      ) : null}
                    </div>
                    {!shared ? (
                      <details className="stop-duration">
                        <summary>Edit visit duration</summary>
                        <label>
                          Minutes
                          <input
                            aria-label={`Visit duration for ${stop.place.name}`}
                            type="number"
                            min="15"
                            max="240"
                            defaultValue={stop.minutes}
                            disabled={busy || stop.locked}
                            onBlur={(e) => {
                              const minutes = Number(e.target.value);
                              if (
                                minutes !== stop.minutes &&
                                minutes >= 15 &&
                                minutes <= 240
                              )
                                edit(
                                  PlanSpec.parse(plan).stops.map((s) =>
                                    s.placeId === stop.placeId
                                      ? { ...s, minutes }
                                      : s,
                                  ),
                                );
                            }}
                          />
                        </label>
                      </details>
                    ) : null}
                  </div>
                </article>
              </div>
            ))}
          </div>
          {!shared ? (
            <>
              <Button
                className="add-stop secondary"
                disabled={busy || plan.stops.length >= 8}
                onClick={() => void discover()}
              >
                <Plus size={18} />
                Add a little something
              </Button>
              <div className="remix-panel">
                <div>
                  <span className="remix-icon">
                    <Sparkles size={21} />
                  </span>
                  <h3>
                    Same day. <span className="serif">New possibilities.</span>
                  </h3>
                </div>
                <p>Keep what you love. Give the rest a little twist.</p>
                <div className="remix-chips">
                  {remixActions.map((action) => (
                    <button
                      disabled={busy || plan.stops.every((s) => s.locked)}
                      key={action}
                      onClick={() =>
                        void change("remix", {
                          spec: PlanSpec.parse(plan),
                          action,
                        })
                      }
                    >
                      {action}
                      <Sparkles size={12} />
                    </button>
                  ))}
                </div>
                {plan.stops.every((s) => s.locked) ? (
                  <p className="form-hint">
                    Unlock a stop to remix this outing.
                  </p>
                ) : null}
              </div>
              <p className="form-hint centered">
                Changes save on this device. Account copies update when you
                choose Save.
              </p>
            </>
          ) : null}
          {busy ? (
            <div className="editing-progress" role="status">
              <span className="small-spinner" />
              Checking your changes and recalculating…
              <button
                onClick={() => request.current?.abort()}
                className="text-link"
              >
                Cancel
              </button>
            </div>
          ) : null}
        </section>
        <aside className="itinerary-map">
          <MapPanel
            center={plan.request.area.center}
            radius={plan.request.area.radius}
            places={plan.stops.map((s) => s.place)}
            legs={plan.legs}
            selected={selected}
            onSelect={select}
            demo={plan.demo}
            locked={plan.request.area.locked}
          />
          <div className="map-footer">
            <span>
              <span className="radius-dot" />
              {plan.request.area.locked
                ? "Area Lock on"
                : "Exploration area"} · {plan.request.area.radius / 1000} km
            </span>
            {navUrl ? <External href={navUrl}>Open navigation</External> : null}
          </div>
          <p className="map-disclaimer">
            {plan.demo
              ? "Synthetic layout. Test travel estimates are not directions."
              : "Routes by Google Maps. Walking routes may be missing sidewalks. Check conditions before setting out."}
          </p>
        </aside>
      </div>
      <Modal
        open={Boolean(details)}
        onClose={closeDetails}
        title={details?.name ?? "Place details"}
      >
        {details ? (
          <div className="place-details">
            <PlacePhoto place={details} demo={plan.demo} />
            <p>
              <MapPin size={16} />
              {details.address}
            </p>
            <p className="muted">
              {details.category} · Venue information from Google Maps
              {plan.demo ? " test fixture" : ""}
            </p>
            {details.hours.length ? (
              <>
                <h3>Published hours</h3>
                {details.hours.map((h) => (
                  <p className="detail-hour" key={h}>
                    {h}
                  </p>
                ))}
              </>
            ) : (
              <p>Hours are unavailable. Check with the venue.</p>
            )}
            <p className="form-hint">
              Special dates, admission and reservations are not confirmed.
            </p>
            <div className="detail-links">
              <External href={details.mapsUrl}>Google Maps</External>
              {details.website ? (
                <External href={details.website}>Venue website</External>
              ) : null}
            </div>
            {detailsFromExplore ? (
              <Button
                className="primary"
                disabled={busy}
                onClick={() => {
                  setDetails(undefined);
                  setExplore(true);
                  add(details);
                }}
              >
                <Plus size={16} />
                {replace ? "Replace this stop" : "Add to my outing"}
              </Button>
            ) : null}
            {!shared ? (
              <div className="remember-place">
                <Button
                  className="secondary"
                  onClick={() => void rememberDislike(details)}
                >
                  Remember: skip this place
                </Button>
                <p className="form-hint">
                  Enables personalization and saves a preference on this device.
                  Reset it in Profile.
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
      <Modal
        open={explore}
        onClose={() => {
          if (!busy) {
            discoveryRequest.current?.abort();
            setExplore(false);
          }
        }}
        title={replace ? "A fresh little alternative." : "What else is around?"}
        description={
          plan.demo
            ? "Synthetic preview candidates. Adding or replacing recalculates the full schedule."
            : "Real candidates in your area. Adding or replacing recalculates the full schedule."
        }
      >
        <div className="explore-search">
          <input
            aria-label="Search activities in area"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="A café, gallery, park…"
            onKeyDown={(e) => e.key === "Enter" && void search()}
          />
          <Button busy={exploreBusy} onClick={() => void search()}>
            Search
          </Button>
        </div>
        <div className="explore-categories">
          {["cafe", "park", "museum", "shopping"].map((c) => (
            <button
              key={c}
              aria-pressed={query === c}
              onClick={() => {
                setQuery(c);
                void search(c);
              }}
            >
              {c}
            </button>
          ))}
        </div>
        {exploreError ? <Notice error>{exploreError}</Notice> : null}
        {busy ? (
          <div className="notice" role="status">
            Checking this stop and recalculating…
            <button
              className="text-link"
              onClick={() => request.current?.abort()}
            >
              Cancel
            </button>
          </div>
        ) : null}
        {alternatives.length && !exploreBusy ? (
          <div className="explore-map">
            <MapPanel
              center={plan.request.area.center}
              radius={plan.request.area.radius}
              places={alternatives}
              selected={alternativeSelected}
              onSelect={selectAlternative}
              demo={plan.demo}
              locked={plan.request.area.locked}
            />
          </div>
        ) : null}
        {exploreBusy ? (
          <p role="status">Searching the area…</p>
        ) : alternatives.length ? (
          alternatives.map((p) => (
            <div
              className={`alternative-card ${alternativeSelected === p.id ? "selected" : ""}`}
              key={p.id}
              id={`alternative-${p.id}`}
            >
              <div className="alternative-photo">
                <PlacePhoto place={p} demo={plan.demo} />
              </div>
              <div className="alternative-copy">
                <h3>
                  <button
                    className="alternative-title"
                    onClick={() => {
                      setExplore(false);
                      setDetailsFromExplore(true);
                      setDetails(p);
                    }}
                  >
                    {p.name}
                  </button>
                </h3>
                <p>{p.category}</p>
                <p>
                  {p.price.high === null
                    ? "Price not available"
                    : p.price.source === "free-browse"
                      ? "Browsing estimate: free"
                      : `${money(p.price.low!, p.price.currency)}–${money(p.price.high, p.price.currency)} · published range`}
                </p>
              </div>
              <Button disabled={busy} onClick={() => add(p)}>
                <Plus size={16} />
                {replace ? "Replace" : "Add"}
              </Button>
            </div>
          ))
        ) : (
          <Empty
            title="No alternatives yet."
            text="Try a different category or expand the area. We’ll keep every stop inside Area Lock."
          />
        )}
      </Modal>
      <Modal
        open={adjust}
        onClose={() => {
          if (!busy) setAdjust(false);
        }}
        title="A few little adjustments."
      >
        {error ? <Notice error>{error}</Notice> : null}
        {adjust ? (
          <AdjustForm
            request={plan.request}
            busy={busy}
            onSubmit={(req) => edit(PlanSpec.parse(plan).stops, req)}
          />
        ) : null}
      </Modal>
      <Modal
        open={Boolean(shareLink)}
        onClose={() => setShareLink("")}
        title="Good days are better shared."
        description="This public copy is read-only. Anyone with the link can see the stops, date and times."
      >
        <label className="input-label">
          Public link
          <input
            className="share-link"
            value={shareLink}
            readOnly
            onFocus={(e) => e.target.select()}
          />
        </label>
        <div className="share-actions">
          <Button className="primary" onClick={copyLink}>
            <Copy size={17} />
            Copy link
          </Button>
          <Button className="secondary" onClick={revoke}>
            Revoke this link
          </Button>
        </div>
        <p className="form-hint">
          Private prompts, accessibility and dietary needs, and start/end
          anchors are removed. The map centre comes from the public stops.
          Changes to your private plan do not change this copy.
        </p>
      </Modal>
    </div>
  );
}
function AdjustForm({
  request,
  busy,
  onSubmit,
}: {
  request: PlanRequest;
  busy: boolean;
  onSubmit: (req: PlanRequest) => void;
}) {
  const [req, setReq] = useState(request);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(req);
      }}
    >
      <div className="form-grid">
        <label>
          Date
          <input
            type="date"
            value={req.date}
            onChange={(e) => setReq({ ...req, date: e.target.value })}
          />
        </label>
        <label>
          Start time
          <input
            type="time"
            value={req.startTime}
            onChange={(e) => setReq({ ...req, startTime: e.target.value })}
          />
        </label>
        <label>
          Duration (minutes)
          <input
            type="number"
            min="60"
            max="720"
            value={req.duration}
            onChange={(e) =>
              setReq({ ...req, duration: Number(e.target.value) })
            }
          />
        </label>
        <label>
          Budget / person
          <input
            type="number"
            min="0"
            value={req.budget}
            onChange={(e) => setReq({ ...req, budget: Number(e.target.value) })}
          />
        </label>
        <label>
          Transport
          <select
            value={req.mode}
            onChange={(e) =>
              setReq({ ...req, mode: e.target.value as "WALK" | "DRIVE" })
            }
          >
            <option value="WALK">Walking</option>
            <option value="DRIVE">Driving</option>
          </select>
        </label>
        <label>
          Radius (metres)
          <input
            type="number"
            min="100"
            max="20000"
            value={req.area.radius}
            onChange={(e) =>
              setReq({
                ...req,
                area: { ...req.area, radius: Number(e.target.value) },
              })
            }
          />
        </label>
      </div>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={req.area.locked}
          onChange={(e) =>
            setReq({ ...req, area: { ...req.area, locked: e.target.checked } })
          }
        />
        Area Lock: keep every stop inside this circle
      </label>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={req.hardBudget}
          onChange={(e) => setReq({ ...req, hardBudget: e.target.checked })}
        />
        Hard budget ceiling
      </label>
      <p className="form-hint">
        Locked stops keep their venues and visit durations. If they do not fit
        the new constraints, the change is rejected.
      </p>
      <Button type="submit" className="primary" busy={busy}>
        Update my day
        <ArrowUpRight size={17} />
      </Button>
    </form>
  );
}
