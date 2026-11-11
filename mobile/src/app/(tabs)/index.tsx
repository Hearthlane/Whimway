import { router } from "expo-router";
import { DateTime } from "luxon";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { areaByKey, areas, defaultRadius } from "@shared/areas";
import { buildRequest, describe, interpret } from "@shared/intent";
import { companions as companionKeys, vibes as vibeKeys, type PlanRequest, type Vibe } from "@shared/schema";
import { useStore } from "@/lib/store";
import { companionCopy, examplePrompts, modeCopy, vibeCopy } from "@/lib/copy";
import { Button, Card, Chip, Icon, IconButton, Notice, Sheet, T, Wordmark, type IconName } from "@/ui/kit";
import { color, font, radius, shadow, space } from "@/ui/theme";

type Field = "who" | "when" | "budget" | "travel" | "length" | "vibe" | "area";
type Overrides = {
  companions?: PlanRequest["companions"];
  participants?: number;
  date?: string;
  startTime?: string;
  budget?: { amount: number; basis: "person" | "total" };
  mode?: PlanRequest["mode"];
  duration?: number;
  vibes?: Vibe[];
  areaKey?: string;
  indoorOnly?: boolean;
};
const ZONE = "America/Toronto";

function greeting(name: string) {
  const h = DateTime.now().setZone(ZONE).hour;
  const part = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  return name ? `${part}, ${name}` : part;
}

export default function PlanHome() {
  const store = useStore();
  const { profile, status, demo, plans } = store;
  const [text, setText] = useState("");
  const [o, setO] = useState<Overrides>({});
  const [field, setField] = useState<Field | null>(null);
  const now = DateTime.now().setZone(ZONE);

  // Interpret on every keystroke: deterministic, on-device, free.
  const request = useMemo(() => {
    const draft = interpret(text, now);
    const base = buildRequest(text, draft, profile, now, { area: areaByKey(o.areaKey) });
    const r: PlanRequest = { ...base };
    if (o.companions) r.companions = o.companions;
    if (o.participants) r.participants = o.participants;
    if (o.date) r.date = o.date;
    if (o.startTime) r.startTime = o.startTime;
    if (o.mode) {
      r.mode = o.mode;
      if (!draft.radius) r.area = { ...r.area, radius: defaultRadius(o.mode) };
    }
    if (o.duration) r.duration = o.duration;
    if (o.vibes) r.vibes = o.vibes;
    if (o.indoorOnly !== undefined) r.indoorOnly = o.indoorOnly;
    const budget = o.budget ?? (r.budgetBasis === "total" ? { amount: r.budget * base.participants, basis: "total" as const } : undefined);
    if (budget) {
      r.budgetBasis = budget.basis;
      r.budget = budget.basis === "total" ? Math.round((budget.amount / r.participants) * 100) / 100 : budget.amount;
    }
    return r;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, o, profile, now.toFormat("yyyy-MM-dd HH:mm")]);
  const chips = describe(request, now);
  const totalBudget = Math.round(request.budgetBasis === "total" ? request.budget * request.participants : request.budget);

  const ready = Boolean(status && ((status.places && status.ai) || status.demo));
  const plan = (prompt = text) => {
    store.pending.current = { ...request, prompt: prompt.slice(0, 1500) };
    store.track("plan_requested", { words: prompt.trim().split(/\s+/).filter(Boolean).length, edited: Object.keys(o).length });
    router.push("/plan/new");
  };
  const recent = Object.entries(plans)
    .sort((a, b) => b[1].createdAt.localeCompare(a[1].createdAt))
    .slice(0, 4);

  const chipRow: { key: Field; icon: IconName; label: string }[] = [
    { key: "who", icon: companionCopy[request.companions ?? "partner"].icon, label: chips.who },
    { key: "when", icon: "calendar", label: chips.when },
    { key: "budget", icon: "credit-card", label: chips.budget },
    { key: "travel", icon: modeCopy[request.mode].icon, label: chips.travel },
    { key: "length", icon: "clock", label: chips.length },
    { key: "area", icon: "map-pin", label: chips.area },
    { key: "vibe", icon: "star", label: chips.vibe || "Any vibe" },
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.canvas }} edges={["top"]}>
      <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
        <View style={s.header}>
          <Wordmark size={22} />
          {demo ? (
            <View style={s.demoPill} accessibilityLabel="Demo mode">
              <T v="smallStrong" tone={color.warning} style={{ fontSize: 12 }}>
                Demo data
              </T>
            </View>
          ) : null}
        </View>

        <Animated.View entering={FadeInDown.duration(380)}>
          <T v="small" tone={color.muted}>
            {greeting(profile.name)}
          </T>
          <T v="hero" style={{ marginTop: 4 }} accessibilityRole="header">
            What should we do?
          </T>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(60).duration(380)} style={s.composer}>
          <TextInput
            testID="prompt-input"
            value={text}
            onChangeText={setText}
            multiline
            maxLength={1500}
            accessibilityLabel="Describe the experience you want"
            placeholder="A spontaneous Saturday night with my girlfriend, $100 total, romantic but a little adventurous…"
            placeholderTextColor={color.faint}
            style={s.input}
          />
          <View style={s.heardHeader}>
            <T v="eyebrow" tone={color.muted}>
              {text.trim() ? "Here’s what I heard" : "Your defaults"}
            </T>
            {Object.keys(o).length ? (
              <Pressable onPress={() => setO({})} accessibilityRole="button" hitSlop={8}>
                <T v="smallStrong" tone={color.coralText}>
                  Reset
                </T>
              </Pressable>
            ) : null}
          </View>
          <View style={s.chips}>
            {chipRow.map((c) => (
              <Chip key={c.key} testID={`chip-${c.key}`} icon={c.icon} label={c.label} onPress={() => setField(c.key)} tone={c.key === "budget" ? "yellow" : c.key === "vibe" ? "lavender" : "mint"} />
            ))}
            <Chip
              icon="umbrella"
              label={request.indoorOnly ? "Indoors only" : "Indoor or outdoor"}
              selected={request.indoorOnly}
              onPress={() => setO({ ...o, indoorOnly: !request.indoorOnly })}
            />
          </View>
          <View style={s.actions}>
            <Button testID="plan-it" size="lg" label="Plan it" icon="star" onPress={() => plan()} disabled={!ready} style={{ flex: 1 }} />
            <IconButton icon="shuffle" label="Surprise me" onPress={() => plan(text || "Surprise me with something memorable")} />
          </View>
        </Animated.View>

        {status && !ready ? (
          <Notice tone="coral" icon="alert-circle">
            Planning isn’t switched on for this server yet. Add the Google Places and AI keys (see README), or run it in demo mode.
          </Notice>
        ) : !status ? (
          <Notice tone="coral" icon="wifi-off">
            Can’t reach the Whimway server. Check your connection and that the API is running, then pull to retry.
          </Notice>
        ) : demo ? (
          <Notice icon="info">Demo mode: real GTA places, but hours, prices and travel times are estimates. Connect live data before trusting a plan.</Notice>
        ) : null}

        <T v="heading" style={s.section}>
          Need a spark?
        </T>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.md, paddingRight: space.xl }} style={{ marginHorizontal: -space.xl, paddingLeft: space.xl }}>
          {examplePrompts.map((e, i) => (
            <Pressable
              key={e.title}
              accessibilityRole="button"
              accessibilityLabel={`Use idea: ${e.prompt}`}
              onPress={() => setText(e.prompt)}
              style={({ pressed }) => [s.idea, { backgroundColor: [color.mintTint, color.lavenderTint, color.yellowTint, color.coralTint][i % 4] }, pressed && { opacity: 0.8 }]}
            >
              <Icon name={e.icon} size={20} />
              <T v="bodyStrong" style={{ marginTop: space.md }}>
                {e.title}
              </T>
              <T v="small" tone={color.inkSoft} numberOfLines={3}>
                “{e.prompt}”
              </T>
            </Pressable>
          ))}
        </ScrollView>

        {recent.length ? (
          <>
            <T v="heading" style={s.section}>
              Pick up where you left off
            </T>
            <View style={{ gap: space.sm }}>
              {recent.map(([id, e]) => (
                <Pressable key={id} accessibilityRole="button" onPress={() => router.push(`/plan/${id}`)} style={({ pressed }) => [s.recent, pressed && { opacity: 0.75 }]}>
                  <View style={s.recentIcon}>
                    <Icon name={e.saved ? "bookmark" : "clock"} size={16} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <T v="bodyStrong" numberOfLines={1}>
                      {e.meta.title}
                    </T>
                    <T v="small" tone={color.muted} numberOfLines={1}>
                      {DateTime.fromISO(`${e.meta.date}T${e.meta.startTime}`).toFormat("ccc d LLL · h:mm a")} · {e.meta.stops} stops
                    </T>
                  </View>
                  <Icon name="chevron-right" tint={color.faint} />
                </Pressable>
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>

      <Editors field={field} close={() => setField(null)} request={request} o={o} setO={setO} totalBudget={totalBudget} now={now} />
    </SafeAreaView>
  );
}

function Editors({ field, close, request, o, setO, totalBudget, now }: { field: Field | null; close: () => void; request: PlanRequest; o: Overrides; setO: (o: Overrides) => void; totalBudget: number; now: DateTime }) {
  const days = Array.from({ length: 7 }, (_, i) => now.plus({ days: i }));
  const times = ["10:00", "12:00", "14:00", "16:00", "17:30", "18:30", "19:30", "20:30", "21:30"];
  const titles: Record<Field, string> = { who: "Who’s coming?", when: "When?", budget: "Budget", travel: "Getting around", length: "How long?", vibe: "The vibe", area: "Where?" };
  const isPast = (date: string, time: string) => DateTime.fromISO(`${date}T${time}`, { zone: ZONE }) <= now.plus({ minutes: 20 });
  const amount = o.budget?.amount ?? totalBudget;
  const basis = o.budget?.basis ?? request.budgetBasis;
  return (
    <Sheet open={field !== null} onClose={close} title={field ? titles[field] : ""} footer={<Button label="Done" kind="dark" onPress={close} />}>
      {field === "who" ? (
        <View style={{ gap: space.lg }}>
          <View style={s.chips}>
            {companionKeys.map((c) => (
              <Chip key={c} icon={companionCopy[c].icon} label={companionCopy[c].label} selected={request.companions === c} onPress={() => setO({ ...o, companions: c, participants: c === "partner" ? 2 : c === "solo" ? 1 : Math.max(3, request.participants) })} />
            ))}
          </View>
          <Stepper label="People" value={request.participants} min={1} max={20} onChange={(participants) => setO({ ...o, participants })} />
        </View>
      ) : null}
      {field === "when" ? (
        <View style={{ gap: space.lg }}>
          <View style={s.chips}>
            {days.map((d, i) => (
              <Chip key={d.toISODate()} label={i === 0 ? "Today" : i === 1 ? "Tomorrow" : d.toFormat("ccc d")} selected={request.date === d.toISODate()} onPress={() => setO({ ...o, date: d.toISODate()! })} />
            ))}
          </View>
          <View style={s.chips}>
            {times.map((t) => (
              <Chip key={t} label={DateTime.fromISO(`2000-01-01T${t}`).toFormat("h:mm a")} selected={request.startTime === t} onPress={() => !isPast(request.date, t) && setO({ ...o, startTime: t })} tone={isPast(request.date, t) ? "neutral" : "mint"} />
            ))}
          </View>
          <T v="small" tone={color.muted}>
            Times are Toronto time. Past times are skipped.
          </T>
        </View>
      ) : null}
      {field === "budget" ? (
        <View style={{ gap: space.lg }}>
          <View style={s.chips}>
            <Chip label="Total for everyone" selected={basis === "total"} onPress={() => setO({ ...o, budget: { amount: basis === "total" ? amount : Math.round(amount * request.participants), basis: "total" } })} />
            <Chip label="Per person" selected={basis === "person"} onPress={() => setO({ ...o, budget: { amount: basis === "person" ? amount : Math.round(amount / request.participants), basis: "person" } })} />
          </View>
          <Stepper label={basis === "total" ? "Total budget" : "Per person"} prefix="$" value={Math.round(amount)} min={0} max={2000} step={10} onChange={(v) => setO({ ...o, budget: { amount: v, basis } })} />
          <T v="small" tone={color.muted}>
            {basis === "total" ? `≈ $${Math.round(amount / request.participants)} per person. ` : ""}Estimates only — excludes taxes, tips and transport.
          </T>
        </View>
      ) : null}
      {field === "travel" ? (
        <View style={s.chips}>
          {(["WALK", "TRANSIT", "DRIVE"] as const).map((m) => (
            <Chip key={m} icon={modeCopy[m].icon} label={modeCopy[m].label} selected={request.mode === m} onPress={() => setO({ ...o, mode: m })} />
          ))}
        </View>
      ) : null}
      {field === "length" ? (
        <View style={s.chips}>
          {[120, 180, 240, 300, 360, 480].map((d) => (
            <Chip key={d} label={`${d / 60} hours`} selected={request.duration === d} onPress={() => setO({ ...o, duration: d })} />
          ))}
        </View>
      ) : null}
      {field === "vibe" ? (
        <View style={s.chips}>
          {vibeKeys.map((v) => (
            <Chip
              key={v}
              icon={vibeCopy[v].icon}
              label={vibeCopy[v].label}
              selected={request.vibes.includes(v)}
              onPress={() => setO({ ...o, vibes: request.vibes.includes(v) ? request.vibes.filter((x) => x !== v) : [...request.vibes, v].slice(-4) })}
            />
          ))}
        </View>
      ) : null}
      {field === "area" ? (
        <View style={{ gap: space.sm }}>
          {areas.map((a) => (
            <Pressable key={a.key} accessibilityRole="radio" accessibilityState={{ checked: request.location.name === a.name }} onPress={() => setO({ ...o, areaKey: a.key })} style={[s.areaRow, request.location.name === a.name && { borderColor: color.ink, backgroundColor: color.paper }]}>
              <Icon name="map-pin" size={16} tint={request.location.name === a.name ? color.coralText : color.muted} />
              <T v="bodyStrong" style={{ flex: 1 }}>
                {a.name}
              </T>
              <T v="small" tone={color.muted}>
                {a.city}
              </T>
            </Pressable>
          ))}
        </View>
      ) : null}
    </Sheet>
  );
}

function Stepper({ label, value, onChange, min, max, step = 1, prefix = "" }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number; prefix?: string }) {
  return (
    <Card style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
      <T v="bodyStrong" style={{ flex: 1 }}>
        {label}
      </T>
      <IconButton icon="minus" label={`Decrease ${label}`} onPress={() => onChange(Math.max(min, value - step))} />
      <T v="heading" style={{ minWidth: 64, textAlign: "center" }} accessibilityLiveRegion="polite">
        {prefix}
        {value}
      </T>
      <IconButton icon="plus" label={`Increase ${label}`} onPress={() => onChange(Math.min(max, value + step))} />
    </Card>
  );
}

const s = StyleSheet.create({
  page: { padding: space.xl, paddingBottom: space.xxxl, gap: space.lg, maxWidth: 680, width: "100%", alignSelf: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: space.sm },
  demoPill: { backgroundColor: color.yellowTint, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  composer: { backgroundColor: color.paper, borderRadius: radius.xl, borderWidth: 1, borderColor: color.line, padding: space.lg, gap: space.md, ...shadow.lift },
  input: { minHeight: 104, fontFamily: font.body, fontSize: 18, lineHeight: 26, color: color.ink, textAlignVertical: "top", padding: 0 },
  heardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: 1, borderTopColor: color.line, paddingTop: space.md },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  actions: { flexDirection: "row", gap: space.md, alignItems: "center", marginTop: space.xs },
  section: { marginTop: space.lg },
  idea: { width: 210, minHeight: 150, borderRadius: radius.lg, padding: space.lg, gap: 4 },
  recent: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: color.paper, borderWidth: 1, borderColor: color.line, minHeight: 64 },
  recentIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: color.mintTint, alignItems: "center", justifyContent: "center" },
  areaRow: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 50, paddingHorizontal: space.lg, borderRadius: radius.md, borderWidth: 1, borderColor: color.line },
});
