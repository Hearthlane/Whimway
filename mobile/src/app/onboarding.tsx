import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { areas } from "@shared/areas";
import type { TasteProfile } from "@shared/profile";
import { companions as companionKeys, interests as interestKeys, vibes as vibeKeys } from "@shared/schema";
import { useStore } from "@/lib/store";
import { companionCopy, interestCopy, modeCopy, vibeCopy } from "@/lib/copy";
import { Button, Chip, Icon, T, tap, Wordmark, type IconName } from "@/ui/kit";
import { color, font, radius, shadow, space } from "@/ui/theme";

const budgets = [
  { value: 20, label: "Under $25", hint: "Free stuff, cheap eats" },
  { value: 45, label: "$25–60", hint: "A nice night out" },
  { value: 80, label: "$60–100", hint: "Treat yourselves" },
  { value: 150, label: "$100+", hint: "Go big sometimes" },
];
const steps = ["welcome", "who", "vibes", "interests", "budget", "area", "details"] as const;

function Tile({ icon, label, hint, selected, onPress, testID }: { icon?: IconName; label: string; hint?: string; selected: boolean; onPress: () => void; testID?: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={hint ? `${label}. ${hint}` : label}
      onPress={() => {
        tap("select");
        onPress();
      }}
      style={({ pressed }) => [s.tile, selected && s.tileOn, pressed && { transform: [{ scale: 0.98 }] }]}
    >
      {icon ? (
        <View style={[s.tileIcon, selected && { backgroundColor: color.coral }]}>
          <Icon name={icon} size={18} tint={color.ink} />
        </View>
      ) : null}
      <T v="bodyStrong" tone={selected ? color.paper : color.ink}>
        {label}
      </T>
      {hint ? (
        <T v="small" tone={selected ? "#C9D1D6" : color.muted}>
          {hint}
        </T>
      ) : null}
      {selected ? (
        <View style={s.check}>
          <Icon name="check" size={13} tint={color.ink} />
        </View>
      ) : null}
    </Pressable>
  );
}

export default function Onboarding() {
  const { profile, setProfile, track } = useStore();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<TasteProfile>({ ...profile, analytics: true });
  const set = (patch: Partial<TasteProfile>) => setDraft((d) => ({ ...d, ...patch }));
  const toggle = <K extends "vibes" | "interests">(key: K, value: TasteProfile[K][number], max: number) =>
    setDraft((d) => {
      const list = d[key] as string[];
      const next = list.includes(value) ? list.filter((x) => x !== value) : [...list, value].slice(-max);
      return { ...d, [key]: next };
    });
  useEffect(() => {
    track("onboarding_started");
  }, [track]);

  const finish = (skipped = false) => {
    setProfile({ ...draft, onboarded: true });
    track(skipped ? "onboarding_skipped" : "onboarding_completed", { step: steps[step] });
    tap("success");
    router.replace("/");
  };
  const next = () => (step === steps.length - 1 ? finish() : setStep(step + 1));
  const current = steps[step];

  return (
    <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
      <View style={s.top}>
        {step > 0 ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => setStep(step - 1)} hitSlop={10} style={s.topButton}>
            <Icon name="arrow-left" />
          </Pressable>
        ) : (
          <View style={s.topButton} />
        )}
        <View style={s.progress} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: steps.length - 1, now: step }}>
          {steps.slice(1).map((_, i) => (
            <View key={i} style={[s.dot, i < step && { backgroundColor: color.ink }]} />
          ))}
        </View>
        <Pressable accessibilityRole="button" onPress={() => finish(true)} hitSlop={10} style={[s.topButton, { width: 56 }]} testID="onboarding-skip">
          <T v="smallStrong" tone={color.muted}>
            Skip
          </T>
        </Pressable>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        <Animated.View key={current} entering={FadeInDown.duration(320)}>
          {current === "welcome" ? (
            <View style={{ gap: space.xl, paddingTop: space.xl }}>
              <Wordmark size={28} />
              <View style={s.heroCard}>
                <T v="eyebrow" tone={color.coralText}>
                  Your experience companion
                </T>
                <T v="hero" style={{ marginTop: space.md }}>
                  From “what should we do?” to “we’re going” in under a minute.
                </T>
                <T v="body" tone={color.muted} style={{ marginTop: space.md }}>
                  Tell us the mood, the budget and who’s coming. We’ll turn it into a real plan with real places, times and routes you can actually follow.
                </T>
              </View>
              <T v="small" tone={color.muted}>
                Five quick taps so your first plan already feels like you. Skip anything.
              </T>
            </View>
          ) : null}

          {current === "who" ? (
            <>
              <T v="title">Who are you usually planning for?</T>
              <T v="body" tone={color.muted} style={s.sub}>
                You can always change it per plan.
              </T>
              <View style={s.grid}>
                {companionKeys.map((c) => (
                  <Tile key={c} testID={`who-${c}`} icon={companionCopy[c].icon} label={companionCopy[c].label} hint={companionCopy[c].hint} selected={draft.companions === c} onPress={() => set({ companions: c })} />
                ))}
              </View>
            </>
          ) : null}

          {current === "vibes" ? (
            <>
              <T v="title">What kind of nights make you feel most alive?</T>
              <T v="body" tone={color.muted} style={s.sub}>
                Pick up to four.
              </T>
              <View style={s.grid}>
                {vibeKeys.map((v) => (
                  <Tile key={v} testID={`vibe-${v}`} icon={vibeCopy[v].icon} label={vibeCopy[v].label} hint={vibeCopy[v].hint} selected={draft.vibes.includes(v)} onPress={() => toggle("vibes", v, 4)} />
                ))}
              </View>
            </>
          ) : null}

          {current === "interests" ? (
            <>
              <T v="title">What do you love doing?</T>
              <T v="body" tone={color.muted} style={s.sub}>
                We’ll lean toward these when you don’t say otherwise.
              </T>
              <View style={s.chips}>
                {interestKeys.map((i) => (
                  <Chip key={i} icon={interestCopy[i]} label={i} selected={draft.interests.includes(i)} onPress={() => toggle("interests", i, 6)} />
                ))}
              </View>
            </>
          ) : null}

          {current === "budget" ? (
            <>
              <T v="title">A typical night out, per person?</T>
              <View style={s.grid}>
                {budgets.map((b) => (
                  <Tile key={b.value} label={b.label} hint={b.hint} selected={draft.budget === b.value} onPress={() => set({ budget: b.value })} />
                ))}
              </View>
              <T v="heading" style={{ marginTop: space.xl }}>
                How do you usually get around?
              </T>
              <View style={[s.chips, { marginTop: space.md }]}>
                {(["WALK", "TRANSIT", "DRIVE"] as const).map((m) => (
                  <Chip key={m} icon={modeCopy[m].icon} label={modeCopy[m].label} selected={draft.mode === m} onPress={() => set({ mode: m })} />
                ))}
              </View>
            </>
          ) : null}

          {current === "area" ? (
            <>
              <T v="title">Where do you usually start from?</T>
              <T v="body" tone={color.muted} style={s.sub}>
                We’re launching across the Greater Toronto Area.
              </T>
              <View style={{ gap: space.sm, marginTop: space.lg }}>
                {areas.map((a) => (
                  <Pressable
                    key={a.key}
                    testID={`area-${a.key}`}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: draft.homeArea === a.key }}
                    onPress={() => {
                      tap("select");
                      set({ homeArea: a.key });
                    }}
                    style={[s.row, draft.homeArea === a.key && { borderColor: color.ink, backgroundColor: color.paper }]}
                  >
                    <Icon name="map-pin" size={16} tint={draft.homeArea === a.key ? color.coralText : color.muted} />
                    <T v="bodyStrong" style={{ flex: 1 }}>
                      {a.name}
                    </T>
                    <T v="small" tone={color.muted}>
                      {a.city}
                    </T>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}

          {current === "details" ? (
            <>
              <T v="title">Last thing — anything we should know?</T>
              <T v="body" tone={color.muted} style={s.sub}>
                All optional. Requirements are passed to the planner; always confirm with venues.
              </T>
              <T v="smallStrong" style={s.label} nativeID="name-label">
                What should we call you?
              </T>
              <TextInput accessibilityLabelledBy="name-label" value={draft.name} onChangeText={(name) => set({ name: name.slice(0, 40) })} placeholder="First name" placeholderTextColor={color.faint} style={s.input} />
              <T v="smallStrong" style={s.label} nativeID="diet-label">
                Dietary needs
              </T>
              <TextInput accessibilityLabelledBy="diet-label" value={draft.dietary} onChangeText={(dietary) => set({ dietary: dietary.slice(0, 300) })} placeholder="e.g. vegetarian, halal, nut allergy" placeholderTextColor={color.faint} style={s.input} />
              <T v="smallStrong" style={s.label} nativeID="access-label">
                Accessibility
              </T>
              <TextInput accessibilityLabelledBy="access-label" value={draft.accessibility} onChangeText={(accessibility) => set({ accessibility: accessibility.slice(0, 300) })} placeholder="e.g. step-free access" placeholderTextColor={color.faint} style={s.input} />
              <View style={s.consent}>
                <View style={{ flex: 1, gap: 4 }}>
                  <T v="bodyStrong">Help improve Whimway</T>
                  <T v="small" tone={color.muted}>
                    Share anonymous usage (e.g. “plan saved”). Never your prompts, location or places. Change anytime in You.
                  </T>
                </View>
                <Switch value={draft.analytics} onValueChange={(analytics) => set({ analytics })} trackColor={{ true: color.ink, false: color.line }} thumbColor={color.paper} accessibilityLabel="Share anonymous usage" />
              </View>
            </>
          ) : null}
        </Animated.View>
      </ScrollView>
      <View style={s.footer}>
        <Button
          testID="onboarding-next"
          size="lg"
          label={current === "welcome" ? "Let’s go" : step === steps.length - 1 ? "Start planning" : "Continue"}
          icon={step === steps.length - 1 ? "star" : "arrow-right"}
          onPress={next}
        />
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.canvas },
  top: { flexDirection: "row", alignItems: "center", paddingHorizontal: space.lg, paddingTop: space.sm, gap: space.md },
  topButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  progress: { flex: 1, flexDirection: "row", gap: 6 },
  dot: { flex: 1, height: 4, borderRadius: 2, backgroundColor: color.line },
  body: { padding: space.xl, paddingBottom: space.xxl, maxWidth: 640, width: "100%", alignSelf: "center" },
  heroCard: { backgroundColor: color.paper, borderRadius: radius.xl, padding: space.xl, borderWidth: 1, borderColor: color.line, ...shadow.card },
  sub: { marginTop: space.sm },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.md, marginTop: space.xl },
  tile: { width: "47%", flexGrow: 1, minHeight: 112, padding: space.lg, borderRadius: radius.lg, backgroundColor: color.paper, borderWidth: 1, borderColor: color.line, gap: 6 },
  tileOn: { backgroundColor: color.ink, borderColor: color.ink },
  tileIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: color.mintTint, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  check: { position: "absolute", top: 12, right: 12, width: 22, height: 22, borderRadius: 11, backgroundColor: color.coral, alignItems: "center", justifyContent: "center" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.xl },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 52, paddingHorizontal: space.lg, borderRadius: radius.md, borderWidth: 1, borderColor: color.line, backgroundColor: color.canvas },
  label: { marginTop: space.lg, marginBottom: 6 },
  input: { minHeight: 50, borderRadius: radius.md, borderWidth: 1, borderColor: color.line, backgroundColor: color.paper, paddingHorizontal: space.lg, fontFamily: font.body, fontSize: 16, color: color.ink },
  consent: { flexDirection: "row", gap: space.lg, alignItems: "center", marginTop: space.xl, padding: space.lg, backgroundColor: color.paper, borderRadius: radius.lg, borderWidth: 1, borderColor: color.line },
  footer: { padding: space.lg, backgroundColor: color.canvas, borderTopWidth: 1, borderTopColor: color.line },
});
