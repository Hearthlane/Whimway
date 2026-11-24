import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, TextInput, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { areaByKey, areas } from "@shared/areas";
import { groupByKey } from "@shared/guide";
import { vibes as vibeKeys } from "@shared/schema";
import { companionCopy, modeCopy, vibeCopy } from "@/lib/copy";
import { useStore } from "@/lib/store";
import { Avatar, PersonSheet, planWith, type Person } from "@/home/People";
import { PlanTile, startOf } from "@/home/Plans";
import { persona } from "@/app/onboarding";
import { cloudConfigured } from "@/lib/config";
import { Button, Chip, Icon, IconButton, Press, Sheet, T, tap, type IconName } from "@/ui/kit";
import { color, font, radius, space } from "@/ui/theme";

type Tab = "plans" | "people";
const tabs: { key: Tab; icon: IconName; label: string }[] = [
  { key: "plans", icon: "grid", label: "Plans" },
  { key: "people", icon: "users", label: "People" },
];

export default function Profile() {
  const store = useStore();
  const { profile, plans } = store;
  const params = useLocalSearchParams<{ tab?: string; edit?: string }>();
  const [tab, setTab] = useState<Tab>("plans");
  // "See all" on home opens a specific tab.
  const [asked, setAsked] = useState(params.tab);
  if (params.tab !== asked) {
    setAsked(params.tab);
    // Saved places live in the Saved tab now.
    if (params.tab === "places") router.replace({ pathname: "/saved", params: { tab: "places" } });
    else if (params.tab === "people" || params.tab === "plans") setTab(params.tab);
  }
  const [editing, setEditing] = useState(params.edit === "1");
  const [askedEdit, setAskedEdit] = useState(params.edit);
  if (params.edit !== askedEdit) {
    setAskedEdit(params.edit);
    if (params.edit === "1") setEditing(true);
  }
  const [person, setPerson] = useState<Person | "new" | null>(null);

  const nightsOut = Object.values(plans).filter((p) => p.feedback && p.feedback.went !== "no").length;
  const grid = Object.entries(plans).sort((a, b) => startOf(b[1]).toMillis() - startOf(a[1]).toMillis());
  const area = areaByKey(profile.homeArea)?.name ?? "GTA";
  const name = profile.name || "You";
  const stats = [
    { value: grid.length, label: grid.length === 1 ? "plan" : "plans", tab: "plans" as Tab },
    { value: nightsOut, label: nightsOut === 1 ? "outing done" : "outings done", tab: "plans" as Tab },
    { value: profile.favourites.length, label: profile.favourites.length === 1 ? "place" : "places", tab: "places" as const },
    { value: profile.people.length, label: profile.people.length === 1 ? "person" : "people", tab: "people" as Tab },
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.canvas }} edges={["top"]}>
      <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
        <View style={s.top}>
          <T v="title" numberOfLines={1} style={{ flex: 1 }} accessibilityRole="header">
            {name}
          </T>
          <IconButton icon="clock" label="History" onPress={() => router.push("/history")} />
          <IconButton icon="settings" label="Settings" onPress={() => router.push("/settings")} />
        </View>

        <View style={s.head}>
          <Avatar name={name} size={84} ring />
          <View style={s.stats} testID="your-nights">
            {stats.map((st) => (
              <Press key={st.label} accessibilityRole="button" accessibilityLabel={`${st.value} ${st.label}`} onPress={() => (st.tab === "places" ? router.push({ pathname: "/saved", params: { tab: "places" } }) : setTab(st.tab))} style={s.stat}>
                <T style={s.statValue}>{st.value}</T>
                <T v="small" tone={color.muted} style={{ fontSize: 12, textAlign: "center" }}>
                  {st.label}
                </T>
              </Press>
            ))}
          </View>
        </View>

        <View style={{ gap: 4 }}>
          <T v="bodyStrong">{persona(profile.vibes)}</T>
          <T v="small" tone={color.muted}>
            {[companionCopy[profile.companions].label, area, `~$${profile.budget} pp`].join(" · ")}
          </T>
          {profile.vibes.length ? (
            <View style={[s.chips, { marginTop: space.sm }]}>
              {profile.vibes.map((v) => (
                <Chip key={v} icon={vibeCopy[v].icon} label={vibeCopy[v].label} tone="lavender" />
              ))}
            </View>
          ) : null}
        </View>

        <View style={s.buttons}>
          <Button kind="soft" label="Edit profile" onPress={() => setEditing(true)} style={{ flex: 1 }} testID="edit-profile" />
          <Button kind="soft" label="Add person" icon="user-plus" onPress={() => setPerson("new")} style={{ flex: 1 }} />
        </View>

        {cloudConfigured && !store.session ? (
          <Press testID="profile-save-account" accessibilityRole="button" onPress={() => router.push("/settings")} style={s.save}>
            <Icon name="cloud" size={18} />
            <View style={{ flex: 1 }}>
              <T v="bodyStrong">Save your profile</T>
              <T v="small" tone={color.muted}>
                Sign in with your email to keep it on every device.
              </T>
            </View>
            <Icon name="chevron-right" tint={color.faint} />
          </Press>
        ) : store.session ? (
          <View style={s.synced} testID="profile-synced">
            <Icon name="check-circle" size={14} tint={color.muted} />
            <T v="small" tone={color.muted} numberOfLines={1}>
              Synced to {store.session.user.email}
            </T>
          </View>
        ) : null}

        <View style={s.tabs} accessibilityRole="tablist">
          {tabs.map((t) => (
            <Press key={t.key} testID={`profile-tab-${t.key}`} accessibilityRole="tab" accessibilityState={{ selected: tab === t.key }} accessibilityLabel={t.label} onPress={() => (tap("select"), setTab(t.key))} style={[s.tab, tab === t.key && s.tabOn]}>
              <Icon name={t.icon} size={18} tint={tab === t.key ? color.ink : color.faint} />
              <T v="smallStrong" tone={tab === t.key ? color.ink : color.faint}>
                {t.label}
              </T>
            </Press>
          ))}
        </View>

        <Animated.View key={tab} entering={FadeIn.duration(200)}>
          {tab === "plans" ? (
            grid.length ? (
              <View style={s.grid}>
                {grid.map(([id, e]) => (
                  <View key={id} style={s.cell}>
                    <PlanTile id={id} entry={e} />
                  </View>
                ))}
              </View>
            ) : (
              <Empty icon="calendar" text="Plans you make show up here, newest first." action="Plan something" onPress={() => router.push("/")} />
            )
          ) : null}

          {tab === "people" ? (
            profile.people.length ? (
              <View style={{ gap: space.sm }}>
                {profile.people.map((p) => (
                  <Press key={p.id} testID={`people-row-${p.id}`} accessibilityRole="button" accessibilityLabel={`Edit ${p.name}`} onPress={() => setPerson(p)} style={s.row}>
                    <Avatar name={p.name} size={44} />
                    <View style={{ flex: 1 }}>
                      <T v="bodyStrong" numberOfLines={1}>
                        {p.name}
                      </T>
                      <T v="small" tone={color.muted} numberOfLines={1}>
                        {[{ partner: "Partner", friend: "Friend", family: "Family" }[p.relation], ...p.likes.slice(0, 3).map((k) => groupByKey(k)?.label ?? k)].join(" · ")}
                      </T>
                    </View>
                    <Button kind="soft" label="Plan" onPress={() => planWith(p)} />
                  </Press>
                ))}
              </View>
            ) : (
              <Empty icon="users" text="Add the people you go out with and what they enjoy. Planning with them puts their favourites first." action="Add someone" onPress={() => setPerson("new")} />
            )
          ) : null}
        </Animated.View>
      </ScrollView>

      <EditProfile open={editing} onClose={() => setEditing(false)} />
      <PersonSheet person={person} onClose={() => setPerson(null)} />
    </SafeAreaView>
  );
}

function Empty({ icon, text, action, onPress }: { icon: IconName; text: string; action: string; onPress: () => void }) {
  return (
    <View style={s.empty}>
      <View style={s.emptyIcon}>
        <Icon name={icon} size={22} />
      </View>
      <T v="small" tone={color.muted} style={{ textAlign: "center", maxWidth: 300 }}>
        {text}
      </T>
      <Button kind="dark" label={action} onPress={onPress} />
    </View>
  );
}

/** Name, home area and vibes. Everything else lives in Settings. */
function EditProfile({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { profile, setProfile } = useStore();
  const [name, setName] = useState(profile.name);
  const [home, setHome] = useState(profile.homeArea);
  const [vibes, setVibes] = useState(profile.vibes);
  const [dietary, setDietary] = useState(profile.dietary);
  const [accessibility, setAccessibility] = useState(profile.accessibility);
  const [alcoholFree, setAlcoholFree] = useState(profile.alcoholFree);
  const [budget, setBudget] = useState(profile.budget);
  const [mode, setMode] = useState(profile.mode);
  // Start from the saved profile each time the sheet opens.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName(profile.name);
      setHome(profile.homeArea);
      setVibes(profile.vibes);
      setDietary(profile.dietary);
      setAccessibility(profile.accessibility);
      setAlcoholFree(profile.alcoholFree);
      setBudget(profile.budget);
      setMode(profile.mode);
    }
  }
  const save = () => {
    setProfile({ ...profile, name: name.trim().slice(0, 40), homeArea: home, vibes, dietary: dietary.slice(0, 300), accessibility: accessibility.slice(0, 300), alcoholFree, budget, mode });
    tap("success");
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title="Edit profile" footer={<Button testID="edit-profile-save" label="Save" kind="dark" onPress={save} />}>
      <View style={{ gap: space.lg }}>
        <View style={{ alignItems: "center" }}>
          <Avatar name={name || "You"} size={72} />
        </View>
        <View style={{ gap: space.sm }}>
          <T v="smallStrong">Name</T>
          <TextInput value={name} onChangeText={setName} placeholder="Your first name" placeholderTextColor={color.faint} maxLength={40} accessibilityLabel="Name" style={s.input} testID="edit-name" />
        </View>
        <View style={{ gap: space.sm }}>
          <T v="smallStrong">Home area</T>
          <View style={s.chips}>
            {areas.map((a) => (
              <Chip key={a.key} label={a.name} selected={home === a.key} onPress={() => setHome(a.key)} />
            ))}
          </View>
        </View>
        <View style={{ gap: space.sm }}>
          <T v="smallStrong">Your vibe</T>
          <View style={s.chips}>
            {vibeKeys.map((v) => (
              <Chip key={v} icon={vibeCopy[v].icon} label={vibeCopy[v].label} selected={vibes.includes(v)} onPress={() => setVibes(vibes.includes(v) ? vibes.filter((x) => x !== v) : [...vibes, v].slice(-4))} />
            ))}
          </View>
          <T v="small" tone={color.muted}>
            {persona(vibes)}
          </T>
        </View>
        <View style={{ gap: space.sm }}>
          <T v="smallStrong">Usual spend per person</T>
          <View style={s.chips}>
            {[20, 45, 80, 150].map((b) => (
              <Chip key={b} label={b === 20 ? "Under $25" : b === 45 ? "$25–60" : b === 80 ? "$60–100" : "$100+"} selected={budget === b} onPress={() => setBudget(b)} />
            ))}
          </View>
        </View>
        <View style={{ gap: space.sm }}>
          <T v="smallStrong">Getting around</T>
          <View style={s.chips}>
            {(["WALK", "TRANSIT", "DRIVE"] as const).map((m) => (
              <Chip key={m} icon={modeCopy[m].icon} label={modeCopy[m].label} selected={mode === m} onPress={() => setMode(m)} />
            ))}
          </View>
        </View>
        <View style={{ gap: space.sm }}>
          <T v="smallStrong">Food needs</T>
          <TextInput value={dietary} onChangeText={setDietary} placeholder="e.g. vegetarian, halal, nut allergy" placeholderTextColor={color.faint} maxLength={300} accessibilityLabel="Food needs" style={s.input} testID="edit-dietary" />
        </View>
        <View style={{ gap: space.sm }}>
          <T v="smallStrong">Accessibility</T>
          <TextInput value={accessibility} onChangeText={setAccessibility} placeholder="e.g. step-free access, short walks" placeholderTextColor={color.faint} maxLength={300} accessibilityLabel="Accessibility needs" style={s.input} testID="edit-accessibility" />
        </View>
        <Press accessibilityRole="switch" accessibilityState={{ checked: alcoholFree }} onPress={() => setAlcoholFree(!alcoholFree)} style={s.toggle} testID="edit-alcohol-free">
          <View style={{ flex: 1, gap: 2 }}>
            <T v="bodyStrong">Skip bars and drinking spots</T>
            <T v="small" tone={color.muted}>
              Restaurants still count.
            </T>
          </View>
          <View style={[s.knob, alcoholFree && s.knobOn]}>{alcoholFree ? <Icon name="check" size={14} tint={color.paper} /> : null}</View>
        </Press>
      </View>
    </Sheet>
  );
}

const s = StyleSheet.create({
  page: { padding: space.xl, paddingBottom: space.xxxl, gap: space.lg, maxWidth: 680, width: "100%", alignSelf: "center" },
  top: { flexDirection: "row", alignItems: "center", gap: space.md },
  head: { flexDirection: "row", alignItems: "center", gap: space.lg },
  stats: { flex: 1, flexDirection: "row", justifyContent: "space-between" },
  stat: { alignItems: "center", flex: 1, gap: 2 },
  statValue: { fontFamily: font.displayBold, fontSize: 22, lineHeight: 26, color: color.ink },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  buttons: { flexDirection: "row", gap: space.sm },
  save: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.lg, borderRadius: radius.lg, backgroundColor: color.coralTint },
  synced: { flexDirection: "row", alignItems: "center", gap: 6 },
  tabs: { flexDirection: "row", borderBottomWidth: 1, borderColor: color.line, marginHorizontal: -space.xl },
  tab: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: space.md, borderBottomWidth: 2, borderColor: "transparent" },
  tabOn: { borderColor: color.ink },
  grid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -2 },
  cell: { width: "33.333%", padding: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderRadius: radius.lg, backgroundColor: color.paper, borderWidth: 1, borderColor: color.line },
  rowIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: color.coralTint, alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", gap: space.md, paddingVertical: space.xxl },
  emptyIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: color.mintTint, alignItems: "center", justifyContent: "center" },
  toggle: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderRadius: radius.lg, borderWidth: 1, borderColor: color.line, backgroundColor: color.paper },
  knob: { width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, borderColor: color.line, alignItems: "center", justifyContent: "center" },
  knobOn: { backgroundColor: color.ink, borderColor: color.ink },
  input: { minHeight: 50, borderRadius: radius.md, borderWidth: 1.5, borderColor: color.line, backgroundColor: color.paper, paddingHorizontal: space.lg, fontFamily: font.body, fontSize: 16, color: color.ink },
});
