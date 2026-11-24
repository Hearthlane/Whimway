import { router } from "expo-router";
import { DateTime } from "luxon";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PlanTile } from "@/home/Plans";
import { useStore } from "@/lib/store";
import { Button, Icon, IconButton, Press, T } from "@/ui/kit";
import { color, radius, space } from "@/ui/theme";

type Tab = "plans" | "places" | "searches";
const ago = (iso: string) => DateTime.fromISO(iso).toRelative({ style: "short" }) ?? "";

/** History: plans you opened, places you looked at and what you searched, newest first. */
export default function History() {
  const { plans, history, clearHistory } = useStore();
  const [tab, setTab] = useState<Tab>("plans");
  const viewed = Object.entries(plans)
    .sort((a, b) => (b[1].viewedAt ?? b[1].createdAt).localeCompare(a[1].viewedAt ?? a[1].createdAt));
  const counts = { plans: viewed.length, places: history.places.length, searches: history.searches.length };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.canvas }}>
      <View style={s.top}>
        <IconButton icon="arrow-left" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/profile"))} />
        <T v="title" accessibilityRole="header" style={{ flex: 1 }}>
          History
        </T>
        {tab !== "plans" && counts[tab] ? <Button kind="ghost" label="Clear" onPress={() => clearHistory(tab)} testID="history-clear" /> : null}
      </View>
      <View style={s.tabs} accessibilityRole="tablist">
        {(["plans", "places", "searches"] as const).map((t) => (
          <Press key={t} testID={`history-tab-${t}`} accessibilityRole="tab" accessibilityState={{ selected: tab === t }} onPress={() => setTab(t)} style={[s.tab, tab === t && s.tabOn]}>
            <T v="smallStrong" tone={tab === t ? color.ink : color.muted}>
              {t[0].toUpperCase() + t.slice(1)}
              {counts[t] ? ` · ${counts[t]}` : ""}
            </T>
          </Press>
        ))}
      </View>
      <ScrollView contentContainerStyle={s.page}>
        {tab === "plans" ? (
          viewed.length ? (
            <View style={s.grid}>
              {viewed.map(([id, e]) => (
                <View key={id} style={s.cell}>
                  <PlanTile id={id} entry={e} />
                </View>
              ))}
            </View>
          ) : (
            <Empty text="Plans you make and open show up here." />
          )
        ) : null}
        {tab === "places" ? (
          history.places.length ? (
            history.places.map((p) => (
              <Press key={p.id} accessibilityRole="button" onPress={() => router.push({ pathname: "/discover", params: { q: p.name } })} style={s.row}>
                <Icon name="map-pin" size={16} tint={color.muted} />
                <View style={{ flex: 1 }}>
                  <T v="bodyStrong" numberOfLines={1}>
                    {p.name}
                  </T>
                  <T v="small" tone={color.muted} numberOfLines={1}>
                    {[p.category, ago(p.at)].filter(Boolean).join(" · ")}
                  </T>
                </View>
                <Icon name="chevron-right" tint={color.faint} />
              </Press>
            ))
          ) : (
            <Empty text="Places you open in Explore show up here." />
          )
        ) : null}
        {tab === "searches" ? (
          history.searches.length ? (
            history.searches.map((q) => (
              <Press key={q.q} accessibilityRole="button" onPress={() => router.push({ pathname: "/discover", params: { q: q.q } })} style={s.row}>
                <Icon name="clock" size={16} tint={color.muted} />
                <T v="body" style={{ flex: 1 }} numberOfLines={1}>
                  {q.q}
                </T>
                <T v="small" tone={color.muted}>
                  {ago(q.at)}
                </T>
              </Press>
            ))
          ) : (
            <Empty text="What you search for in Explore shows up here." />
          )
        ) : null}
        <T v="small" tone={color.muted} style={{ textAlign: "center", marginTop: space.lg }}>
          History stays on this device. Clear it here or in Settings.
        </T>
      </ScrollView>
    </SafeAreaView>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <View style={s.empty}>
      <Icon name="clock" size={24} tint={color.muted} />
      <T v="body" tone={color.muted} style={{ textAlign: "center" }}>
        {text}
      </T>
    </View>
  );
}

const s = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm },
  tabs: { flexDirection: "row", borderBottomWidth: 1, borderColor: color.line },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 48, borderBottomWidth: 2, borderColor: "transparent" },
  tabOn: { borderColor: color.ink },
  page: { padding: space.xl, gap: space.sm, maxWidth: 680, width: "100%", alignSelf: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -2 },
  cell: { width: "33.333%", padding: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 56, paddingHorizontal: space.md, borderRadius: radius.lg, backgroundColor: color.paper, borderWidth: 1, borderColor: color.line },
  empty: { alignItems: "center", gap: space.md, paddingVertical: space.xxl },
});
