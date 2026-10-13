"use client";
import { useEffect, useRef, useState } from "react";
import { MapPin, Expand, Map as MapIcon } from "lucide-react";
import { decodePolyline } from "@/lib/geo";
import type { CandidatePlace, Point, TravelLeg } from "@/lib/schema";
let googleLoader: Promise<void> | undefined;
function loadGoogle() {
  if (window.google?.maps?.marker?.AdvancedMarkerElement)
    return Promise.resolve();
  if (window.google?.maps)
    return google.maps.importLibrary("marker").then(() => {});
  if (!googleLoader)
    googleLoader = new Promise((resolve, reject) => {
      const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
      if (!key) {
        reject(
          new Error(
            "Add the browser Google Maps key to see the interactive map.",
          ),
        );
        return;
      }
      const script = document.createElement("script");
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=marker&v=weekly&loading=async&callback=whimwayMapsReady`;
      (window as unknown as Record<string, unknown>).whimwayMapsReady = () =>
        resolve();
      script.onerror = () => {
        googleLoader = undefined;
        reject(
          new Error(
            "The map could not load. Check your connection and browser key restrictions.",
          ),
        );
      };
      document.head.appendChild(script);
    });
  return googleLoader;
}
export function MapPanel({
  center,
  radius,
  places = [],
  legs = [],
  selected,
  onSelect,
  onPin,
  demo = false,
  locked = true,
}: {
  center: Point;
  radius: number;
  places?: CandidatePlace[];
  legs?: TravelLeg[];
  selected?: string;
  onSelect?: (id: string) => void;
  onPin?: (p: Point) => void;
  demo?: boolean;
  locked?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const pinCallback = useRef(onPin);
  const shape = useRef("");
  const lastSelected = useRef<string | undefined>(undefined);
  useEffect(() => {
    pinCallback.current = onPin;
  }, [onPin]);
  useEffect(() => {
    let live = true;
    if (demo) {
      setError("");
      setReady(false);
      return;
    }
    const timer = setTimeout(() => {
      if (live)
        setError(
          "The map is taking too long to load. The itinerary is still available.",
        );
    }, 15000);
    loadGoogle()
      .then(() => {
        if (live && container.current) {
          clearTimeout(timer);
          setError("");
          map.current = new google.maps.Map(container.current, {
            center,
            zoom: 14,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
            clickableIcons: false,
            gestureHandling: "cooperative",
            mapId: process.env.NEXT_PUBLIC_GOOGLE_MAP_ID || "DEMO_MAP_ID",
          });
          map.current.addListener("click", (e: google.maps.MapMouseEvent) => {
            if (e.latLng)
              pinCallback.current?.({
                lat: e.latLng.lat(),
                lng: e.latLng.lng(),
              });
          });
          setReady(true);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
      clearTimeout(timer);
      if (map.current) google.maps.event.clearInstanceListeners(map.current);
    };
    // The map instance owns its initial centre; subsequent changes are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo]);
  useEffect(() => {
    if (!ready || !map.current) return;
    const instance = map.current;
    const overlays: (
      | google.maps.Circle
      | google.maps.Polyline
      | google.maps.marker.AdvancedMarkerElement
    )[] = [];
    const circle = new google.maps.Circle({
      map: instance,
      center,
      radius,
      strokeColor: "#FF705B",
      strokeOpacity: locked ? 0.65 : 0.25,
      strokeWeight: 1.5,
      fillColor: "#FF705B",
      fillOpacity: 0.06,
      clickable: false,
    });
    overlays.push(circle);
    const bounds = new google.maps.LatLngBounds();
    bounds.extend(center);
    const cb = circle.getBounds();
    if (cb) bounds.union(cb);
    for (const [i, p] of places.entries()) {
      const content = document.createElement("button");
      content.type = "button";
      content.className = `google-numbered-pin ${selected === p.id ? "selected" : ""}`;
      content.textContent = String(i + 1);
      content.setAttribute("aria-label", `Map stop ${i + 1}: ${p.name}`);
      content.addEventListener("click", (event) => {
        event.stopPropagation();
        onSelect?.(p.id);
      });
      const marker = new google.maps.marker.AdvancedMarkerElement({
        map: instance,
        position: p.point,
        title: `${i + 1}. ${p.name}`,
        content,
        zIndex: selected === p.id ? 100 : 10,
      });
      overlays.push(marker);
      bounds.extend(p.point);
    }
    for (const leg of legs) {
      if (!leg.verified || !leg.polyline) continue;
      try {
        overlays.push(
          new google.maps.Polyline({
            map: instance,
            path: decodePolyline(leg.polyline),
            strokeColor: "#192630",
            strokeOpacity: 0.8,
            strokeWeight: 4,
          }),
        );
      } catch {
        setError(
          "Route geometry could not be displayed. Use external navigation.",
        );
      }
    }
    const nextShape = JSON.stringify([
      center,
      radius,
      places.map((p) => [p.id, p.point]),
    ]);
    if (shape.current !== nextShape) {
      instance.fitBounds(bounds, 45);
      shape.current = nextShape;
    } else if (selected && lastSelected.current !== selected) {
      const place = places.find((p) => p.id === selected);
      if (place) instance.panTo(place.point);
    }
    lastSelected.current = selected;
    return () => {
      for (const overlay of overlays) {
        google.maps.event.clearInstanceListeners(overlay);
        if (overlay instanceof google.maps.marker.AdvancedMarkerElement)
          overlay.map = null;
        else overlay.setMap(null);
      }
    };
  }, [ready, center, radius, places, legs, selected, onSelect, locked]);
  return (
    <div
      className={`map-panel ${demo ? "fixture-map" : ""}`}
      aria-label={demo ? "Synthetic fixture map" : "Interactive area map"}
    >
      <div ref={container} className="google-map" />
      {demo ? (
        <div className="fixture-map-inner">
          <div className="fixture-water" />
          <div className="fixture-radius" />
          {places.map((p, i) => (
            <button
              key={p.id}
              type="button"
              aria-label={`Map stop ${i + 1}: ${p.name}`}
              className={`fixture-pin ${selected === p.id ? "selected" : ""}`}
              style={{
                left: `${22 + ((i * 23) % 60)}%`,
                top: `${25 + ((i * 17) % 52)}%`,
              }}
              onClick={() => onSelect?.(p.id)}
            >
              {i + 1}
            </button>
          ))}
          {!places.length ? (
            <MapPin className="fixture-center" size={35} />
          ) : null}
          <span className="fixture-label">Synthetic map · no live routing</span>
        </div>
      ) : null}
      {error ? (
        <div className="map-error">
          <MapIcon size={26} />
          <strong>Map unavailable</strong>
          <p>{error}</p>
        </div>
      ) : null}
      <div className="map-caption">
        <span className="radius-dot" />
        {radius >= 1000 ? `${radius / 1000} km` : `${radius} m`} exploration
        area{onPin ? <span> · Tap to drop a pin</span> : null}
      </div>
      {!demo && !error ? (
        <button
          type="button"
          className="map-fit icon-button"
          aria-label="Fit map to area"
          onClick={() => {
            if (map.current) {
              map.current.panTo(center);
              map.current.setZoom(radius <= 1000 ? 15 : 13);
            }
          }}
        >
          <Expand size={19} />
        </button>
      ) : null}
    </div>
  );
}
