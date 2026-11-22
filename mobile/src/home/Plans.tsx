import { Image } from "expo-image";
import { router } from "expo-router";
import { DateTime } from "luxon";
import { Linking, ScrollView, StyleSheet, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import type { PlanEntry } from "@/lib/store";
import { guidePhotos } from "@/plan/guidePhotos";
import { Button, Icon, Press, T } from "@/ui/kit";
import { color, font, radius, shadow, space } from "@/ui/theme";

const ZONE = "America/Toronto";
const at = (iso: string) => DateTime.fromISO(iso).setZone(ZONE);
export const startOf = (e: PlanEntry) => (e.meta.brief?.[0] ? at(e.meta.brief[0].at) : DateTime.fromISO(`${e.meta.date}T${e.meta.startTime}`, { zone: ZONE }));
export const endOf = (e: PlanEntry) => {
  const last = e.meta.brief?.[e.meta.brief.length - 1];
  return last ? at(last.until) : startOf(e).plus({ hours: 4 });
};
export function whenLabel(e: PlanEntry, now = DateTime.now().setZone(ZONE)) {
  const t = startOf(e);
  const days = Math.round(t.startOf("day").diff(now.startOf("day"), "days").days);
  const day = days === 0 ? "Today" : days === 1 ? "Tomorrow" : days === -1 ? "Yesterday" : days > 1 && days < 7 ? t.toFormat("cccc") : t.toFormat("ccc d LLL");
  return `${day}, ${t.toFormat("h:mm a")}`;
}
const photosOf = (e: PlanEntry) => (e.meta.brief?.length ? e.meta.brief.map((b) => guidePhotos[b.kind] ?? guidePhotos.sights) : [guidePhotos.sights]);

/** Horizontal photo cards for upcoming or recent plans. */
export function PlanCards({ entries, prefix }: { entries: [string, PlanEntry][]; prefix: string }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.bleed} contentContainerStyle={s.row}>
      {entries.map(([id, e], i) => (
        <Animated.View key={id} entering={FadeInDown.delay(i * 60).duration(300)}>
          <Press testID={`${prefix}-${id}`} accessibilityRole="button" accessibilityLabel={`${e.meta.title}, ${whenLabel(e)}`} scaleTo={0.97} onPress={() => router.push(`/plan/${id}`)} style={s.card}>
            <View style={s.strip}>
              {photosOf(e).slice(0, 3).map((src, j) => (
                <Image key={j} source={src} style={s.photo} contentFit="cover" accessibilityIgnoresInvertColors />
              ))}
              {e.saved ? (
                <View style={s.saved}>
                  <Icon name="bookmark" size={12} tint={color.paper} />
                </View>
              ) : null}
            </View>
            <View style={s.body}>
              <T v="bodyStrong" numberOfLines={1}>
                {e.meta.title}
              </T>
              <T v="small" tone={color.muted} numberOfLines={1}>
                {whenLabel(e)} · {e.meta.stops} stops
              </T>
            </View>
          </Press>
        </Animated.View>
      ))}
    </ScrollView>
  );
}

/** A square photo tile for the profile grid. */
export function PlanTile({ id, entry }: { id: string; entry: PlanEntry }) {
  return (
    <Press testID={`plan-tile-${id}`} accessibilityRole="button" accessibilityLabel={entry.meta.title} scaleTo={0.97} onPress={() => router.push(`/plan/${id}`)} style={s.tile}>
      <Image source={photosOf(entry)[0]} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityIgnoresInvertColors />
      <View style={s.tileShade} />
      <View style={s.tileText}>
        <T v="smallStrong" tone={color.paper} numberOfLines={2}>
          {entry.meta.title}
        </T>
        <T v="small" tone={color.paper} style={{ fontSize: 11, opacity: 0.85 }} numberOfLines={1}>
          {startOf(entry).toFormat("d LLL")}
        </T>
      </View>
    </Press>
  );
}

/**
 * Today's plan, live: what's happening now or next, with a countdown and directions.
 * Shown from two hours before the first stop until the last one ends; otherwise the next
 * plan within a week, if any.
 */
export function TodayCard({ plans }: { plans: Record<string, PlanEntry> }) {
  const now = DateTime.now().setZone(ZONE);
  const ahead = Object.entries(plans)
    .filter(([, e]) => endOf(e) > now && startOf(e).diff(now, "days").days < 7)
    .sort((a, b) => startOf(a[1]).toMillis() - startOf(b[1]).toMillis());
  if (!ahead.length) return null;
  const [id, e] = ahead[0];
  const start = startOf(e);
  const live = start.diff(now, "hours").hours <= 2;
  const brief = e.meta.brief ?? [];
  const current = brief.find((b) => at(b.at) <= now && now < at(b.until));
  const next = brief.find((b) => at(b.at) > now);
  const until = (t: DateTime) => {
    const m = Math.max(0, Math.round(t.diff(now, "minutes").minutes));
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ""}`.trim();
  };
  const headline = !live
    ? `Next up: ${whenLabel(e, now)}`
    : current
      ? `Now: ${current.name}`
      : next && at(next.at) > now && brief[0] && at(brief[0].at) > now
        ? `Starts in ${until(start)}`
        : "Your plan today";
  const sub = !live
    ? brief.length
      ? brief.map((b) => b.name).join(" → ")
      : `${e.meta.stops} stops`
    : current && next
      ? `Then ${next.name} at ${at(next.at).toFormat("h:mm a")}`
      : current
        ? `Last stop, until ${at(current.until).toFormat("h:mm a")}`
        : next
          ? `${next.name} at ${at(next.at).toFormat("h:mm a")}`
          : e.meta.title;
  const target = current ? (next ?? current) : next;
  return (
    <Animated.View entering={FadeInDown.duration(380)} style={[s.today, live && s.todayLive]} testID="today-card">
      <View style={s.todayTop}>
        <View style={[s.pill, live && { backgroundColor: color.coral }]}>
          {live ? <View style={s.dot} /> : <Icon name="calendar" size={12} tint={color.ink} />}
          <T v="smallStrong" style={{ fontSize: 12 }}>
            {live ? (current ? "Happening now" : "Today") : "Coming up"}
          </T>
        </View>
        <T v="small" tone={live ? "#C7CCE4" : color.muted} numberOfLines={1} style={{ flex: 1, textAlign: "right" }}>
          {e.meta.title}
        </T>
      </View>
      <T style={[s.todayHead, { color: live ? color.paper : color.ink }]} numberOfLines={2}>
        {headline}
      </T>
      <T v="body" tone={live ? "#C7CCE4" : color.muted} numberOfLines={2}>
        {sub}
      </T>
      {live && brief.length ? (
        <View style={s.progress} accessibilityLabel={`${brief.filter((b) => at(b.until) <= now).length} of ${brief.length} stops done`}>
          {brief.map((b) => (
            <View key={b.placeId} style={[s.seg, at(b.until) <= now ? s.segDone : at(b.at) <= now ? s.segNow : null]} />
          ))}
        </View>
      ) : null}
      <View style={s.todayActions}>
        <Button kind={live ? "primary" : "dark"} label="Open plan" onPress={() => router.push(`/plan/${id}`)} style={{ flex: 1 }} testID="today-open" />
        {live && target ? <Button kind="soft" label="Directions" icon="navigation" onPress={() => void Linking.openURL(target.mapsUrl)} style={{ flex: 1 }} /> : null}
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  bleed: { marginHorizontal: -space.xl },
  row: { gap: space.md, paddingHorizontal: space.xl, paddingBottom: 4 },
  card: { width: 220, borderRadius: radius.lg, backgroundColor: color.paper, borderWidth: 1, borderColor: color.line, overflow: "hidden" },
  strip: { flexDirection: "row", height: 96, gap: 2 },
  photo: { flex: 1, backgroundColor: color.line },
  saved: { position: "absolute", top: 8, right: 8, width: 24, height: 24, borderRadius: 12, backgroundColor: color.ink, alignItems: "center", justifyContent: "center" },
  body: { padding: space.md, gap: 2 },
  tile: { width: "100%", aspectRatio: 1, borderRadius: radius.sm, overflow: "hidden", backgroundColor: color.line },
  tileShade: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(16,23,58,0.38)" },
  tileText: { position: "absolute", left: 8, right: 8, bottom: 8, gap: 1 },
  today: { gap: space.sm, padding: space.xl, borderRadius: radius.xl, backgroundColor: color.paper, borderWidth: 1, borderColor: color.line, ...shadow.card },
  todayLive: { backgroundColor: color.ink, borderColor: color.ink },
  todayTop: { flexDirection: "row", alignItems: "center", gap: space.md },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: color.coralTint },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: color.ink },
  todayHead: { fontFamily: font.displayBold, fontSize: 26, lineHeight: 30, letterSpacing: -0.6 },
  progress: { flexDirection: "row", gap: 4, marginTop: space.xs },
  seg: { flex: 1, height: 5, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.18)" },
  segDone: { backgroundColor: color.coral },
  segNow: { backgroundColor: color.paper },
  todayActions: { flexDirection: "row", gap: space.sm, marginTop: space.sm },
});
