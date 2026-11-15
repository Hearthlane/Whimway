import { Image } from "expo-image";
import { router } from "expo-router";
import { DateTime } from "luxon";
import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, TextInput, View } from "react-native";
import Animated, { FadeIn, FadeInDown, ZoomIn } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { countPlan } from "@shared/plus";
import type { Itinerary } from "@shared/schema";
import { api } from "@/lib/api";
import { API_URL } from "@/lib/config";
import { modeCopy, money } from "@/lib/copy";
import { useStore } from "@/lib/store";
import { Generating, stages } from "@/plan/Generating";
import { guidePhotos, kindOf } from "@/plan/guidePhotos";
import { Button, Chip, Icon, IconButton, Notice, Press, T, tap } from "@/ui/kit";
import { color, font, radius, shadow, space } from "@/ui/theme";

type Option = { key: string; label: string; blurb: string; plan: Itinerary };

/** Quick ways to say what was missing, for people who'd rather tap than type. */
const nudges = ["More fun", "More lively", "Something outdoors", "Cheaper", "Closer together", "Less food"];

/**
 * Before anything is saved, the person chooses between a few different plans built from
 * their answers. If none fit, they say what's missing and get a fresh set.
 */
export default function Options() {
  const store = useStore();
  const [request] = useState(() => store.pendingRef.current);
  const [options, setOptions] = useState<Option[] | null>(null);
  const [error, setError] = useState("");
  const [stage, setStage] = useState(0);
  const [chosen, setChosen] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [refining, setRefining] = useState(false);
  const shown = useRef<string[]>([]);
  const counted = useRef(false);

  const load = async (said = "") => {
    if (!request) return router.replace("/");
    setError("");
    setStage(0);
    const timer = setInterval(() => setStage((s) => Math.min(stages.length - 1, s + 1)), store.demo ? 420 : 3000);
    const minimum = new Promise((resolve) => setTimeout(resolve, said ? 900 : store.demo ? 2000 : 0));
    try {
      const [next] = await Promise.all([api<Option[]>("guide/plans", { request, feedback: said, avoid: shown.current, demo: store.demo }), minimum]);
      if (!next.length) throw new Error("Nothing fits those answers at that time. Try another time, or change one of your picks.");
      shown.current = [...new Set([...shown.current, ...next.flatMap((o) => o.plan.stops.map((s) => s.placeId))])].slice(-40);
      if (!counted.current) {
        counted.current = true;
        store.setProfile(countPlan({ ...store.profile, stats: { ...store.profile.stats, plans: store.profile.stats.plans + 1 } }));
      }
      store.track(said ? "options_refined" : "options_shown", { count: next.length });
      tap("success");
      setOptions(next);
      setFeedback("");
    } catch (e) {
      setError((e as Error).message || "Couldn’t build options. Check your connection and try again.");
    } finally {
      clearInterval(timer);
      setRefining(false);
    }
  };

  useEffect(() => {
    void Promise.resolve().then(() => load());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = (o: Option) => {
    setChosen(o.key);
    tap("select");
    store.remember(o.plan);
    store.track("option_chosen", { option: o.key, stops: o.plan.stops.length });
    setTimeout(() => router.replace(`/plan/${o.plan.id}`), 260);
  };
  const refine = (said: string) => {
    if (!said.trim()) return;
    setRefining(true);
    setOptions(null);
    void load(said.trim());
  };

  if (!options && !error) return <Generating stage={stage} refreshing={refining} />;

  return (
    <SafeAreaView style={s.page}>
      <View style={s.top}>
        <IconButton icon="arrow-left" label="Back to your answers" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
        <IconButton icon="x" label="Close" onPress={() => router.replace("/")} />
      </View>
      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        <View style={{ gap: space.sm }}>
          <T v="hero" accessibilityRole="header" style={{ fontSize: 32, lineHeight: 35 }}>
            {options ? "Pick the one that sounds best" : "That didn’t work"}
          </T>
          <T v="body" tone={color.muted}>
            {options ? "Each one is a full timetable. You can still change any stop after." : error}
          </T>
        </View>
        {error && !options ? <Button kind="dark" label="Try again" icon="refresh-cw" onPress={() => load()} /> : null}

        {options?.map((o, i) => (
          <Animated.View key={o.plan.id} entering={FadeInDown.delay(80 + i * 110).duration(380)}>
            <OptionCard option={o} chosen={chosen === o.key} onPick={() => pick(o)} testID={`option-${i}`} />
          </Animated.View>
        ))}

        {options ? (
          <Animated.View entering={FadeIn.delay(450).duration(320)} style={s.refine}>
            <T v="heading">None of these?</T>
            <T v="small" tone={color.muted}>
              Say what’s missing and you’ll get a different set.
            </T>
            <View style={s.chips}>
              {nudges.map((n) => (
                <Chip key={n} label={n} onPress={() => refine(n)} testID={`refine-${n}`} />
              ))}
            </View>
            <TextInput
              testID="refine-text"
              value={feedback}
              onChangeText={setFeedback}
              multiline
              maxLength={300}
              placeholder="We haven’t seen each other in ages. Something we can do together, not just sit and eat."
              placeholderTextColor={color.faint}
              accessibilityLabel="Describe what you want instead"
              style={s.input}
            />
            <Button testID="refine-go" kind="dark" label="Show me different options" disabled={feedback.trim().length < 3} onPress={() => refine(feedback)} />
          </Animated.View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function OptionCard({ option, chosen, onPick, testID }: { option: Option; chosen: boolean; onPick: () => void; testID: string }) {
  const p = option.plan;
  const zone = p.request.location.timezone;
  const at = (iso: string) => DateTime.fromISO(iso).setZone(zone);
  const start = at(p.stops[0].arrival);
  const end = at(p.stops[p.stops.length - 1].departure);
  const each = p.cost.high ? `${money(p.cost.low)}–${money(p.cost.high)} each` : "Free";
  return (
    <Press testID={testID} accessibilityRole="button" accessibilityLabel={`${option.label}: ${p.stops.map((s) => s.place.name).join(", ")}`} scaleTo={0.985} onPress={onPick} style={[s.card, chosen && s.cardOn]}>
      <View style={s.photos}>
        {p.stops.slice(0, 4).map((stop) => (
          <Image
            key={stop.placeId}
            source={stop.place.photos[0] ? { uri: `${API_URL}/api/photo?name=${encodeURIComponent(stop.place.photos[0].name)}` } : guidePhotos[kindOf(stop.place)]}
            style={s.photo}
            contentFit="cover"
            transition={200}
            accessibilityIgnoresInvertColors
          />
        ))}
        {chosen ? (
          <Animated.View entering={ZoomIn.duration(180)} style={s.check}>
            <Icon name="check" size={16} tint={color.paper} />
          </Animated.View>
        ) : null}
      </View>
      <View style={s.cardBody}>
        <View style={s.head}>
          <T v="title" style={{ flex: 1, fontSize: 22, lineHeight: 26 }}>
            {option.label}
          </T>
          <T v="smallStrong" tone={color.muted}>
            {start.toFormat("h:mm")}–{end.toFormat("h:mm a")}
          </T>
        </View>
        <View style={{ gap: 6 }}>
          {p.stops.map((stop) => (
            <View key={stop.placeId} style={s.line}>
              <T style={s.time}>{at(stop.arrival).toFormat("h:mm")}</T>
              <T v="body" numberOfLines={1} style={{ flex: 1 }}>
                {stop.place.name}
              </T>
            </View>
          ))}
        </View>
        <View style={s.facts}>
          <T v="small" tone={color.muted}>
            {each}
          </T>
          <View style={s.dot} />
          <T v="small" tone={color.muted}>
            {(p.totalMeters / 1000).toFixed(1)} km {modeCopy[p.request.mode].label.toLowerCase()}
          </T>
        </View>
        {p.issues.some((i) => i.severity === "error") ? <Notice icon="alert-circle">{p.issues.find((i) => i.severity === "error")!.message}</Notice> : null}
      </View>
    </Press>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.canvas },
  top: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: space.lg, paddingTop: space.sm },
  body: { padding: space.xl, paddingTop: space.md, gap: space.lg, maxWidth: 560, width: "100%", alignSelf: "center", paddingBottom: space.xxxl },
  card: { borderRadius: radius.xl, backgroundColor: color.paper, borderWidth: 1.5, borderColor: color.line, overflow: "hidden" },
  cardOn: { borderColor: color.ink, ...shadow.card },
  photos: { flexDirection: "row", height: 96, gap: 2 },
  photo: { flex: 1, backgroundColor: color.line },
  check: { position: "absolute", top: space.sm, right: space.sm, width: 28, height: 28, borderRadius: 14, backgroundColor: color.ink, alignItems: "center", justifyContent: "center" },
  cardBody: { padding: space.lg, gap: space.md },
  head: { flexDirection: "row", alignItems: "baseline", gap: space.md },
  line: { flexDirection: "row", alignItems: "baseline", gap: space.md },
  time: { width: 44, fontFamily: font.bodyBold, fontSize: 14, color: color.ink, fontVariant: ["tabular-nums"] },
  facts: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: color.faint },
  refine: { gap: space.md, marginTop: space.md, paddingTop: space.xl, borderTopWidth: 1, borderTopColor: color.line },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  input: { minHeight: 96, borderRadius: radius.md, borderWidth: 1.5, borderColor: color.line, backgroundColor: color.paper, padding: space.md, fontFamily: font.body, fontSize: 16, color: color.ink, textAlignVertical: "top", lineHeight: 22 },
});
