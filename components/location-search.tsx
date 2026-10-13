"use client";
import { useEffect, useRef, useState, useId } from "react";
import { Search, LocateFixed, MapPin, LoaderCircle, X } from "lucide-react";
import { api } from "@/lib/client";
import type { Location } from "@/lib/schema";
export function LocationSearch({
  value,
  onChange,
  demo = false,
}: {
  value?: Location;
  onChange: (v: Location | undefined) => void;
  demo?: boolean;
}) {
  const listId = useId();
  const [text, setText] = useState(value?.name ?? "");
  const [results, setResults] = useState<{ id: string; text: string }[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(-1);
  const session = useRef("");
  const sequence = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    session.current = crypto.randomUUID();
  }, []);
  useEffect(() => {
    if (value) setText(value.name);
  }, [value]);
  useEffect(() => {
    if (text.length < 2 || text === value?.name || !focused) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setBusy(true);
      setError("");
      api<{ id: string; text: string }[]>(
        `autocomplete?q=${encodeURIComponent(text)}&session=${session.current}&demo=${demo}`,
        undefined,
        { signal: controller.signal },
      )
        .then((data) => {
          setResults(data);
          setActive(-1);
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [text, value?.name, focused, demo]);
  async function select(id: string) {
    const current = ++sequence.current;
    setBusy(true);
    setResults([]);
    setFocused(false);
    try {
      const place = await api<Location>(
        `location?id=${encodeURIComponent(id)}&session=${session.current}&demo=${demo}`,
      );
      if (current === sequence.current) {
        onChange(place);
        setText(place.name);
        session.current = crypto.randomUUID();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function locate() {
    setError("");
    if (!navigator.geolocation) {
      setError(
        "This browser does not support location. Search for an area instead.",
      );
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const location = await api<Location>("point", {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          });
          onChange(location);
          setText(location.name);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      },
      () => {
        setError(
          "Location access was denied or unavailable. Search for a place instead.",
        );
        setBusy(false);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  }
  return (
    <div className="location-search">
      <div className="location-field">
        <Search size={19} />
        <input
          ref={input}
          role="combobox"
          aria-label="Search for an area"
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={focused && results.length > 0}
          aria-activedescendant={
            active >= 0 ? `${listId}-${active}` : undefined
          }
          placeholder="A neighbourhood, landmark, anywhere…"
          value={text}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          onChange={(e) => {
            setText(e.target.value);
            if (value) onChange(undefined);
            sequence.current++;
            setFocused(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, results.length - 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            }
            if (e.key === "Enter" && active >= 0 && results[active]) {
              e.preventDefault();
              void select(results[active].id);
            }
            if (e.key === "Escape") {
              setFocused(false);
            }
          }}
        />
        {busy ? (
          <LoaderCircle className="spin" size={18} />
        ) : text ? (
          <button
            type="button"
            className="icon-button"
            aria-label="Clear search"
            onClick={() => {
              setText("");
              onChange(undefined);
              sequence.current++;
              input.current?.focus();
            }}
          >
            <X size={16} />
          </button>
        ) : null}
        <button
          type="button"
          className="locate-button"
          onClick={locate}
          aria-label="Use my location"
          title="Use my location"
        >
          <LocateFixed size={20} />
        </button>
      </div>
      {focused && results.length > 0 ? (
        <ul id={listId} role="listbox" className="location-results">
          {results.map((r, i) => (
            <li
              key={r.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={active === i}
            >
              <button
                type="button"
                className={active === i ? "selected" : ""}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void select(r.id)}
              >
                <MapPin size={17} />
                {r.text}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      {focused &&
      !busy &&
      text.length >= 2 &&
      results.length === 0 &&
      !error &&
      text !== value?.name ? (
        <p className="search-hint">
          Search worldwide or use your location. Select a result to set the
          area.
        </p>
      ) : null}
    </div>
  );
}
