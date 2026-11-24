import { Image } from "expo-image";
import { router } from "expo-router";
import { startOf, today, whenLabel } from "@shared/today";
import { Linking, ScrollView, StyleSheet, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import type { PlanEntry } from "@/lib/store";
import { guidePhotos } from "@/plan/guidePhotos";
import { StopArt } from "@/plan/StopArt";
import { Button, Icon, Press, T } from "@/ui/kit";
import { color, font, radius, shadow, space } from "@/ui/theme";

export { endOf, startOf, whenLabel } from "@shared/today";
// A photo of the kind of stop when there is one; otherwise a drawn illustration.
const photosOf = (e: PlanEntry) => (e.meta.brief?.length ? e.meta.brief.map((b) => ({ src: guidePhotos[b.kind], kind: b.kind })) : [{ src: undefined, kind: "" }]);
function Pic({ src, kind, style }: { src?: number; kind: string; style: object }) {
  return src ? (
    <Image source={src} style={style} contentFit="cover" accessibilityIgnoresInvertColors alt="" accessible={false} />
  ) : (
    <View style={[style, { overflow: "hidden" }]}>
      <StopArt place={{ category: kind, types: [kind] }} height={220} />
    </View>
  );
}

/** Horizontal photo cards for upcoming or recent plans. */
export function PlanCards({ entries, prefix }: { entries: [string, PlanEntry][]; prefix: string }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.bleed} contentContainerStyle={s.row}>
      {entries.map(([id, e], i) => (
        <Animated.View key={id} entering={FadeInDown.delay(i * 60).duration(300)}>
          <Press testID={`${prefix}-${id}`} accessibilityRole="button" accessibilityLabel={`${e.meta.title}, ${whenLabel(e)}`} scaleTo={0.97} onPress={() => router.push(`/plan/${id}`)} style={s.card}>
            <View style={s.strip}>
              {photosOf(e).slice(0, 3).map((p, j) => (
                <Pic key={j} {...p} style={s.photo} />
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
      <Pic {...photosOf(entry)[0]} style={StyleSheet.absoluteFill} />
      <View style={s.tileShade} />
      <View style={s.tileText}>
        <T v="smallStrong" tone={color.paper} numberOfLines={2}>
          {entry.meta.title}
        </T>
        <T v="small" tone={color.paper} style={{ fontSize: 13, opacity: 0.85 }} numberOfLines={1}>
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
  const t = today(plans);
  if (!t) return null;
  const { live } = t;
  const title = plans[t.id].meta.title;
  return (
    <Animated.View entering={FadeInDown.duration(240)} style={[s.today, live && s.todayLive]} testID="today-card">
      <View style={s.todayTop}>
        <View style={[s.pill, live && { backgroundColor: color.coral }]}>
          {live ? <View style={s.dot} /> : <Icon name="calendar" size={12} tint={color.ink} />}
          <T v="smallStrong" style={{ fontSize: 13 }}>
            {t.label}
          </T>
        </View>
        {live ? (
          <T v="small" tone="#C7CCE4" numberOfLines={1} style={{ flex: 1, textAlign: "right" }}>
            {title}
          </T>
        ) : null}
      </View>
      <T style={[s.todayHead, { color: live ? color.paper : color.ink }]} numberOfLines={2}>
        {t.headline}
      </T>
      <T v="body" tone={live ? "#C7CCE4" : color.muted} numberOfLines={2}>
        {t.sub}
      </T>
      {live && t.total ? (
        <View style={s.progress} accessibilityLabel={`${t.done} of ${t.total} stops done`}>
          {Array.from({ length: t.total }, (_, i) => (
            <View key={i} style={[s.seg, i < t.done ? s.segDone : i === t.done && t.label === "Happening now" ? s.segNow : null]} />
          ))}
        </View>
      ) : null}
      <View style={s.todayActions}>
        <Button kind={live ? "primary" : "dark"} label="Open plan" onPress={() => router.push(`/plan/${t.id}`)} style={{ flex: 1 }} testID="today-open" />
        {t.directions ? <Button kind="soft" label="Directions" icon="navigation" onPress={() => void Linking.openURL(t.directions!)} style={{ flex: 1 }} /> : null}
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
