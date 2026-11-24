import { router } from "expo-router";
import { DateTime } from "luxon";
import { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { activityFor, isNew, type ActivityItem } from "@/home/activity";
import { useStore } from "@/lib/store";
import { Button, Icon, IconButton, Press, T, type IconName } from "@/ui/kit";
import { color, radius, space } from "@/ui/theme";

const look: Record<ActivityItem["kind"], { icon: IconName; tint: string }> = {
  today: { icon: "navigation", tint: color.coral },
  soon: { icon: "calendar", tint: color.mintTint },
  rate: { icon: "star", tint: color.yellowTint },
  person: { icon: "users", tint: color.lavenderTint },
  place: { icon: "heart", tint: color.coralTint },
  welcome: { icon: "compass", tint: color.mintTint },
};

/** Activity: reminders and nudges worked out from your own plans, people and places. */
export default function Activity() {
  const { plans, profile, history, markActivitySeen } = useStore();
  // Remember what was new on arrival, then mark everything seen so the bell clears.
  const [seenAt] = useState(history.activitySeenAt);
  useEffect(() => markActivitySeen(), [markActivitySeen]);
  const items = useMemo(() => activityFor(plans, profile), [plans, profile]);
  const now = DateTime.now();
  const groups: { title: string; items: ActivityItem[] }[] = [
    { title: "Now and next", items: items.filter((i) => i.kind === "today" || i.kind === "soon") },
    { title: "Needs you", items: items.filter((i) => i.kind === "rate") },
    { title: "Ideas", items: items.filter((i) => i.kind === "person" || i.kind === "place" || i.kind === "welcome") },
  ].filter((g) => g.items.length);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.canvas }}>
      <View style={s.top}>
        <IconButton icon="arrow-left" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
        <T v="title" accessibilityRole="header">
          Activity
        </T>
      </View>
      <ScrollView contentContainerStyle={s.page}>
        {!groups.length ? (
          <View style={s.empty}>
            <View style={s.emptyIcon}>
              <Icon name="bell" size={24} />
            </View>
            <T v="heading">You’re all caught up</T>
            <T v="body" tone={color.muted} style={{ textAlign: "center" }}>
              Reminders for upcoming plans and “how was it?” check-ins show up here.
            </T>
            <Button label="Make a plan" icon="plus" onPress={() => router.push("/create")} />
          </View>
        ) : null}
        {groups.map((g) => (
          <View key={g.title} style={{ gap: space.sm }}>
            <T v="eyebrow" tone={color.muted}>
              {g.title}
            </T>
            {g.items.map((item, i) => (
              <Animated.View key={item.id} entering={FadeInDown.delay(i * 40).duration(220)}>
                <Press testID={`activity-${item.id}`} accessibilityRole="button" accessibilityLabel={`${item.title}. ${item.body}`} onPress={() => router.push(item.href as never)} style={s.row}>
                  <View style={[s.icon, { backgroundColor: look[item.kind].tint }]}>
                    <Icon name={look[item.kind].icon} size={18} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      {isNew(item, seenAt) ? <View style={s.dot} accessibilityLabel="New" /> : null}
                      <T v="bodyStrong" numberOfLines={2} style={{ flexShrink: 1 }}>
                        {item.title}
                      </T>
                    </View>
                    <T v="small" tone={color.muted} numberOfLines={2}>
                      {item.body}
                      {item.became ? ` · ${DateTime.fromISO(item.became).toRelative({ style: "short" })}` : ""}
                    </T>
                  </View>
                  <View style={s.action}>
                    <T v="smallStrong">{item.action}</T>
                  </View>
                </Press>
              </Animated.View>
            ))}
          </View>
        ))}
        <T v="small" tone={color.muted} style={{ textAlign: "center" }}>
          Worked out on this device from your plans and people · {now.toFormat("h:mm a")}
        </T>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.coral },
  top: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm },
  page: { padding: space.xl, paddingTop: space.md, gap: space.xl, maxWidth: 680, width: "100%", alignSelf: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, minHeight: 72, borderRadius: radius.lg, backgroundColor: color.paper, borderWidth: 1, borderColor: color.line },
  icon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  action: { paddingHorizontal: space.md, minHeight: 36, justifyContent: "center", borderRadius: radius.pill, backgroundColor: color.canvas, borderWidth: 1, borderColor: color.line },
  empty: { alignItems: "center", gap: space.md, paddingVertical: space.xxl },
  emptyIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: color.mintTint, alignItems: "center", justifyContent: "center" },
});
