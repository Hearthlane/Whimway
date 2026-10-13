"use client";
import { useState } from "react";
import { Utensils, TreePine, Palette, ShoppingBag, MapPin } from "lucide-react";
import type { CandidatePlace } from "@/lib/schema";
import { safeUrl } from "@/lib/geo";
export function PlacePhoto({
  place,
  demo = false,
}: {
  place: CandidatePlace;
  demo?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const photo = place.photos[0];
  const food = place.types.some(
    (t) => t.includes("restaurant") || t.includes("cafe"),
  );
  const park = place.types.includes("park");
  const art = place.types.some(
    (t) => t.includes("museum") || t.includes("gallery"),
  );
  const shop = place.types.includes("shopping_mall");
  const Icon = food
    ? Utensils
    : park
      ? TreePine
      : art
        ? Palette
        : shop
          ? ShoppingBag
          : MapPin;
  return (
    <div
      className={`place-photo ${park ? "mint" : art ? "lavender" : food ? "peach" : "yellow"}`}
    >
      {photo && !failed && !demo ? (
        <>
          <img
            src={`/api/photo?name=${encodeURIComponent(photo.name)}`}
            alt={place.name}
            onError={() => setFailed(true)}
            loading="lazy"
          />
          <div className="photo-attribution">
            {photo.authors.map((a, i) =>
              safeUrl(a.uri) ? (
                <a
                  key={i}
                  href={a.uri}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {a.name}
                </a>
              ) : (
                <span key={i}>{a.name}</span>
              ),
            )}
          </div>
        </>
      ) : (
        <div className="category-art">
          <Icon size={44} strokeWidth={1.25} />
          <span>
            {demo ? "TEST FIXTURE · NO VENUE PHOTO" : "VENUE PHOTO UNAVAILABLE"}
          </span>
          <i>✦</i>
        </div>
      )}
    </div>
  );
}
