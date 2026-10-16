"use client";
import { useEffect, useRef, useState, useId } from "react";
import { Search, LocateFixed, MapPin, LoaderCircle, X } from "lucide-react";
import { api } from "@/lib/client";
import type { Location } from "@/lib/schema";
export function LocationSearch({
  value,
  onChange,
  onBusyChange,
  demo = false,
}: {
  value?: Location;
  onChange: (v: Location | undefined) => void;
  onBusyChange?: (busy: boolean) => void;
  demo?: boolean;
}) {
  const listId = useId();
  const [text, setText] = useState(value?.name ?? "");
  const [results, setResults] = useState<{ id: string; text: string }[]>([]);
  const [error, setError] = useState("");
  const [searchBusy, setSearchBusy] = useState(false);
  const [selectionBusy, setSelectionBusy] = useState(false);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(-1);
  const session = useRef("");
  const sequence = useRef(0);
  const selection = useRef<AbortController | null>(null);
  const busyCallback = useRef(onBusyChange);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    session.current = crypto.randomUUID();
  }, []);
  useEffect(() => {
    busyCallback.current = onBusyChange;
  }, [onBusyChange]);
  useEffect(
    () => () => {
      sequence.current++;
      selection.current?.abort();
      selection.current = null;
      setSelectionBusy(false);
      busyCallback.current?.(false);
    },
    [demo],
  );
  useEffect(() => {
    setSearchBusy(false);
    if (value) setText(value.name);
  }, [value]);
  useEffect(() => {
    if (text.length < 2 || text === value?.name || !focused) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearchBusy(true);
      setError("");
      api<{ id: string; text: string }[]>(
        `autocomplete?q=${encodeURIComponent(text)}&session=${session.current}&demo=${demo}`,
        undefined,
        { signal: controller.signal },
      )
        .then((data) => {
          if (controller.signal.aborted) return;
          setResults(data);
          setActive(-1);
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearchBusy(false);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
      setSearchBusy(false);
    };
  }, [text, value?.name, focused, demo]);
  function beginSelection() {
    selection.current?.abort();
    const controller = new AbortController();
    selection.current = controller;
    const current = ++sequence.current;
    setSelectionBusy(true);
    busyCallback.current?.(true);
    setError("");
    setResults([]);
    setFocused(false);
    return { current, controller };
  }
  function finishSelection(current: number) {
    if (current !== sequence.current) return;
    selection.current = null;
    setSelectionBusy(false);
    busyCallback.current?.(false);
  }
  function cancelSelection() {
    sequence.current++;
    selection.current?.abort();
    selection.current = null;
    setSelectionBusy(false);
    busyCallback.current?.(false);
  }
  async function select(id: string) {
    const { current, controller } = beginSelection();
    try {
      const place = await api<Location>(
        `location?id=${encodeURIComponent(id)}&session=${session.current}&demo=${demo}`,
        undefined,
        { signal: controller.signal },
      );
      if (current === sequence.current && !controller.signal.aborted) {
        onChange(place);
        setText(place.name);
        session.current = crypto.randomUUID();
      }
    } catch (e) {
      if (current === sequence.current && !controller.signal.aborted)
        setError((e as Error).message);
    } finally {
      finishSelection(current);
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
    const { current, controller } = beginSelection();
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        if (current !== sequence.current || controller.signal.aborted) return;
        try {
          const location = await api<Location>(
            "point",
            {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
            },
            { signal: controller.signal },
          );
          if (current === sequence.current && !controller.signal.aborted) {
            onChange(location);
            setText(location.name);
          }
        } catch (e) {
          if (current === sequence.current && !controller.signal.aborted)
            setError((e as Error).message);
        } finally {
          finishSelection(current);
        }
      },
      () => {
        if (current !== sequence.current || controller.signal.aborted) return;
        setError(
          "Location access was denied or unavailable. Search for a place instead.",
        );
        finishSelection(current);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  }
  const busy = searchBusy || selectionBusy;
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
            cancelSelection();
            setText(e.target.value);
            if (value) onChange(undefined);
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
              cancelSelection();
              setText("");
              onChange(undefined);
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
          disabled={selectionBusy}
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
