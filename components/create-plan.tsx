"use client";
import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { DateTime } from "luxon";
import {
  ArrowLeft,
  Sparkles,
  LockKeyhole,
  ChevronDown,
  Clock,
  MapPin,
  Navigation,
  X,
} from "lucide-react";
import {
  PlanRequest,
  interests,
  type Location,
  type Itinerary,
} from "@/lib/schema";
import { LocationSearch } from "./location-search";
import { MapPanel } from "./map";
import { Button, Notice } from "./ui";
import { api, type Status } from "@/lib/client";
import { saveLocal } from "@/lib/storage";
export function CreatePlan({ currencies }: { currencies: string[] }) {
  const router = useRouter();
  const [location, setLocation] = useState<Location>();
  const [prompt, setPrompt] = useState("");
  const [selected, setSelected] = useState<string[]>(["Surprise me"]);
  const [radius, setRadius] = useState(2000);
  const [locked, setLocked] = useState(true);
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("12:00");
  const [duration, setDuration] = useState(240);
  const [budget, setBudget] = useState(65);
  const [participants, setParticipants] = useState(2);
  const [mode, setMode] = useState<"WALK" | "DRIVE">("WALK");
  const [hardBudget, setHardBudget] = useState(false);
  const [dietary, setDietary] = useState("");
  const [accessibility, setAccessibility] = useState("");
  const [excluded, setExcluded] = useState<string[]>([]);
  const [start, setStart] = useState<Location>();
  const [end, setEnd] = useState<Location>();
  const [status, setStatus] = useState<Status>();
  const [demo, setDemo] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const active = useRef<AbortController | null>(null);
  const flight = useRef(false);
  useEffect(() => {
    api<Status>("status")
      .then(setStatus)
      .catch(() => {});
    try {
      const draft = JSON.parse(
        sessionStorage.getItem("whimway:draft") ?? "null",
      );
      const entry = JSON.parse(
        sessionStorage.getItem("whimway:entry") ?? "null",
      );
      const d = entry ?? draft;
      if (d) {
        if (d.location) {
          setLocation(d.location);
          setDate(
            d.date ??
              DateTime.now()
                .setZone(d.location.timezone)
                .plus({ days: 1 })
                .toISODate()!,
          );
        }
        setPrompt(d.prompt ?? "");
        if (d.interest) setSelected([d.interest]);
        else if (d.interests) setSelected(d.interests);
        setDemo(d.demo ?? false);
        if (d.area) {
          setRadius(d.area.radius);
          setLocked(d.area.locked);
        }
        if (d.duration) setDuration(d.duration);
        if (d.budget !== undefined) setBudget(d.budget);
        if (d.participants) setParticipants(d.participants);
        if (d.mode) setMode(d.mode);
        if (d.startTime) setStartTime(d.startTime);
        if (d.hardBudget) setHardBudget(d.hardBudget);
        setExcluded(d.excludedPlaceIds ?? []);
        if (d.start)
          setStart({ ...d.location, center: d.start, name: "Starting point" });
        if (d.end)
          setEnd({ ...d.location, center: d.end, name: "Ending point" });
        setDietary(d.dietary ?? "");
        setAccessibility(d.accessibility ?? "");
      } else {
        const prefs = JSON.parse(
          localStorage.getItem("whimway:preferences") ?? "null",
        );
        if (prefs?.enabled) {
          setSelected(
            prefs.interests?.length ? prefs.interests : ["Surprise me"],
          );
          setDietary(prefs.dietary ?? "");
          setAccessibility(prefs.accessibility ?? "");
          setMode(prefs.mode ?? "WALK");
          setBudget(prefs.budget ?? 65);
          setExcluded(prefs.disliked ?? []);
          setPrompt(
            [
              prefs.cuisines ? `Preferred cuisines: ${prefs.cuisines}.` : "",
              prefs.atmosphere
                ? `Preferred atmosphere: ${prefs.atmosphere}.`
                : "",
            ]
              .filter(Boolean)
              .join(" "),
          );
        }
      }
      sessionStorage.removeItem("whimway:entry");
    } catch {}
    setLoaded(true);
    return () => active.current?.abort();
  }, []);
  useEffect(() => {
    if (loaded)
      sessionStorage.setItem(
        "whimway:draft",
        JSON.stringify({
          location,
          prompt,
          interests: selected,
          area: { radius, locked },
          date,
          startTime,
          duration,
          budget,
          participants,
          mode,
          hardBudget,
          dietary,
          accessibility,
          demo,
          start: start?.center,
          end: end?.center,
          excludedPlaceIds: excluded,
        }),
      );
  }, [
    loaded,
    location,
    prompt,
    selected,
    radius,
    locked,
    date,
    startTime,
    duration,
    budget,
    participants,
    mode,
    hardBudget,
    dietary,
    accessibility,
    demo,
    start,
    end,
    excluded,
  ]);
  useEffect(() => {
    if (flight.current)
      active.current?.abort(new DOMException("choices-changed", "AbortError"));
  }, [
    location,
    prompt,
    selected,
    radius,
    locked,
    date,
    startTime,
    duration,
    budget,
    participants,
    mode,
    hardBudget,
    dietary,
    accessibility,
    start,
    end,
    demo,
    excluded,
  ]);
  function choose(value: Location | undefined) {
    setLocation(value);
    if (!value) return;
    setDate(
      DateTime.now().setZone(value.timezone).plus({ days: 1 }).toISODate()!,
    );
  }
  async function pin(point: { lat: number; lng: number }) {
    try {
      choose(await api<Location>("point", point));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function generate(e: React.FormEvent) {
    e.preventDefault();
    if (flight.current) return;
    setError("");
    if (!location) {
      setError("Select an area from the location search first.");
      return;
    }
    let disliked = excluded;
    try {
      const prefs = JSON.parse(
        localStorage.getItem("whimway:preferences") ?? "{}",
      );
      if (prefs.enabled)
        disliked = [...new Set([...excluded, ...(prefs.disliked ?? [])])];
    } catch {}
    const parse = PlanRequest.safeParse({
      location,
      area: { center: location.center, radius, locked },
      prompt,
      interests: selected,
      date,
      startTime,
      duration,
      budget,
      hardBudget,
      participants,
      mode,
      dietary,
      accessibility,
      excludedPlaceIds: disliked,
      start: start?.center,
      end: end?.center,
    });
    if (!parse.success) {
      setError("Check your date, time, budget and selected interests.");
      return;
    }
    flight.current = true;
    setBusy(true);
    active.current = new AbortController();
    try {
      const plan = await api<Itinerary>(
        "generate",
        { request: parse.data, demo },
        { signal: active.current.signal },
      );
      if (active.current.signal.aborted) return;
      saveLocal(plan);
      router.push(`/plan/${plan.id}`);
    } catch (e) {
      setError(
        active.current?.signal.reason?.message === "choices-changed"
          ? "Your choices changed. Generate again to use the updated details."
          : (e as Error).message,
      );
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  const center = location?.center ?? { lat: 43.6544, lng: -79.3807 };
  return (
    <div className="wrap create-page">
      <Link className="back-link" href="/">
        <ArrowLeft size={16} />
        Back to exploring
      </Link>
      <div className="create-heading">
        <div className="eyebrow">YOUR PLACE. YOUR PACE.</div>
        <h1>
          What kind of day
          <br />
          are we <span className="serif">dreaming up?</span>
        </h1>
        <p>A few details. A whole lot of possibilities.</p>
      </div>
      <form className="create-layout" onSubmit={generate}>
        <div className="create-form">
          <section className="form-section">
            <div className="step-heading">
              <span>01</span>
              <h2>Pick your patch of the world.</h2>
            </div>
            <label className="input-label">Exploration centre</label>
            <LocationSearch value={location} onChange={choose} demo={demo} />
            {location ? (
              <div className="location-confirm">
                <MapPin size={14} />
                {location.name}
                <span>{location.timezone.replaceAll("_", " ")}</span>
              </div>
            ) : null}
            <div className="radius-row">
              <label htmlFor="radius">How far shall we wander?</label>
              <strong>
                {radius >= 1000 ? `${radius / 1000} km` : `${radius} m`}
              </strong>
            </div>
            <input
              id="radius"
              type="range"
              min="100"
              max="10000"
              step="100"
              value={radius}
              onChange={(e) => setRadius(Number(e.target.value))}
            />
            <div className="radius-presets">
              {[500, 1000, 2000, 5000, 10000].map((n) => (
                <button
                  className={radius === n ? "selected" : ""}
                  type="button"
                  key={n}
                  onClick={() => setRadius(n)}
                >
                  {n < 1000 ? `${n} m` : `${n / 1000} km`}
                </button>
              ))}
            </div>
            <label className="switch-row">
              <span>
                <LockKeyhole size={17} />
                <strong>Area Lock</strong>
                <small>Keep every stop inside your circle.</small>
              </span>
              <input
                type="checkbox"
                checked={locked}
                onChange={(e) => setLocked(e.target.checked)}
              />
            </label>
          </section>
          <section className="form-section">
            <div className="step-heading">
              <span>02</span>
              <h2>Tell us your kind of good.</h2>
            </div>
            <textarea
              aria-label="Describe your plan"
              placeholder="A relaxed afternoon with good coffee, a little art, and a few unexpected finds…"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              maxLength={1500}
              rows={3}
            />
            <div className="interest-chips">
              {interests.map((i, index) => (
                <button
                  type="button"
                  key={i}
                  aria-pressed={selected.includes(i)}
                  className={selected.includes(i) ? "selected" : ""}
                  onClick={() =>
                    setSelected((s) =>
                      s.includes(i)
                        ? s.filter((x) => x !== i)
                        : [...s.filter((x) => x !== "Surprise me"), i],
                    )
                  }
                >
                  <span>
                    {["◒", "◇", "✳", "♧", "◈", "☼", "☾", "☺", "✧", "✦"][index]}
                  </span>
                  {i}
                </button>
              ))}
            </div>
          </section>
          <section className="form-section">
            <div className="step-heading">
              <span>03</span>
              <h2>Make it fit your day.</h2>
            </div>
            <div className="form-grid">
              <label>
                Date
                <input
                  required
                  aria-label="Outing date"
                  type="date"
                  min={DateTime.now()
                    .setZone(location?.timezone ?? "UTC")
                    .toISODate()!}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
              <label>
                Start time
                <input
                  required
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </label>
              <label>
                Time to explore
                <select
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                >
                  {[60, 120, 180, 240, 300, 360, 480, 600, 720].map((n) => (
                    <option value={n} key={n}>
                      {n / 60} {n === 60 ? "hour" : "hours"}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                People
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={participants}
                  onChange={(e) => setParticipants(Number(e.target.value))}
                />
              </label>
              <label>
                Budget / person ({location?.currency ?? "select area"})
                <input
                  type="number"
                  min="0"
                  max="1000000"
                  value={budget}
                  onChange={(e) => setBudget(Number(e.target.value))}
                />
              </label>
              <label>
                Getting around
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as "WALK" | "DRIVE")}
                >
                  <option value="WALK">Walking</option>
                  <option value="DRIVE">Driving</option>
                </select>
              </label>
            </div>
            <p className="form-hint">
              <Clock size={13} />
              Times use{" "}
              {location?.timezone.replaceAll("_", " ") ??
                "the selected area’s timezone"}
              . Defaults are yours to change.
            </p>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={hardBudget}
                onChange={(e) => setHardBudget(e.target.checked)}
              />
              Use a hard ceiling: exclude unknown-cost activities
            </label>
            <details className="more-options">
              <summary>
                Anything else we should know?
                <ChevronDown size={17} />
              </summary>
              <div className="form-grid">
                <label>
                  Dietary requirements
                  <input
                    value={dietary}
                    maxLength={300}
                    onChange={(e) => setDietary(e.target.value)}
                    placeholder="e.g. vegetarian"
                  />
                </label>
                <label>
                  Accessibility needs
                  <input
                    value={accessibility}
                    maxLength={300}
                    onChange={(e) => setAccessibility(e.target.value)}
                    placeholder="e.g. step-free entry"
                  />
                </label>
                <label>
                  Currency
                  <select
                    value={location?.currency ?? "CAD"}
                    disabled={!location}
                    onChange={(e) =>
                      location &&
                      setLocation({ ...location, currency: e.target.value })
                    }
                  >
                    {currencies.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="input-label anchor-label">
                Optional starting point
              </label>
              <LocationSearch value={start} onChange={setStart} demo={demo} />
              {start ? (
                <button
                  className="text-link"
                  type="button"
                  onClick={() => setStart(undefined)}
                >
                  <X size={14} />
                  Clear starting point
                </button>
              ) : null}
              <label className="input-label anchor-label">
                Optional ending point
              </label>
              <LocationSearch value={end} onChange={setEnd} demo={demo} />
              {end ? (
                <button
                  className="text-link"
                  type="button"
                  onClick={() => setEnd(undefined)}
                >
                  <X size={14} />
                  Clear ending point
                </button>
              ) : null}
              <p className="form-hint">
                Without anchors, the route starts at your first stop. Travel
                from your current position is not included.
              </p>
            </details>
          </section>
          {status?.demo ? (
            <label className="demo-toggle">
              <input
                type="checkbox"
                checked={demo}
                onChange={(e) => setDemo(e.target.checked)}
              />
              Development preview: synthetic places, prices, hours and map
            </label>
          ) : null}
          {status && !demo && (!status.places || !status.ai) ? (
            <Notice>
              Live planning needs Google Places, Routes and OpenAI
              configuration. The integration is installed; provider access is
              not yet available.
            </Notice>
          ) : null}
          {error ? <Notice error>{error}</Notice> : null}
          <Button className="primary generate-button" type="submit" busy={busy}>
            {busy ? "Finding your kind of day…" : "Make my day"}
            {!busy ? <Sparkles size={19} /> : null}
          </Button>
          {busy ? (
            <div className="generation-status">
              <p>
                Retrieving places, selecting stops and checking the schedule.
                This can take a moment.
              </p>
              <button
                className="text-link"
                type="button"
                onClick={() => active.current?.abort()}
              >
                Cancel request
              </button>
            </div>
          ) : (
            <p className="form-hint centered">
              No account needed. Plans save on this device; clear them in
              Profile.
            </p>
          )}
        </div>
        <aside className="create-map">
          <MapPanel
            center={center}
            radius={radius}
            onPin={pin}
            demo={demo}
            locked={locked}
          />
          <div className="map-note">
            <span className="map-note-icon">
              <Navigation size={20} />
            </span>
            <div>
              <strong>A little circle of possibility.</strong>
              <p>
                {location
                  ? "Your area is set. Adjust the radius or drop a pin to explore somewhere else."
                  : "Search for an area to set your circle. Then make it as big or small as your day."}
              </p>
            </div>
          </div>
        </aside>
      </form>
    </div>
  );
}
