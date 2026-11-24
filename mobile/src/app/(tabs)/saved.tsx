import { router, useLocalSearchParams } from "expo-router";
import { planAround } from "@/home/actions";
import { DateTime } from "luxon";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useStore, type PlanEntry } from "@/lib/store";
import { Badge, Button, Icon, IconButton, Press, T } from "@/ui/kit";
import { color, radius, space } from "@/ui/theme";

export default function Saved() {
  const store = useStore();
  const { plans, remove, setPending, profile, setProfile } = store;
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<"plans" | "places">(params.tab === "places" ? "places" : "plans");
  const saved = Object.entries(plans).filter(([, e]) => e.saved);
  const now = DateTime.now().toISODate()!;
  const upcoming = saved.filter(([, e]) => e.meta.date >= now).sort((a, b) => a[1].meta.date.localeCompare(b[1].meta.date));
  const past = saved.filter(([, e]) => e.meta.date < now).sort((a, b) => b[1].meta.date.localeCompare(a[1].meta.date));

  const reuse = (e: PlanEntry) => {
    // "Do it again": same request (vibes, budget, who, where), new date — fresh venues.
    const tomorrow = DateTime.now().setZone(e.spec.request.location.timezone).plus({ days: 1 }).toISODate()!;
    setPending({ ...e.spec.request, date: tomorrow, excludedPlaceIds: [] });
    router.push("/plan/new");
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.canvas }} edges={["top"]}>
      <ScrollView contentContainerStyle={s.page}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <T v="hero" accessibilityRole="header">
            Saved
          </T>
          <Button testID="open-shared" kind="ghost" icon="link" label="Open a link" onPress={() => router.push("/import")} />
        </View>
        <View style={s.segment} accessibilityRole="tablist">
          {(["plans", "places"] as const).map((t) => (
            <Press key={t} testID={`saved-tab-${t}`} accessibilityRole="tab" accessibilityState={{ selected: tab === t }} onPress={() => setTab(t)} style={[s.segmentItem, tab === t && s.segmentOn]}>
              <T v="smallStrong" tone={tab === t ? color.paper : color.ink}>
                {t === "plans" ? `Plans${saved.length ? ` · ${saved.length}` : ""}` : `Places${profile.favourites.length ? ` · ${profile.favourites.length}` : ""}`}
              </T>
            </Press>
          ))}
        </View>
        {tab === "plans" && !saved.length ? (
          <View style={s.empty}>
            <View style={s.emptyIcon}>
              <Icon name="bookmark" size={26} />
            </View>
            <T v="heading">No saved plans yet</T>
            <T v="body" tone={color.muted} style={{ textAlign: "center" }}>
              Plans you save land here, ready to reopen, rerun or rate after you go.
            </T>
            <Button label="Plan something" icon="star" onPress={() => router.push("/")} />
          </View>
        ) : null}
        {tab === "plans" && upcoming.length ? <Section title="Coming up" items={upcoming} onReuse={reuse} onRemove={remove} /> : null}
        {tab === "plans" && past.length ? <Section title="Been there" items={past} onReuse={reuse} onRemove={remove} past /> : null}
        {tab === "places" ? (
          profile.favourites.length ? (
            <View style={{ gap: space.sm, marginTop: space.lg }} testID="saved-places">
              {profile.favourites.map((f) => (
                <View key={f.id} style={s.place} testID="favourite">
                  <View style={s.placeIcon}>
                    <Icon name="heart" size={16} tint={color.coralText} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <T v="bodyStrong" numberOfLines={1}>
                      {f.name}
                    </T>
                    {f.category ? (
                      <T v="small" tone={color.muted} numberOfLines={1}>
                        {f.category[0].toUpperCase() + f.category.slice(1)}
                      </T>
                    ) : null}
                  </View>
                  <Button kind="soft" label="Plan around it" onPress={() => planAround(f, profile, store)} />
                  <IconButton icon="x" label={`Remove ${f.name}`} onPress={() => setProfile({ ...profile, favourites: profile.favourites.filter((x) => x.id !== f.id) })} />
                </View>
              ))}
            </View>
          ) : (
            <View style={s.empty}>
              <View style={s.emptyIcon}>
                <Icon name="heart" size={26} />
              </View>
              <T v="heading">No saved places yet</T>
              <T v="body" tone={color.muted} style={{ textAlign: "center" }}>
                Tap the heart on any place in Explore or in a plan, then build a whole outing around it.
              </T>
              <Button label="Explore places" icon="search" onPress={() => router.push("/discover")} />
            </View>
          )
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, items, onReuse, onRemove, past }: { title: string; items: [string, PlanEntry][]; onReuse: (e: PlanEntry) => void; onRemove: (id: string) => void; past?: boolean }) {
  const [confirm, setConfirm] = useState<string | null>(null);
  return (
    <View style={{ gap: space.sm }}>
      <T v="eyebrow" tone={color.muted} style={{ marginTop: space.lg }}>
        {title}
      </T>
      {items.map(([id, e]) => {
        const when = DateTime.fromISO(`${e.meta.date}T${e.meta.startTime}`);
        if (confirm === id)
          return (
            <View key={id} style={[s.card, { backgroundColor: color.coralTint, flexWrap: "wrap" }]}>
              <T v="small" style={{ flex: 1, minWidth: 160 }}>
                Delete “{e.meta.title}”? This can’t be undone.
              </T>
              <Button kind="ghost" label="Keep" onPress={() => setConfirm(null)} />
              <Button kind="dark" label="Delete plan" onPress={() => { onRemove(id); setConfirm(null); }} />
            </View>
          );
        return (
          <Pressable key={id} accessibilityRole="button" accessibilityLabel={`Open ${e.meta.title}`} onPress={() => router.push(`/plan/${id}`)} style={({ pressed }) => [s.card, pressed && { opacity: 0.8 }]}>
            <View style={s.date}>
              <T v="smallStrong" tone={color.coralText}>
                {when.toFormat("LLL").toUpperCase()}
              </T>
              <T v="title" style={{ lineHeight: 28 }}>
                {when.toFormat("d")}
              </T>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <T v="bodyStrong" numberOfLines={1}>
                {e.meta.title}
              </T>
              <T v="small" tone={color.muted} numberOfLines={1}>
                {when.toFormat("ccc h:mm a")} · {e.meta.area} · {e.meta.stops} stops
              </T>
              <View style={{ flexDirection: "row", gap: 6, marginTop: 4 }}>
                {past && !e.feedback ? <Badge tone="coral" icon="message-circle" label="Rate it" /> : null}
                {e.feedback ? <Badge tone="mint" icon="check" label={e.feedback.went === "no" ? "Skipped" : "Went"} /> : null}
                {e.meta.demo ? <Badge tone="yellow" label="Demo" /> : null}
              </View>
            </View>
            <View style={{ gap: space.sm }}>
              <IconButton icon="repeat" label={`Plan ${e.meta.title} again`} onPress={() => onReuse(e)} />
              <IconButton icon="trash-2" label={`Delete ${e.meta.title}`} onPress={() => setConfirm(id)} />
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  segment: { flexDirection: "row", gap: 4, padding: 4, marginTop: space.lg, borderRadius: radius.pill, backgroundColor: color.paper, borderWidth: 1, borderColor: color.line },
  segmentItem: { flex: 1, minHeight: 40, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  segmentOn: { backgroundColor: color.ink },
  placeIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: color.coralTint, alignItems: "center", justifyContent: "center" },
  place: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderRadius: radius.lg, backgroundColor: color.paper, borderWidth: 1, borderColor: color.line },
  page: { padding: space.xl, paddingBottom: space.xxxl, maxWidth: 680, width: "100%", alignSelf: "center" },
  empty: { alignItems: "center", gap: space.md, padding: space.xl, marginTop: space.xl, borderRadius: radius.xl, backgroundColor: color.paper, borderWidth: 1, borderColor: color.line },
  emptyIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: color.mintTint, alignItems: "center", justifyContent: "center" },
  card: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderRadius: radius.lg, backgroundColor: color.paper, borderWidth: 1, borderColor: color.line },
  date: { width: 56, height: 64, borderRadius: radius.md, backgroundColor: color.canvas, alignItems: "center", justifyContent: "center" },
});
