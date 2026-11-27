import { Image } from "expo-image";
import { DateTime } from "luxon";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import type { CandidatePlace } from "@shared/schema";
import { API_URL } from "@/lib/config";
import { Press, Sheet, T } from "@/ui/kit";
import { color, radius, space } from "@/ui/theme";

/** A Google photo through the API (which keeps the key server-side), at a sensible width. */
export const photoSrc = (name: string, width: 400 | 1000 = 1000) => ({ uri: `${API_URL}/api/photo?name=${encodeURIComponent(name)}&w=${width}` });

/** ★★★★☆ 4.6 · 1,234 reviews: the place's public rating, read at a glance. */
export function Stars({ rating, reviews, tone = color.ink }: { rating?: number; reviews?: number; tone?: string }) {
  if (!rating) return null;
  const full = Math.round(rating);
  return (
    <View style={s.stars} accessible accessibilityLabel={`Rated ${rating.toFixed(1)} out of 5${reviews ? ` from ${reviews.toLocaleString()} reviews` : ""}`}>
      <T v="bodyStrong" tone="#E8A200" style={{ letterSpacing: 1 }}>
        {"★".repeat(full)}
        <T v="bodyStrong" tone={color.lineStrong}>
          {"★".repeat(5 - full)}
        </T>
      </T>
      <T v="smallStrong" tone={tone}>
        {rating.toFixed(1)}
      </T>
      {reviews ? (
        <T v="small" tone={color.muted}>
          · {reviews.toLocaleString()} reviews
        </T>
      ) : null}
    </View>
  );
}

/** "Saturday: 10:00 AM – 10:00 PM" for the visit day, from Google's weekly hours. */
export function hoursFor(hours: string[], iso: string, zone: string) {
  const day = DateTime.fromISO(iso).setZone(zone).toFormat("cccc");
  return hours.find((h) => h.startsWith(day));
}

/** The whole week's opening hours, with the day of the visit highlighted. */
export function WeekHours({ hours, iso, zone }: { hours: string[]; iso: string; zone: string }) {
  if (!hours.length) return null;
  const day = DateTime.fromISO(iso).setZone(zone).toFormat("cccc");
  return (
    <View style={s.week} accessibilityLabel={`Opening hours. ${hours.join(". ")}`}>
      {hours.map((line) => {
        const [name, ...rest] = line.split(": ");
        const on = name === day;
        return (
          <View key={line} style={[s.weekRow, on && s.weekOn]}>
            <T v={on ? "smallStrong" : "small"} style={{ width: 96 }}>
              {name}
            </T>
            <T v={on ? "smallStrong" : "small"} tone={on ? color.ink : color.inkSoft} style={{ flex: 1 }}>
              {rest.join(": ") || "Hours not listed"}
            </T>
          </View>
        );
      })}
    </View>
  );
}

/** More photos of the place: a swipeable strip; tap one to see it large. */
export function Gallery({ place, inline }: { place: Pick<CandidatePlace, "name" | "photos">; /** Inside another sheet: bigger photos, no viewer on top. */ inline?: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  if (place.photos.length < 2) return null;
  if (inline)
    return (
      <View style={{ gap: space.sm }}>
        <T v="smallStrong">Photos</T>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
          {place.photos.map((p, i) => (
            <View key={p.name} style={s.inline} testID={`gallery-${i + 1}`}>
              <Image source={photoSrc(p.name, 400)} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} accessibilityIgnoresInvertColors alt="" />
            </View>
          ))}
        </ScrollView>
      </View>
    );
  return (
    <View style={{ gap: space.sm }}>
      <T v="smallStrong">Photos</T>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
        {place.photos.map((p, i) => (
          <Press key={p.name} accessibilityRole="button" accessibilityLabel={`Photo ${i + 1} of ${place.photos.length} of ${place.name}`} onPress={() => setOpen(i)} style={s.thumb} testID={`gallery-${i + 1}`}>
            <Image source={photoSrc(p.name, 400)} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} accessibilityIgnoresInvertColors alt="" />
          </Press>
        ))}
      </ScrollView>
      <Sheet open={open !== null} onClose={() => setOpen(null)} title={place.name}>
        <View style={{ gap: space.md }}>
          {open !== null
            ? [...place.photos.slice(open), ...place.photos.slice(0, open)].map((p) => (
                <View key={p.name} style={{ gap: 4 }}>
                  <Image source={photoSrc(p.name)} style={s.large} contentFit="cover" transition={200} accessibilityIgnoresInvertColors alt="" />
                  {p.authors[0] ? (
                    <T v="small" tone={color.muted}>
                      Photo: {p.authors[0].name}
                    </T>
                  ) : null}
                </View>
              ))
            : null}
        </View>
      </Sheet>
    </View>
  );
}

const s = StyleSheet.create({
  stars: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  week: { gap: 2, padding: space.sm, borderRadius: radius.md, backgroundColor: color.canvas },
  weekRow: { flexDirection: "row", gap: space.sm, paddingVertical: 3, paddingHorizontal: space.sm, borderRadius: radius.sm },
  weekOn: { backgroundColor: color.yellowTint },
  thumb: { width: 132, height: 99, borderRadius: radius.md, overflow: "hidden", backgroundColor: color.line },
  inline: { width: 240, height: 180, borderRadius: radius.md, overflow: "hidden", backgroundColor: color.line },
  large: { width: "100%", aspectRatio: 4 / 3, borderRadius: radius.md, backgroundColor: color.line },
});
