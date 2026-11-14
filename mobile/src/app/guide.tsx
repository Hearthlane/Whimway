import { Image } from "expo-image";
import { router } from "expo-router";
import { DateTime } from "luxon";
import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import Animated, { Easing, FadeIn, FadeInDown, FadeInLeft, FadeInRight, FadeOutLeft, FadeOutRight, ZoomIn, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { defaultRadius } from "@shared/areas";
import { activities, cuisines, groupByKey, inGroup, orderByTaste, type GuideGroup } from "@shared/guide";
import { buildRequest, interpret } from "@shared/intent";
import { plansLeft } from "@shared/plus";
import type { CandidatePlace, PlanRequest } from "@shared/schema";
import { api } from "@/lib/api";
import { API_URL } from "@/lib/config";
import { modeCopy, money } from "@/lib/copy";
import { useStore } from "@/lib/store";
import { GuideArt } from "@/plan/GuideArt";
import { Button, Icon, IconButton, Notice, Press, T, tap, type IconName } from "@/ui/kit";
import { color, motion, radius, shadow, space } from "@/ui/theme";

/**
 * Guided planning: a few plain questions instead of a text box. Food, then something to do,
 * then how you're getting around. Each answer narrows to real places you pick yourself.
 */
const ZONE = "America/Toronto";
type Option = CandidatePlace & { meters: number };
type Step = "when" | "food" | "cuisine" | "foodPlace" | "fun" | "kind" | "funPlace" | "travel" | "review";
type Answers = {
  day: number; // days from today
  time: string;
  food?: "meal" | "light" | "none" | "any";
  cuisine?: string;
  foodPlace?: Option;
  fun?: "yes" | "none" | "any";
  kind?: string;
  funPlace?: Option;
  mode: PlanRequest["mode"];
};

const times: { time: string; label: string; hint: string; icon: IconName }[] = [
  { time: "12:00", label: "Lunchtime", hint: "From noon", icon: "sun" },
  { time: "14:30", label: "Afternoon", hint: "From 2:30", icon: "coffee" },
  { time: "18:30", label: "Evening", hint: "From 6:30", icon: "sunset" },
  { time: "20:30", label: "Late", hint: "From 8:30", icon: "moon" },
];
const interestFor: Record<string, PlanRequest["interests"][number]> = {
  games: "Interactive fun",
  shows: "Arts & culture",
  culture: "Arts & culture",
  outdoors: "Outdoors",
  shopping: "Shopping",
  drinks: "Nightlife",
};
const tints = [color.mintTint, color.coralTint, color.lavenderTint];
/** The picture for a place without a photo: the kind of place it mainly is. */
const artFor = (p: CandidatePlace, chosen?: string) => {
  const current = chosen ? groupByKey(chosen) : undefined;
  return current && inGroup(p, current) ? current.key : ([...cuisines, ...activities].find((g) => inGroup(p, g))?.key ?? "culture");
};
const km = (m: number) => (m < 950 ? `${Math.round(m / 50) * 50} m` : `${(m / 1000).toFixed(1)} km`);
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export default function Guide() {
  const store = useStore();
  const { profile } = store;
  const now = useMemo(() => DateTime.now().setZone(ZONE), []);
  const lateToday = now.hour >= 20;
  const [a, setA] = useState<Answers>({ day: lateToday ? 1 : 0, time: lateToday || now.hour < 17 ? "18:30" : "20:30", mode: profile.mode });
  const [step, setStep] = useState<Step>("when");
  const [dir, setDir] = useState<1 | -1>(1);

  // Which questions apply, given the answers so far.
  const flow = useMemo(() => {
    const f: Step[] = ["when", "food"];
    if (a.food === "meal") f.push("cuisine", "foodPlace");
    if (a.food === "light") f.push("foodPlace");
    f.push("fun");
    if (a.fun === "yes") f.push("kind", "funPlace");
    f.push("travel", "review");
    return f;
  }, [a.food, a.fun]);
  const index = Math.max(0, flow.indexOf(step));

  const progress = useSharedValue(0);
  useEffect(() => {
    progress.set(withTiming((index + 1) / flow.length, { duration: 420, easing: Easing.out(Easing.cubic) }));
  }, [index, flow.length, progress]);
  const bar = useAnimatedStyle(() => ({ width: `${progress.get() * 100}%` }));

  const go = (to: Step, d: 1 | -1 = 1) => {
    setDir(d);
    setStep(to);
  };
  // Single-choice questions move on by themselves, after the selection has had a beat to show.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const answer = (patch: Partial<Answers>, next: (f: Step[]) => Step) => {
    tap("select");
    const merged = { ...a, ...patch };
    setA(merged);
    const f: Step[] = ["when", "food"];
    if (merged.food === "meal") f.push("cuisine", "foodPlace");
    if (merged.food === "light") f.push("foodPlace");
    f.push("fun");
    if (merged.fun === "yes") f.push("kind", "funPlace");
    f.push("travel", "review");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => go(next(f)), 240);
  };
  const after = (s: Step) => (f: Step[]) => f[f.indexOf(s) + 1] ?? "review";
  const back = () => (index === 0 ? (router.canGoBack() ? router.back() : router.replace("/")) : go(flow[index - 1], -1));

  // The request these answers describe. Also used to look up places for each choice.
  const request = useMemo<PlanRequest>(() => {
    const base = buildRequest("", interpret("", now), profile, now);
    const chosen = [a.foodPlace, a.funPlace].filter(Boolean) as Option[];
    const interests = [
      ...(a.food && a.food !== "none" ? (["Food & drinks"] as const) : []),
      ...(a.kind && interestFor[a.kind] ? [interestFor[a.kind]] : []),
    ];
    const decided = (a.food === "none" || a.foodPlace) && (a.fun === "none" || a.funPlace);
    const cuisine = a.cuisine ? groupByKey(a.cuisine)?.label.toLowerCase() : undefined;
    const kind = a.kind ? groupByKey(a.kind)?.label.toLowerCase() : undefined;
    return {
      ...base,
      date: now.plus({ days: a.day }).toISODate()!,
      startTime: a.time,
      mode: a.mode,
      area: { ...base.area, radius: defaultRadius(a.mode) },
      interests: interests.length ? [...new Set(interests)] : base.interests,
      skipFood: a.food === "none",
      anchorPlaceIds: chosen.map((p) => p.id),
      pace: decided ? "relaxed" : "balanced",
      duration: chosen.length === 2 ? 210 : decided ? 150 : 240,
      prompt: [a.food === "none" ? "no food" : cuisine ? `${cuisine} food` : a.food === "light" ? "coffee or dessert" : "", a.fun === "none" ? "" : (kind ?? "")].filter(Boolean).join(", "),
    };
  }, [a, now, profile]);

  // Places for the current "pick one" step.
  const group = step === "foodPlace" ? (a.food === "light" ? "sweet" : a.cuisine) : step === "funPlace" ? a.kind : undefined;
  const [options, setOptions] = useState<{ key: string; places: Option[]; widened: boolean } | null>(null);
  const [failed, setFailed] = useState("");
  const [attempt, setAttempt] = useState(0);
  const lookup = `${group}|${request.date}|${request.startTime}|${a.mode}`;
  useEffect(() => {
    if (!group) return;
    let live = true;
    void Promise.resolve().then(async () => {
      setFailed("");
      try {
        const res = await api<{ places: Option[]; widened: boolean }>("guide/options", { request: { ...request, anchorPlaceIds: [] }, group, demo: store.demo });
        if (live) setOptions({ key: lookup, ...res });
      } catch (e) {
        if (live) setFailed((e as Error).message || "Couldn’t load places.");
      }
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookup, attempt]);
  const places = options?.key === lookup ? options.places : null;

  const liked = useMemo(
    () => [...profile.favourites.map((f) => f.category ?? ""), ...Object.entries(profile.affinity).filter(([, v]) => v > 0).map(([k]) => k)],
    [profile],
  );
  const cuisineTiles = useMemo(() => orderByTaste(cuisines, liked), [liked]);
  const kindTiles = useMemo(() => orderByTaste(activities, liked), [liked]);

  const build = () => {
    if (plansLeft(profile) <= 0) return router.push({ pathname: "/plus", params: { reason: "limit" } });
    store.setPending(request);
    store.track("plan_requested", { words: 0, edited: 0, guided: true });
    router.replace("/plan/new");
  };

  const day = (d: number) => (d === 0 ? "Today" : d === 1 ? "Tomorrow" : now.plus({ days: d }).toFormat("cccc"));
  const titles: Record<Step, [string, string]> = {
    when: ["When are you heading out?", "Places are checked against their opening hours for this time."],
    food: ["Are you eating?", "If you’ve already eaten, the plan skips restaurants."],
    cuisine: ["What are you hungry for?", liked.length ? "Your usual picks come first." : "Pick the one that sounds best right now."],
    foodPlace: [a.food === "light" ? "Somewhere for coffee or dessert" : `${groupByKey(a.cuisine ?? "")?.label ?? "Food"} near you`, "Open at your time, closest first. Pick one."],
    fun: ["Want something to do as well?", a.food === "none" ? "Since you’re not eating, pick what the outing is about." : "Before or after you eat."],
    kind: ["What sounds fun?", "Pick one. You can change it later."],
    funPlace: [`${groupByKey(a.kind ?? "")?.label ?? "Things to do"} near you`, "Open at your time, closest first. Pick one."],
    travel: ["How are you getting around?", "This sets how far apart the stops can be."],
    review: ["Here’s what you picked", "Whimway fits it into a timetable with travel between stops."],
  };

  const [title, sub] = titles[step];
  const Enter = dir === 1 ? FadeInRight : FadeInLeft;
  const Exit = dir === 1 ? FadeOutLeft : FadeOutRight;

  return (
    <SafeAreaView style={s.page}>
      <View style={s.top}>
        <IconButton icon="arrow-left" label="Back" onPress={back} />
        <View style={s.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: flow.length, now: index + 1 }}>
          <Animated.View style={[s.fill, bar]} />
        </View>
        <IconButton icon="x" label="Close" onPress={() => router.replace("/")} />
      </View>
      <Animated.View key={step} entering={Enter.duration(motion.standard).easing(Easing.out(Easing.cubic))} exiting={Exit.duration(motion.quick)} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
          <View style={{ gap: space.sm }}>
            <T v="hero" accessibilityRole="header" style={{ fontSize: 32, lineHeight: 35 }}>
              {title}
            </T>
            <T v="body" tone={color.muted}>
              {sub}
            </T>
          </View>

          {step === "when" ? (
            <>
              <View style={s.days}>
                {[0, 1, 2, 3].filter((d) => d > 0 || !lateToday).map((d) => (
                  <Press key={d} testID={`guide-day-${d}`} accessibilityRole="button" accessibilityState={{ selected: a.day === d }} onPress={() => (tap("select"), setA({ ...a, day: d }))} style={[s.day, a.day === d && s.dayOn]}>
                    <T v="smallStrong" tone={a.day === d ? color.paper : color.ink}>
                      {day(d)}
                    </T>
                  </Press>
                ))}
              </View>
              <View style={{ gap: space.md }}>
                {times
                  .filter((t) => a.day > 0 || Number(t.time.slice(0, 2)) > now.hour)
                  .map((t) => (
                    <Row key={t.time} testID={`guide-time-${t.time}`} icon={t.icon} label={t.label} hint={t.hint} selected={a.time === t.time} onPress={() => answer({ time: t.time }, after("when"))} />
                  ))}
              </View>
            </>
          ) : null}

          {step === "food" ? (
            <View style={{ gap: space.md }}>
              <Row testID="guide-food-meal" icon="coffee" label="Yes, a proper meal" hint="Choose what you’re hungry for" selected={a.food === "meal"} onPress={() => answer({ food: "meal" }, after("food"))} />
              <Row testID="guide-food-light" icon="gift" label="Just something light" hint="Coffee, dessert or a snack" selected={a.food === "light"} onPress={() => answer({ food: "light", cuisine: undefined, foodPlace: undefined }, after("food"))} />
              <Row testID="guide-food-none" icon="slash" label="No, we’ve eaten" hint="Leave restaurants out" selected={a.food === "none"} onPress={() => answer({ food: "none", cuisine: undefined, foodPlace: undefined, fun: a.fun === "none" ? undefined : a.fun }, after("food"))} />
              <Row testID="guide-food-any" icon="shuffle" label="Not sure, you decide" hint="Whimway adds food if it suits the time" selected={a.food === "any"} onPress={() => answer({ food: "any", cuisine: undefined, foodPlace: undefined }, after("food"))} />
            </View>
          ) : null}

          {step === "cuisine" ? <Tiles prefix="guide-cuisine" groups={cuisineTiles} value={a.cuisine} onPick={(key) => answer({ cuisine: key, foodPlace: undefined }, after("cuisine"))} /> : null}

          {step === "foodPlace" ? <Places group={group} failed={failed} places={places} widened={Boolean(options?.widened)} onRetry={() => setAttempt((n) => n + 1)} prefix="guide-food-place" value={a.foodPlace} onPick={(p) => answer({ foodPlace: p }, after("foodPlace"))} onSkip={() => answer({ foodPlace: places?.[0] }, after("foodPlace"))} /> : null}

          {step === "fun" ? (
            <View style={{ gap: space.md }}>
              <Row testID="guide-fun-yes" icon="zap" label="Yes, let me choose" hint="Games, a show, art, a walk" selected={a.fun === "yes"} onPress={() => answer({ fun: "yes" }, after("fun"))} />
              {a.food === "none" ? null : <Row testID="guide-fun-none" icon="slash" label="No, just the food" hint="Keep it short" selected={a.fun === "none"} onPress={() => answer({ fun: "none", kind: undefined, funPlace: undefined }, after("fun"))} />}
              <Row testID="guide-fun-any" icon="shuffle" label="Surprise me" hint="Whimway picks something that fits" selected={a.fun === "any"} onPress={() => answer({ fun: "any", kind: undefined, funPlace: undefined }, after("fun"))} />
            </View>
          ) : null}

          {step === "kind" ? <Tiles prefix="guide-kind" groups={kindTiles} value={a.kind} onPick={(key) => answer({ kind: key, funPlace: undefined }, after("kind"))} /> : null}

          {step === "funPlace" ? <Places group={group} failed={failed} places={places} widened={Boolean(options?.widened)} onRetry={() => setAttempt((n) => n + 1)} prefix="guide-fun-place" value={a.funPlace} onPick={(p) => answer({ funPlace: p }, after("funPlace"))} onSkip={() => answer({ funPlace: places?.[0] }, after("funPlace"))} /> : null}

          {step === "travel" ? (
            <View style={{ gap: space.md }}>
              {(["WALK", "TRANSIT", "DRIVE"] as const).map((m) => (
                <Row
                  key={m}
                  testID={`guide-mode-${m}`}
                  icon={modeCopy[m].icon}
                  label={m === "WALK" ? "On foot" : m === "TRANSIT" ? "TTC or transit" : "By car"}
                  hint={m === "WALK" ? "Stops within a short walk" : m === "TRANSIT" ? "Stops a short ride apart" : "Stops can be farther apart"}
                  selected={a.mode === m}
                  onPress={() => answer({ mode: m }, after("travel"))}
                />
              ))}
            </View>
          ) : null}

          {step === "review" ? (
            <View style={s.summary}>
              <Line icon="calendar" label="When" value={`${day(a.day)}, from ${DateTime.fromFormat(a.time, "HH:mm").toFormat("h:mm a")}`} onPress={() => go("when", -1)} />
              <Line
                icon="coffee"
                label="Food"
                value={a.food === "none" ? "Not eating" : a.foodPlace ? a.foodPlace.name : a.food === "any" ? "Whimway decides" : "Something that fits"}
                onPress={() => go(a.food === "meal" || a.food === "light" ? "foodPlace" : "food", -1)}
              />
              <Line icon="zap" label="Something to do" value={a.fun === "none" ? "Just the food" : a.funPlace ? a.funPlace.name : "Whimway picks"} onPress={() => go(a.fun === "yes" ? "funPlace" : "fun", -1)} />
              <Line icon={modeCopy[a.mode].icon} label="Getting around" value={a.mode === "WALK" ? "On foot" : a.mode === "TRANSIT" ? "TTC or transit" : "By car"} onPress={() => go("travel", -1)} />
            </View>
          ) : null}
        </ScrollView>
      </Animated.View>
      {step === "review" ? (
        <Animated.View entering={FadeInDown.delay(180).duration(320)} style={s.footer}>
          <Button testID="guide-build" size="lg" label="Build my timetable" onPress={build} />
        </Animated.View>
      ) : null}
    </SafeAreaView>
  );
}

function Row({ icon, label, hint, selected, onPress, testID }: { icon: IconName; label: string; hint?: string; selected?: boolean; onPress: () => void; testID?: string }) {
  return (
    <Press testID={testID} accessibilityRole="button" accessibilityState={{ selected }} accessibilityLabel={label} scaleTo={0.98} onPress={onPress} style={[s.row, selected && s.rowOn]}>
      <View style={[s.rowIcon, selected && { backgroundColor: color.coral }]}>
        <Icon name={icon} size={20} />
      </View>
      <View style={{ flex: 1 }}>
        <T v="bodyStrong" style={{ fontSize: 17 }}>
          {label}
        </T>
        {hint ? (
          <T v="small" tone={color.muted}>
            {hint}
          </T>
        ) : null}
      </View>
      {selected ? (
        <Animated.View entering={ZoomIn.duration(180)} style={s.check}>
          <Icon name="check" size={14} tint={color.paper} />
        </Animated.View>
      ) : null}
    </Press>
  );
}

function Tiles({ groups, value, onPick, prefix }: { groups: (GuideGroup & { usual: boolean })[]; value?: string; onPick: (key: string) => void; prefix: string }) {
  return (
    <View style={s.grid}>
      {groups.map((g, i) => {
        const on = value === g.key;
        return (
          <Animated.View key={g.key} entering={FadeInDown.delay(60 + i * 45).duration(320)} style={s.cell}>
            <Press testID={`${prefix}-${g.key}`} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${g.label}. ${g.hint}`} scaleTo={0.96} onPress={() => onPick(g.key)} style={[s.tile, on && s.tileOn]}>
              <View style={s.tileArt}>
                <GuideArt name={g.key} height={92} />
                {g.usual ? (
                  <View style={s.usual}>
                    <T v="smallStrong" style={{ fontSize: 11 }}>
                      Your usual
                    </T>
                  </View>
                ) : null}
                {on ? (
                  <Animated.View entering={ZoomIn.duration(180)} style={[s.check, s.tileCheck]}>
                    <Icon name="check" size={14} tint={color.paper} />
                  </Animated.View>
                ) : null}
              </View>
              <View style={{ padding: space.md, gap: 2 }}>
                <T v="bodyStrong">{g.label}</T>
                <T v="small" tone={color.muted} numberOfLines={2}>
                  {g.hint}
                </T>
              </View>
            </Press>
          </Animated.View>
        );
      })}
    </View>
  );
}

function Places({ value, onPick, onSkip, prefix, failed, places, widened, onRetry, group }: { group?: string; value?: Option; onPick: (p: Option) => void; onSkip: () => void; prefix: string; failed: string; places: Option[] | null; widened: boolean; onRetry: () => void }) {
  return failed ? (
      <View style={{ gap: space.md }}>
        <Notice tone="coral" icon="wifi-off">
          {failed}
        </Notice>
        <Button kind="soft" label="Try again" icon="refresh-cw" onPress={onRetry} />
      </View>
    ) : !places ? (
      <View style={{ gap: space.md }} accessibilityLabel="Finding places">
        {[0, 1, 2].map((i) => (
          <Animated.View key={i} entering={FadeIn.delay(i * 90).duration(300)} style={s.skeleton} />
        ))}
      </View>
    ) : !places.length ? (
      <View style={{ gap: space.md }}>
        <Notice icon="info">Nothing of this kind is open at that time. Whimway can pick something else that fits.</Notice>
        <Button kind="dark" label="Pick for me" onPress={onSkip} />
      </View>
    ) : (
      <View style={{ gap: space.md }}>
        {widened && places[0].meters > 4000 ? <Notice icon="map">Nothing close by, so these are a little farther out.</Notice> : null}
        {places.map((p, i) => {
          const on = value?.id === p.id;
          return (
            <Animated.View key={p.id} entering={FadeInDown.delay(i * 60).duration(320)}>
              <Press testID={`${prefix}-${i}`} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${p.name}, ${p.category}, ${km(p.meters)} away`} scaleTo={0.98} onPress={() => onPick(p)} style={[s.place, on && s.rowOn]}>
                <View style={s.placeArt}>
                  {p.photos[0] ? (
                    <Image source={{ uri: `${API_URL}/api/photo?name=${encodeURIComponent(p.photos[0].name)}` }} style={{ width: 84, height: 84 }} contentFit="cover" transition={200} accessibilityIgnoresInvertColors />
                  ) : (
                    <GuideArt name={artFor(p, group)} height={84} bg={tints[i % tints.length]} />
                  )}
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <T v="bodyStrong" numberOfLines={1} style={{ fontSize: 16 }}>
                    {p.name}
                  </T>
                  <T v="small" tone={color.muted} numberOfLines={1}>
                    {cap(p.category)}
                  </T>
                  <View style={s.facts}>
                    <T v="smallStrong">{km(p.meters)}</T>
                    <View style={s.dot} />
                    <T v="smallStrong">{p.price.high == null ? "Price varies" : p.price.high === 0 ? "Free" : `${money(p.price.low ?? 0)}–${money(p.price.high)}`}</T>
                    {p.rating ? (
                      <>
                        <View style={s.dot} />
                        <Icon name="star" size={12} tint={color.warning} />
                        <T v="smallStrong">{p.rating.toFixed(1)}</T>
                      </>
                    ) : null}
                  </View>
                </View>
                {on ? (
                  <Animated.View entering={ZoomIn.duration(180)} style={s.check}>
                    <Icon name="check" size={14} tint={color.paper} />
                  </Animated.View>
                ) : null}
              </Press>
            </Animated.View>
          );
        })}
        <Press accessibilityRole="button" onPress={onSkip} style={s.skip} testID={`${prefix}-any`}>
          <T v="smallStrong" tone={color.coralText}>
            I don’t mind, pick for me
          </T>
        </Press>
      </View>
    );
}

function Line({ icon, label, value, onPress }: { icon: IconName; label: string; value: string; onPress: () => void }) {
  return (
    <Press accessibilityRole="button" accessibilityLabel={`${label}: ${value}. Change`} scaleTo={0.99} onPress={onPress} style={s.line}>
      <Icon name={icon} size={18} tint={color.muted} />
      <View style={{ flex: 1 }}>
        <T v="small" tone={color.muted}>
          {label}
        </T>
        <T v="bodyStrong">{value}</T>
      </View>
      <T v="smallStrong" tone={color.coralText}>
        Change
      </T>
    </Press>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.canvas },
  top: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingTop: space.sm },
  track: { flex: 1, height: 6, borderRadius: 3, backgroundColor: color.line, overflow: "hidden" },
  fill: { height: 6, borderRadius: 3, backgroundColor: color.ink },
  body: { padding: space.xl, paddingTop: space.lg, gap: space.xl, maxWidth: 560, width: "100%", alignSelf: "center", paddingBottom: 120 },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 72, paddingHorizontal: space.lg, paddingVertical: space.md, borderRadius: radius.lg, backgroundColor: color.paper, borderWidth: 1.5, borderColor: color.line },
  rowOn: { borderColor: color.ink, ...shadow.card },
  rowIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: color.canvas, alignItems: "center", justifyContent: "center" },
  check: { width: 24, height: 24, borderRadius: 12, backgroundColor: color.ink, alignItems: "center", justifyContent: "center" },
  days: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  day: { paddingHorizontal: space.lg, minHeight: 40, borderRadius: radius.pill, justifyContent: "center", backgroundColor: color.paper, borderWidth: 1.5, borderColor: color.line },
  dayOn: { backgroundColor: color.ink, borderColor: color.ink },
  grid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -space.sm / 2, rowGap: space.md },
  cell: { width: "50%", paddingHorizontal: space.sm / 2 },
  tile: { borderRadius: radius.lg, backgroundColor: color.paper, borderWidth: 1.5, borderColor: color.line, overflow: "hidden" },
  tileOn: { borderColor: color.ink, ...shadow.card },
  tileArt: { overflow: "hidden" },
  tileCheck: { position: "absolute", top: space.sm, right: space.sm },
  usual: { position: "absolute", top: space.sm, left: space.sm, backgroundColor: color.coral, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  place: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.sm, paddingRight: space.lg, borderRadius: radius.lg, backgroundColor: color.paper, borderWidth: 1.5, borderColor: color.line },
  placeArt: { width: 84, height: 84, borderRadius: radius.md, overflow: "hidden" },
  facts: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  dot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: color.faint },
  skeleton: { height: 100, borderRadius: radius.lg, backgroundColor: color.line, opacity: 0.6 },
  skip: { alignSelf: "center", minHeight: 44, justifyContent: "center", paddingHorizontal: space.lg },
  summary: { backgroundColor: color.paper, borderRadius: radius.lg, borderWidth: 1, borderColor: color.line, paddingHorizontal: space.lg },
  line: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 68, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.line },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, padding: space.xl, paddingBottom: space.xxl, backgroundColor: color.canvas },
});
