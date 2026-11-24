import { router } from "expo-router";
import { useEffect, useState } from "react";
import { StopArt } from "@/plan/StopArt";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import Animated, { FadeIn, FadeInDown, FadeInUp, SlideInLeft, SlideInRight, ZoomIn, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import * as Location from "expo-location";
import { Avatar, PersonSheet, type Person } from "@/home/People";
import { SafeAreaView } from "react-native-safe-area-context";
import { areas, nearestArea } from "@shared/areas";
import type { TasteProfile } from "@shared/profile";
import { companions as companionKeys, vibes as vibeKeys } from "@shared/schema";
import { useStore } from "@/lib/store";
import { cloudConfigured } from "@/lib/config";
import { SignIn, type SignedIn } from "@/account/SignIn";
import { companionCopy, interestCopy, modeCopy, vibeCopy } from "@/lib/copy";
import { Button, Chip, Icon, Press, Spark, T, tap, Wordmark, type IconName } from "@/ui/kit";
import { color, font, motion, radius, shadow, space } from "@/ui/theme";

const baseSteps = ["welcome", "who", "vibes", "people", "place", "needs", "reveal"] as const;
type Step = (typeof baseSteps)[number] | "account";

// Personality reveal: first vibe gives the adjective, second the noun.
const adjective: Record<string, string> = { romantic: "Romantic", adventurous: "Bold", cozy: "Cozy", cinematic: "Cinematic", chill: "Easygoing", lively: "Lively", artsy: "Artsy", foodie: "Hungry", outdoorsy: "Fresh-Air", playful: "Playful" };
const noun: Record<string, string> = { romantic: "Romantic", adventurous: "Adventurer", cozy: "Nester", cinematic: "Scene-Seeker", chill: "Wanderer", lively: "Night Owl", artsy: "Aesthete", foodie: "Taster", outdoorsy: "Rambler", playful: "Game-Starter" };
export function persona(vibes: string[]) {
  if (!vibes.length) return "Open-Minded Explorer";
  if (vibes.length === 1) return `The ${noun[vibes[0]]}`;
  return `${adjective[vibes[0]]} ${noun[vibes[1]]}`;
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
          “Saturday with the kids, $100, not too far”
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
              <T v="smallStrong" style={{ fontSize: 13, lineHeight: 14 }} tone={color.coralText}>
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
    w.set(withTiming(value, { duration: motion.standard }));
  }, [value, w]);
  const fill = useAnimatedStyle(() => ({ width: `${w.get() * 100}%` }));
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
        <T v="small" tone={selected ? "#C7CCE4" : color.muted}>
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

const NEEDS: { key: string; label: string; icon: IconName; apply: (d: TasteProfile, on: boolean) => Partial<TasteProfile> }[] = [
  { key: "vegetarian", label: "Vegetarian", icon: "feather", apply: (d, on) => ({ dietary: toggleWord(d.dietary, "vegetarian", on) }) },
  { key: "vegan", label: "Vegan", icon: "feather", apply: (d, on) => ({ dietary: toggleWord(d.dietary, "vegan", on) }) },
  { key: "halal", label: "Halal", icon: "check-circle", apply: (d, on) => ({ dietary: toggleWord(d.dietary, "halal", on) }) },
  { key: "nut allergy", label: "Nut allergy", icon: "alert-circle", apply: (d, on) => ({ dietary: toggleWord(d.dietary, "nut allergy", on) }) },
  { key: "step-free", label: "Step-free access", icon: "navigation", apply: (d, on) => ({ accessibility: toggleWord(d.accessibility, "step-free", on) }) },
  { key: "alcohol", label: "No bars", icon: "slash", apply: (_d, on) => ({ alcoholFree: on }) },
];
function toggleWord(list: string, word: string, on: boolean) {
  const parts = list.split(",").map((p) => p.trim()).filter(Boolean).filter((p) => p.toLowerCase() !== word);
  return (on ? [...parts, word] : parts).join(", ").slice(0, 300);
}
const hasNeed = (d: TasteProfile, key: string) =>
  key === "alcohol" ? d.alcoholFree : key === "step-free" ? /step-free/i.test(d.accessibility) : new RegExp(`\\b${key}\\b`, "i").test(d.dietary);
const extraInterests = ["Interactive fun", "Shopping", "Hidden gems", "Relaxation", "Family"] as const;
const budgetChoices = [
  { value: 25, label: "Under $25" },
  { value: 50, label: "About $50" },
  { value: 80, label: "$60–100" },
  { value: 150, label: "$100+" },
];

export default function Onboarding() {
  const { profile, setProfile, track, session } = useStore();
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  // Nothing is pre-picked: who you go out with is a real answer, not a default.
  const [draft, setDraft] = useState<TasteProfile>(() => ({ ...profile, budget: budgetChoices.some((b) => b.value === profile.budget) ? profile.budget : 50 }));
  const [who, setWho] = useState<TasteProfile["companions"] | null>(profile.onboarded ? profile.companions : null);
  const [person, setPerson] = useState<Person | "new" | null>(null);
  const [locating, setLocating] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [signedInAs, setSignedInAs] = useState("");
  const [signedInAtStart] = useState(() => Boolean(session));
  const offerAccount = cloudConfigured && !signedInAtStart && !signedInAs;
  const steps: readonly Step[] = offerAccount ? [...baseSteps, "account"] : baseSteps;
  const current = steps[step];
  const set = (patch: Partial<TasteProfile>) => setDraft((d) => ({ ...d, ...patch }));
  const [limitHit, setLimitHit] = useState(false);
  const toggleVibe = (v: TasteProfile["vibes"][number]) =>
    setDraft((d) => {
      if (d.vibes.includes(v)) return { ...d, vibes: d.vibes.filter((x) => x !== v) };
      if (d.vibes.length >= 4) {
        setLimitHit(true);
        tap("light");
        return d;
      }
      setLimitHit(false);
      return { ...d, vibes: [...d.vibes, v] };
    });
  const toggleInterest = (i: TasteProfile["interests"][number]) =>
    setDraft((d) => ({ ...d, interests: d.interests.includes(i) ? d.interests.filter((x) => x !== i) : [...d.interests, i].slice(-6) }));
  useEffect(() => {
    track("onboarding_started");
  }, [track]);

  const go = (to: number) => {
    setDir(to > step ? 1 : -1);
    setStep(Math.max(0, Math.min(steps.length - 1, to)));
  };
  const save = () => setProfile({ ...draft, companions: who ?? draft.companions, onboarded: true });
  const leave = () => router.replace("/");
  const finish = (skipped = false) => {
    if (current !== "account") save();
    track(skipped ? "onboarding_skipped" : "onboarding_completed", { step: current });
    tap("success");
    leave();
  };
  const next = () => {
    if (step === steps.length - 1) return finish();
    if (steps[step + 1] === "account") save();
    go(step + 1);
  };
  const pickWho = (c: TasteProfile["companions"]) => {
    tap("select");
    setWho(c);
    set({ companions: c });
    setTimeout(() => go(step + 1), 220);
  };
  const useLocation = async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === "granted") {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const near = nearestArea({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        if (near) set({ homeArea: near.key });
      }
    } catch {
      // Location is optional; the list is right there.
    } finally {
      setLocating(false);
    }
  };
  const returning = (r: SignedIn) => {
    setSigningIn(false);
    if (r.restored) {
      track("onboarding_skipped", { step: "signin" });
      router.replace({ pathname: "/", params: { welcome: "back", restoredPlans: String(r.plans) } });
      return;
    }
    setSignedInAs(r.email);
    go(1);
  };
  const people = profile.people;
  const Enter = dir === 1 ? SlideInRight : SlideInLeft;

  return (
    <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
      <View style={s.top}>
        {signingIn ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => setSigningIn(false)} hitSlop={10} style={s.topButton}>
            <Icon name="arrow-left" />
          </Pressable>
        ) : step > 0 && current !== "account" ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => go(step - 1)} hitSlop={10} style={s.topButton}>
            <Icon name="arrow-left" />
          </Pressable>
        ) : (
          <View style={s.topButton} />
        )}
        {step > 0 && !signingIn ? <ProgressBar value={step / (steps.length - 1)} /> : <View style={{ flex: 1 }} />}
        {current === "welcome" || current === "reveal" || current === "account" || signingIn ? (
          <View style={[s.topButton, { width: 56 }]} />
        ) : (
          <Pressable accessibilityRole="button" onPress={() => go(step + 1)} hitSlop={10} style={[s.topButton, { width: 56 }]} testID="onboarding-skip-step">
            <T v="smallStrong" tone={color.muted}>
              Skip
            </T>
          </Pressable>
        )}
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        {signingIn ? (
          <Animated.View key="signin" entering={FadeIn.duration(motion.enter)} style={{ gap: space.lg }}>
            <T v="title" accessibilityRole="header">
              Welcome back
            </T>
            <T v="body" tone={color.muted}>
              Sign in to bring back your taste, people and saved plans.
            </T>
            <SignIn onSignedIn={returning} />
          </Animated.View>
        ) : (
          <Animated.View key={current} entering={Enter.duration(motion.enter)} style={{ gap: space.lg }}>
            {signedInAs && current !== "account" ? (
              <View style={s.signedIn} testID="onboarding-signed-in">
                <Icon name="check-circle" size={16} />
                <T v="small" style={{ flex: 1 }}>
                  Signed in as {signedInAs}. A few questions to set up your taste.
                </T>
              </View>
            ) : null}

            {current === "welcome" ? (
              <View style={{ gap: space.xl }}>
                <Wordmark size={24} />
                <MiniDemo />
                <View style={{ gap: space.md }}>
                  <T v="hero" style={{ fontSize: 32, lineHeight: 36 }} accessibilityRole="header">
                    From “what should we do?” to “we’re going” in a minute.
                  </T>
                  <T v="body" tone={color.muted}>
                    Say the mood, who’s coming and when. Get real places in Toronto, with times and routes.
                  </T>
                </View>
              </View>
            ) : null}

            {current === "who" ? (
              <>
                <T v="title" accessibilityRole="header">Who’s usually coming?</T>
                <T v="body" tone={color.muted}>
                  You can change it for any plan.
                </T>
                <View style={s.grid}>
                  {companionKeys.map((c) => (
                    <Tile key={c} testID={`who-${c}`} icon={companionCopy[c].icon} label={companionCopy[c].label} hint={companionCopy[c].hint} selected={who === c} onPress={() => pickWho(c)} />
                  ))}
                </View>
              </>
            ) : null}

            {current === "vibes" ? (
              <>
                <T v="title" accessibilityRole="header">What are you into?</T>
                <T v="body" tone={color.muted}>
                  Pick up to four moods, and anything else you love.
                </T>
                <View style={s.grid}>
                  {vibeKeys.map((v) => (
                    <Tile key={v} testID={`vibe-${v}`} icon={vibeCopy[v].icon} label={vibeCopy[v].label} hint={vibeCopy[v].hint} selected={draft.vibes.includes(v)} onPress={() => toggleVibe(v)} />
                  ))}
                </View>
                <T v="heading" style={{ marginTop: space.sm }}>Also into</T>
                <View style={s.chips}>
                  {extraInterests.map((i) => (
                    <Chip key={i} testID={`interest-${i}`} icon={interestCopy[i]} label={i} selected={draft.interests.includes(i)} onPress={() => toggleInterest(i)} />
                  ))}
                </View>
              </>
            ) : null}

            {current === "people" ? (
              <>
                <T v="title" accessibilityRole="header">Who do you go out with?</T>
                <T v="body" tone={color.muted}>
                  Add a few people and what they enjoy. Planning with them puts their favourites first. Only you can see this.
                </T>
                <View style={s.peopleRow}>
                  <Press testID="onboarding-person-add" accessibilityRole="button" accessibilityLabel="Add someone" onPress={() => setPerson("new")} style={s.personItem}>
                    <View style={s.personAdd}>
                      <Icon name="plus" size={24} />
                    </View>
                    <T v="small">Add</T>
                  </Press>
                  {people.map((p) => (
                    <Press key={p.id} accessibilityRole="button" accessibilityLabel={`Edit ${p.name}`} onPress={() => setPerson(p)} style={s.personItem}>
                      <Avatar name={p.name} size={56} />
                      <T v="small" numberOfLines={1}>
                        {p.name}
                      </T>
                    </Press>
                  ))}
                </View>
                <T v="small" tone={color.muted}>
                  {people.length ? `${people.length} added. Add more anytime from Home.` : "Skip this for now if you like; you can add people from Home."}
                </T>
              </>
            ) : null}

            {current === "place" ? (
              <>
                <T v="title" accessibilityRole="header">Where do you usually start?</T>
                <Button kind="soft" icon="navigation" label={locating ? "Finding you…" : "Use my location"} onPress={useLocation} testID="onboarding-locate" />
                <View style={s.chips}>
                  {areas.map((a) => (
                    <Chip key={a.key} testID={`area-${a.key}`} label={a.name} selected={draft.homeArea === a.key} onPress={() => (tap("select"), set({ homeArea: a.key }))} />
                  ))}
                </View>
                <T v="heading" style={{ marginTop: space.sm }}>Getting around</T>
                <View style={s.chips}>
                  {(["WALK", "TRANSIT", "DRIVE"] as const).map((m) => (
                    <Chip key={m} testID={`mode-${m}`} icon={modeCopy[m].icon} label={modeCopy[m].label} selected={draft.mode === m} onPress={() => set({ mode: m })} />
                  ))}
                </View>
              </>
            ) : null}

            {current === "needs" ? (
              <>
                <T v="title" accessibilityRole="header">Anything plans should respect?</T>
                <T v="heading">A typical outing, per person</T>
                <View style={s.chips}>
                  {budgetChoices.map((b) => (
                    <Chip key={b.value} testID={`budget-${b.value}`} icon="credit-card" label={b.label} selected={draft.budget === b.value} onPress={() => set({ budget: b.value })} />
                  ))}
                </View>
                <T v="heading" style={{ marginTop: space.sm }}>Always</T>
                <View style={s.chips}>
                  {NEEDS.map((n) => (
                    <Chip key={n.key} testID={n.key === "alcohol" ? "onboarding-alcohol-free" : `need-${n.key}`} icon={n.icon} label={n.label} selected={hasNeed(draft, n.key)} onPress={() => set(n.apply(draft, !hasNeed(draft, n.key)))} />
                  ))}
                </View>
                <T v="small" tone={color.muted}>
                  We look for places that fit and pass these on with every plan. Venues confirm the details.
                </T>
                <T v="smallStrong" style={s.label} nativeID="name-label">
                  What should we call you?
                </T>
                <TextInput accessibilityLabelledBy="name-label" accessibilityLabel="What should we call you?" value={draft.name} onChangeText={(name) => set({ name: name.slice(0, 40) })} placeholder="First name (optional)" placeholderTextColor={color.faint} style={s.input} />
              </>
            ) : null}

            {current === "reveal" ? (
              <View style={{ gap: space.xl, alignItems: "center", paddingTop: space.lg }}>
                <Animated.View entering={ZoomIn.springify().damping(12)} style={s.revealMark}>
                  <Spark size={64} />
                </Animated.View>
                <View style={{ alignItems: "center", gap: space.sm }}>
                  <T v="body" tone={color.muted}>
                    {draft.name ? `${draft.name}, you’re a` : "You’re a"}
                  </T>
                  <T v="hero" style={{ textAlign: "center" }} testID="persona" accessibilityRole="header">
                    {persona(draft.vibes)}
                  </T>
                  <T v="small" tone={color.muted} style={{ textAlign: "center", maxWidth: 300 }}>
                    {draft.vibes.length >= 2 ? `From your top two moods: ${draft.vibes.slice(0, 2).join(" and ")}.` : "Pick a few moods any time to sharpen this."}
                  </T>
                </View>
                <View style={s.revealCard}>
                  <RevealRow icon={companionCopy[who ?? draft.companions].icon} label="Usually with" value={companionCopy[who ?? draft.companions].label} />
                  <RevealRow icon="map-pin" label="Starting from" value={areas.find((a) => a.key === draft.homeArea)?.name ?? "Greater Toronto"} />
                  <RevealRow icon={modeCopy[draft.mode].icon} label="Getting around" value={modeCopy[draft.mode].label} />
                  <RevealRow icon="credit-card" label="Usual spend" value={budgetChoices.find((b) => b.value === draft.budget)?.label ?? `about $${draft.budget}`} last={!draft.dietary && !draft.accessibility && !draft.alcoholFree} />
                  {draft.dietary || draft.accessibility || draft.alcoholFree ? (
                    <RevealRow icon="check-circle" label="Always" value={[draft.dietary, draft.accessibility, draft.alcoholFree ? "no bars" : ""].filter(Boolean).join(", ")} last />
                  ) : null}
                </View>
              </View>
            ) : null}

            {current === "account" ? (
              <View style={{ gap: space.lg }} testID="onboarding-account">
                <T v="title" accessibilityRole="header">Keep it on every device?</T>
                <T v="body" tone={color.muted}>
                  Your taste, people and saved plans, wherever you sign in. No password and no spam; delete it anytime in Settings.
                </T>
                <SignIn onSignedIn={() => (track("onboarding_completed", { step: "account" }), leave())} />
              </View>
            ) : null}
          </Animated.View>
        )}
      </ScrollView>

      {signingIn ? null : (
        <View style={s.footer}>
          {current === "account" ? (
            <Button testID="onboarding-not-now" size="lg" kind="ghost" label="Not now, keep it on this device" onPress={next} />
          ) : current === "who" ? null : (
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
              {current === "vibes" ? (
                <T v="smallStrong" tone={limitHit ? color.coralText : color.muted} style={{ minWidth: 72 }}>
                  {limitHit ? "Four max" : `${draft.vibes.length} of 4`}
                </T>
              ) : null}
              <Button testID="onboarding-next" size="lg" label={current === "welcome" ? "Make it mine" : current === "reveal" ? "Start planning" : current === "people" && !people.length ? "Later" : "Continue"} icon="arrow-right" onPress={next} style={{ flex: 1 }} />
            </View>
          )}
          {current === "welcome" ? (
            <View style={{ flexDirection: "row", justifyContent: "center", gap: space.xl, paddingTop: space.md, flexWrap: "wrap" }}>
              <Pressable testID="onboarding-skip" accessibilityRole="button" onPress={() => finish(true)} hitSlop={8} style={s.link}>
                <T v="smallStrong" tone={color.muted}>
                  Look around first
                </T>
              </Pressable>
              {cloudConfigured && !session ? (
                <Pressable testID="onboarding-signin" accessibilityRole="button" onPress={() => setSigningIn(true)} hitSlop={8} style={s.link}>
                  <T v="smallStrong" tone={color.coralText}>
                    I have an account
                  </T>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
      )}
      <PersonSheet person={person} onClose={() => setPerson(null)} />
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
  buildDot: { width: 22, height: 22, borderRadius: 11, backgroundColor: color.line, alignItems: "center", justifyContent: "center" },
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
  signedIn: { flexDirection: "row", alignItems: "center", gap: space.sm, padding: space.md, marginBottom: space.lg, borderRadius: radius.md, backgroundColor: color.mintTint },
  benefit: { flexDirection: "row", alignItems: "center", gap: space.md },
  benefitIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: color.coralTint, alignItems: "center", justifyContent: "center" },
  peopleRow: { flexDirection: "row", flexWrap: "wrap", gap: space.lg },
  personItem: { alignItems: "center", gap: 6, width: 72 },
  personAdd: { width: 56, height: 56, borderRadius: 28, borderWidth: 1.5, borderStyle: "dashed", borderColor: color.lineStrong, backgroundColor: color.paper, alignItems: "center", justifyContent: "center" },
  link: { minHeight: 44, justifyContent: "center", paddingHorizontal: space.sm },
  footer: { padding: space.lg, backgroundColor: color.canvas, borderTopWidth: 1, borderTopColor: color.line },
});
