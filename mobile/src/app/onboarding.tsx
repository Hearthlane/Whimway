import { router } from "expo-router";
import { useEffect, useState } from "react";
import { StopArt } from "@/plan/StopArt";
import { Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from "react-native";
import Animated, { FadeIn, FadeInDown, FadeInUp, ZoomIn, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { areas } from "@shared/areas";
import type { TasteProfile } from "@shared/profile";
import { companions as companionKeys, interests as interestKeys, vibes as vibeKeys } from "@shared/schema";
import { useStore } from "@/lib/store";
import { companionCopy, interestCopy, modeCopy, vibeCopy } from "@/lib/copy";
import { Button, Chip, Icon, Press, Spark, T, tap, Wordmark, type IconName } from "@/ui/kit";
import { color, font, motion, radius, shadow, space } from "@/ui/theme";

const budgets = [
  { value: 20, label: "Under $25", hint: "Free stuff, cheap eats" },
  { value: 45, label: "$25–60", hint: "A nice night out" },
  { value: 80, label: "$60–100", hint: "Treat yourselves" },
  { value: 150, label: "$100+", hint: "Go big sometimes" },
];
const steps = ["welcome", "who", "vibes", "interests", "budget", "area", "details", "reveal"] as const;

// Personality reveal: first vibe gives the adjective, second the noun.
const adjective: Record<string, string> = { romantic: "Romantic", adventurous: "Bold", cozy: "Cozy", cinematic: "Cinematic", chill: "Easygoing", lively: "Lively", artsy: "Artsy", foodie: "Hungry", outdoorsy: "Fresh-Air", playful: "Playful" };
const noun: Record<string, string> = { romantic: "Romantic", adventurous: "Adventurer", cozy: "Nester", cinematic: "Scene-Seeker", chill: "Wanderer", lively: "Night Owl", artsy: "Aesthete", foodie: "Taster", outdoorsy: "Rambler", playful: "Game-Starter" };
export function persona(vibes: string[]) {
  if (!vibes.length) return "Open-Minded Explorer";
  if (vibes.length === 1) return `The ${noun[vibes[0]]}`;
  return `${adjective[vibes[0]]} ${noun[vibes[1]]}`;
}
function starterPrompt(p: TasteProfile) {
  const mood = p.vibes.slice(0, 2).join(" and ") || "memorable";
  const who = { partner: "with my partner", friends: "with friends", solo: "just for me", family: "with the family" }[p.companions];
  return `A ${mood} night ${who} this Saturday`;
}

/** Welcome hero: the product in miniature. A sentence goes in, a night comes out. */
function MiniDemo() {
  const stops = [
    { time: "7:00", name: "Sunset walk", place: { category: "park", types: ["park"] } },
    { time: "8:15", name: "Dinner for two", place: { category: "restaurant", types: ["restaurant"] } },
    { time: "9:45", name: "Something sweet", place: { category: "dessert", types: ["ice_cream_shop"] } },
  ];
  return (
    <View style={s.demo} accessibilityLabel="Example: a sentence becomes a three-stop plan" accessible>
      <Animated.View entering={FadeInDown.delay(250).duration(motion.slow)} style={s.bubble}>
        <T v="body" tone={color.paper}>
          “Romantic night, $100, not too far”
        </T>
      </Animated.View>
      <Animated.View entering={ZoomIn.delay(900).duration(motion.standard)} style={s.demoSpark}>
        <Spark size={30} />
      </Animated.View>
      <View style={s.demoStops}>
        {stops.map((st, i) => (
          <Animated.View key={st.name} entering={FadeInUp.delay(1250 + i * 220).duration(motion.slow)} style={s.demoStop}>
            <StopArt place={st.place} height={62} />
            <View style={{ padding: 8 }}>
              <T v="smallStrong" style={{ fontSize: 11, lineHeight: 14 }} tone={color.coralText}>
                {st.time}
              </T>
              <T v="smallStrong" style={{ fontSize: 12, lineHeight: 15 }} numberOfLines={2}>
                {st.name}
              </T>
            </View>
          </Animated.View>
        ))}
      </View>
    </View>
  );
}

function ProgressBar({ value }: { value: number }) {
  const w = useSharedValue(value);
  useEffect(() => {
    w.value = withTiming(value, { duration: motion.standard });
  }, [value, w]);
  const fill = useAnimatedStyle(() => ({ width: `${w.value * 100}%` }));
  return (
    <View style={s.progress} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}>
      <Animated.View style={[s.progressFill, fill]} />
    </View>
  );
}

function Tile({ icon, label, hint, selected, onPress, testID }: { icon?: IconName; label: string; hint?: string; selected: boolean; onPress: () => void; testID?: string }) {
  return (
    <Press
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={hint ? `${label}. ${hint}` : label}
      onPress={() => {
        tap("select");
        onPress();
      }}
      style={[s.tile, selected && s.tileOn]}
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
        <Animated.View entering={ZoomIn.springify().damping(12)} style={s.check}>
          <Icon name="check" size={13} tint={color.ink} />
        </Animated.View>
      ) : null}
    </Press>
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
    router.replace(skipped ? "/" : { pathname: "/", params: { starter: starterPrompt(draft) } });
  };
  const next = () => (step === steps.length - 1 ? finish() : setStep(step + 1));
  const isReveal = steps[step] === "reveal";
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
        <ProgressBar value={step / (steps.length - 1)} />
        {isReveal ? (
          <View style={[s.topButton, { width: 56 }]} />
        ) : (
          <Pressable accessibilityRole="button" onPress={() => finish(true)} hitSlop={10} style={[s.topButton, { width: 56 }]} testID="onboarding-skip">
            <T v="smallStrong" tone={color.muted}>
              Skip
            </T>
          </Pressable>
        )}
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        <Animated.View key={current} entering={FadeInDown.duration(320)}>
          {current === "welcome" ? (
            <View style={{ gap: space.xl }}>
              <Wordmark size={24} />
              <MiniDemo />
              <View style={{ gap: space.md }}>
                <T v="hero" style={{ fontSize: 30, lineHeight: 35 }} accessibilityRole="header">
                  From “what should we do?” to “we’re going” in under a minute.
                </T>
                <T v="body" tone={color.muted}>
                  Say the mood, the budget and who’s coming. Get a night of real places, with times and routes you can follow.
                </T>
              </View>
            </View>
          ) : null}

          {current === "reveal" ? (
            <View style={{ gap: space.xl, alignItems: "center", paddingTop: space.lg }}>
              <Animated.View entering={ZoomIn.springify().damping(11)} style={s.revealMark}>
                <Spark size={64} />
              </Animated.View>
              <Animated.View entering={FadeInDown.delay(250).duration(motion.slow)} style={{ alignItems: "center", gap: space.sm }}>
                <T v="body" tone={color.muted}>
                  {draft.name ? `${draft.name}, you’re a` : "You’re a"}
                </T>
                <T v="hero" style={{ textAlign: "center" }} testID="persona" accessibilityRole="header">
                  {persona(draft.vibes)}
                </T>
              </Animated.View>
              <Animated.View entering={FadeIn.delay(600).duration(motion.slow)} style={s.revealCard}>
                <RevealRow icon={companionCopy[draft.companions].icon} label="Usually out" value={{ partner: "with my partner", friends: "with friends", solo: "on my own", family: "with family" }[draft.companions]} />
                <RevealRow icon="credit-card" label="Comfortable spend" value={`about $${draft.budget} each`} />
                <RevealRow icon={modeCopy[draft.mode].icon} label="Getting around" value={modeCopy[draft.mode].label.toLowerCase()} />
                <RevealRow icon="map-pin" label="Home base" value={areas.find((a) => a.key === draft.homeArea)?.name ?? "Greater Toronto"} last />
              </Animated.View>
              <Animated.View entering={FadeIn.delay(850).duration(motion.slow)}>
                <T v="small" tone={color.muted} style={{ textAlign: "center", maxWidth: 300 }}>
                  Every plan you rate and every poll you answer sharpens this.
                </T>
              </Animated.View>
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
          label={current === "welcome" ? "Get started" : isReveal ? "Plan my first night" : "Continue"}
          icon={isReveal ? "star" : "arrow-right"}
          onPress={next}
        />
      </View>
    </SafeAreaView>
  );
}

function RevealRow({ icon, label, value, last }: { icon: IconName; label: string; value: string; last?: boolean }) {
  return (
    <View style={[s.revealRow, !last && { borderBottomWidth: 1, borderBottomColor: color.line }]}>
      <Icon name={icon} size={16} tint={color.muted} />
      <T v="small" tone={color.muted} style={{ flex: 1 }}>
        {label}
      </T>
      <T v="bodyStrong">{value}</T>
    </View>
  );
}

const s = StyleSheet.create({
  demo: { backgroundColor: color.ink, borderRadius: radius.xl, padding: space.lg, gap: space.md, ...shadow.lift },
  bubble: { alignSelf: "flex-start", backgroundColor: "rgba(255,255,255,0.12)", paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.md, borderBottomLeftRadius: 4 },
  demoSpark: { alignSelf: "center", width: 40, height: 40, borderRadius: 14, backgroundColor: color.coral, alignItems: "center", justifyContent: "center" },
  demoStops: { flexDirection: "row", gap: space.sm },
  demoStop: { flex: 1, backgroundColor: color.paper, borderRadius: radius.md, overflow: "hidden" },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: color.ink },
  revealMark: { width: 92, height: 92, borderRadius: 30, backgroundColor: color.coral, alignItems: "center", justifyContent: "center", ...shadow.lift },
  revealCard: { alignSelf: "stretch", backgroundColor: color.paper, borderRadius: radius.lg, borderWidth: 1, borderColor: color.line, paddingHorizontal: space.lg },
  revealRow: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 52 },
  safe: { flex: 1, backgroundColor: color.canvas },
  top: { flexDirection: "row", alignItems: "center", paddingHorizontal: space.lg, paddingTop: space.sm, gap: space.md },
  topButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  progress: { flex: 1, height: 4, borderRadius: 2, backgroundColor: color.line, overflow: "hidden" },
  body: { padding: space.xl, paddingBottom: space.xxl, maxWidth: 640, width: "100%", alignSelf: "center" },
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
