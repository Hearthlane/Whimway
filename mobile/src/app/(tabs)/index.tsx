import { router, useLocalSearchParams } from "expo-router";
import { DateTime } from "luxon";
import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { areaByKey, defaultArea } from "@shared/areas";
import { examplePrompts } from "@/lib/copy";
import { useStore } from "@/lib/store";
import { activityFor, isNew } from "@/home/activity";
import { planAround } from "@/home/actions";
import { PeopleRow, PersonSheet, type Person } from "@/home/People";
import { PlanCards, TodayCard, endOf, startOf } from "@/home/Plans";
import { PollCard } from "@/plan/PollCard";
import { Sponsored } from "@/plan/Sponsored";
import { Button, Icon, Notice, Press, T, Wordmark, type IconName } from "@/ui/kit";
import { color, font, radius, space } from "@/ui/theme";

const ZONE = "America/Toronto";
function greeting(name: string) {
  const h = DateTime.now().setZone(ZONE).hour;
  const part = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  return name ? `${part}, ${name}` : part;
}
const tints = [color.mintTint, color.lavenderTint, color.yellowTint, color.coralTint];

/**
 * Home: what's next, the people you go out with, and a feed of ideas. Making a plan lives
 * behind the centre "Plan" tab, so Home stays something to browse.
 */
export default function Home() {
  const store = useStore();
  const { profile, plans, demo, status } = store;
  const { welcome, restoredPlans } = useLocalSearchParams<{ welcome?: string; restoredPlans?: string }>();
  const [welcomed, setWelcomed] = useState(false);
  const [editingPerson, setEditingPerson] = useState<Person | "new" | null>(null);
  const now = DateTime.now().setZone(ZONE);
  const area = areaByKey(profile.homeArea) ?? defaultArea;

  const upcoming = Object.entries(plans)
    .filter(([, e]) => endOf(e) > now)
    .sort((a, b) => startOf(a[1]).toMillis() - startOf(b[1]).toMillis())
    .slice(0, 6);
  const recent = Object.entries(plans)
    .filter(([id]) => !upcoming.some(([u]) => u === id))
    .sort((a, b) => b[1].createdAt.localeCompare(a[1].createdAt))
    .slice(0, 8);
  const seenAt = store.history.activitySeenAt;
  const alerts = useMemo(() => activityFor(plans, profile).filter((i) => isNew(i, seenAt)).length, [plans, profile, seenAt]);

  // The feed: ideas that match who they go out with and their moods first, mixed with saved places, a poll and a sponsored pick.
  const ideas = useMemo(() => {
    const score = (e: (typeof examplePrompts)[number]) =>
      (profile.onboarded && e.who === profile.companions ? 3 : 0) + (e.vibes ?? []).filter((v) => profile.vibes.includes(v as never)).length;
    return [...examplePrompts].sort((a, b) => score(b) - score(a));
  }, [profile.vibes, profile.companions, profile.onboarded]);
  const firstRun = Object.keys(plans).length === 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.canvas }} edges={["top"]}>
      <ScrollView contentContainerStyle={s.page}>
        <View style={s.header}>
          <Wordmark size={22} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            {demo ? (
              <View style={s.demoPill} accessibilityLabel="Demo mode">
                <T v="smallStrong" tone={color.warning} style={{ fontSize: 13 }}>
                  Demo data
                </T>
              </View>
            ) : null}
            <Press testID="home-activity" accessibilityRole="button" accessibilityLabel={alerts ? `Activity, ${alerts} new` : "Activity"} onPress={() => router.push("/activity")} hitSlop={8} style={s.bell}>
              <Icon name="bell" size={22} />
              {alerts ? (
                <View style={s.badge}>
                  <T style={s.badgeText}>{alerts > 9 ? "9+" : alerts}</T>
                </View>
              ) : null}
            </Press>
          </View>
        </View>

        <Animated.View entering={FadeInDown.duration(240)} style={{ gap: 4 }}>
          <T v="small" tone={color.muted}>
            {greeting(profile.name)}
          </T>
          <T v="hero" accessibilityRole="header">
            What should we do?
          </T>
        </Animated.View>

        <Press testID="home-start" accessibilityRole="button" accessibilityLabel="Tell us the mood, who’s coming, when. Start a plan" onPress={() => router.push("/create")} style={s.start} scaleTo={0.98}>
          <Icon name="edit-3" size={18} tint={color.muted} />
          <T v="body" tone={color.muted} style={{ flex: 1 }}>
            Tell us the mood, who’s coming, when…
          </T>
          <View style={s.startGo}>
            <Icon name="arrow-right" size={18} tint={color.paper} />
          </View>
        </Press>

        {welcome === "back" && !welcomed ? (
          <Press testID="welcome-back" accessibilityRole="button" accessibilityHint="Dismiss" onPress={() => setWelcomed(true)}>
            <Notice icon="check-circle">
              {`Welcome back${profile.name ? `, ${profile.name}` : ""}. Your taste profile${Number(restoredPlans) > 0 ? ` and ${restoredPlans} saved plan${restoredPlans === "1" ? "" : "s"} are` : " is"} back on this device.`}
            </Notice>
          </Press>
        ) : null}
        {!status ? (
          <Notice tone="coral" icon="wifi-off">
            Can’t reach Whimway right now. Your plans are still here; new plans need a connection.
          </Notice>
        ) : null}

        {firstRun ? (
          <Animated.View entering={FadeInDown.duration(240)} style={s.firstRun} testID="home-first-run">
            <T v="title">Your first plan</T>
            <T v="body" tone={color.inkSoft}>
              {profile.vibes.length ? `Tuned for ${profile.vibes.slice(0, 2).join(" and ")} moods. ` : ""}Tap Plan below any time, or let us pick something now.
            </T>
            <View style={{ flexDirection: "row", gap: space.sm, marginTop: space.xs }}>
              <Button kind="dark" icon="shuffle" label="Surprise me" onPress={() => router.push({ pathname: "/create", params: { surprise: "1" } })} style={{ flex: 1 }} testID="home-surprise" />
              <Button kind="soft" label="Describe it" onPress={() => router.push("/create")} style={{ flex: 1 }} />
            </View>
          </Animated.View>
        ) : null}

        <TodayCard plans={plans} />

        <PeopleRow onEdit={setEditingPerson} />

        {upcoming.length ? (
          <Section title="Coming up" onMore={() => router.push("/saved")}>
            <PlanCards entries={upcoming} prefix="upcoming" />
          </Section>
        ) : null}

        <Section title="Ideas for you">
          <View style={{ gap: space.md }}>
            {ideas.map((e, i) => (
              <View key={e.title} style={{ gap: space.md }}>
                <IdeaCard icon={e.icon} title={e.title} body={`“${e.prompt}”`} tint={tints[i % 4]} onPress={() => router.push({ pathname: "/create", params: { starter: e.prompt } })} />
                {i === 0 && profile.favourites[0] ? (
                  <IdeaCard icon="heart" title={`Around ${profile.favourites[0].name}`} body="A whole outing built around a place you saved." tint={color.paper} onPress={() => planAround(profile.favourites[0], profile, store)} />
                ) : null}
                {i === 1 ? <PollCard /> : null}
                {i === 2 ? <Sponsored surface="home" point={area.center} /> : null}
                {i === 3 ? (
                  <IdeaCard testID="home-discover" icon="compass" title="Open near you right now" body={`Food, games, shows and more around ${area.name}.`} tint={color.paper} onPress={() => router.push({ pathname: "/discover", params: { when: "now" } })} />
                ) : null}
              </View>
            ))}
          </View>
        </Section>

        {recent.length ? (
          <Section title="Recently created" onMore={() => router.push("/profile")}>
            <PlanCards entries={recent} prefix="recent" />
          </Section>
        ) : null}
      </ScrollView>
      <PersonSheet person={editingPerson} onClose={() => setEditingPerson(null)} />
    </SafeAreaView>
  );
}

function Section({ title, onMore, children }: { title: string; onMore?: () => void; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.md }}>
      <View style={s.sectionRow}>
        <T v="heading">{title}</T>
        {onMore ? (
          <Press accessibilityRole="button" accessibilityLabel={`See all ${title.toLowerCase()}`} onPress={onMore} hitSlop={10} style={{ minHeight: 44, justifyContent: "center" }}>
            <T v="smallStrong" tone={color.coralText}>
              See all
            </T>
          </Press>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function IdeaCard({ icon, title, body, tint, onPress, testID }: { icon: IconName; title: string; body: string; tint: string; onPress: () => void; testID?: string }) {
  return (
    <Press testID={testID} accessibilityRole="button" accessibilityLabel={`${title}. ${body}`} onPress={onPress} style={[s.idea, { backgroundColor: tint }]} scaleTo={0.98}>
      <View style={s.ideaIcon}>
        <Icon name={icon} size={20} />
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <T v="bodyStrong">{title}</T>
        <T v="small" tone={color.inkSoft} numberOfLines={3}>
          {body}
        </T>
      </View>
      <Icon name="chevron-right" tint={color.inkSoft} />
    </Press>
  );
}

const s = StyleSheet.create({
  page: { padding: space.xl, paddingBottom: space.xxxl, gap: space.xl, maxWidth: 680, width: "100%", alignSelf: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  demoPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: color.yellowTint },
  bell: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  badge: { position: "absolute", top: 6, right: 4, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: color.coral, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: color.canvas },
  badgeText: { fontFamily: font.bodyBold, fontSize: 13, lineHeight: 12, color: color.ink },
  start: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 56, paddingLeft: space.lg, paddingRight: 6, borderRadius: radius.pill, backgroundColor: color.paper, borderWidth: 1.5, borderColor: color.line },
  startGo: { width: 44, height: 44, borderRadius: 22, backgroundColor: color.ink, alignItems: "center", justifyContent: "center" },
  sectionRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  idea: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: color.line, minHeight: 84 },
  firstRun: { gap: space.sm, padding: space.xl, borderRadius: radius.xl, backgroundColor: color.yellowTint, borderWidth: 1, borderColor: color.line },
  ideaIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: color.paper, alignItems: "center", justifyContent: "center" },
});
