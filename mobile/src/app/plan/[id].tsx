import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { DateTime } from "luxon";
import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, Platform, Pressable, ScrollView, Share, StyleSheet, TextInput, View } from "react-native";
import Animated, { FadeInDown, FadeOut, SlideInDown } from "react-native-reanimated";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { navigationUrl , stopDirectionsUrl } from "@shared/navigation";
import { PlanSpec, toSpec, type Itinerary } from "@shared/schema";
import { shareUrl } from "@shared/share-link";
import { api, ApiError } from "@/lib/api";
import { SHARE_ORIGIN } from "@/lib/config";
import { modeCopy, money } from "@/lib/copy";
import { useStore } from "@/lib/store";
import { FeedbackSheet } from "@/plan/Feedback";
import { MagicEditSheet } from "@/plan/MagicEdit";
import { PlanPulse } from "@/plan/PlanPulse";
import { placeKeys } from "@shared/polls";
import { bookingOptions } from "@shared/booking";
import { countPlan, editsLeft } from "@shared/plus";
import { nearestArea } from "@shared/areas";
import { RouteMap } from "@/plan/RouteMap";
import { Generating, stages } from "@/plan/Generating";
import { StopCard } from "@/plan/StopCard";
import { Badge, Button, Icon, IconButton, Notice, Press, Sheet, T, tap } from "@/ui/kit";
import { color, radius, shadow, space } from "@/ui/theme";

const friendly: Record<string, string> = {
  NO_SUITABLE_PLACES: "Nothing fit all of that",
  RATE_LIMIT: "You’ve planned a lot today",
  GLOBAL_LIMIT: "We’re at capacity today",
  PAST_TIME: "That time has already passed",
  CONFLICTING_REQUEST: "Two parts of that don’t agree",
  OFFLINE: "You’re offline",
  ANCHOR_CLOSED: "That place is closed then",
  TIMEOUT: "That took too long",
};

export default function PlanScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const store = useStore();
  const insets = useSafeAreaInsets();
  const [plan, setPlan] = useState<Itinerary | undefined>(id === "new" ? undefined : store.live[id]);
  const [error, setError] = useState<{ title: string; message: string } | null>(null);
  const [stage, setStage] = useState(0);
  const [selected, setSelected] = useState<string>();
  const [editOpen, setEditOpen] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState("");
  const [changed, setChanged] = useState<string[]>([]);
  const [toast, setToast] = useState<{ text: string; undo?: Itinerary; swapIndex?: number } | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [shareLink, setShareLink] = useState("");
  const [sharing, setSharing] = useState(false);
  const [editsUsed, setEditsUsed] = useState(0);
  const [booking, setBooking] = useState<number | null>(null);
  const [crowd, setCrowd] = useState<Record<string, { up: number; down: number }>>({});
  const stopIds = plan?.stops.map((s) => s.placeId).join(",") ?? "";
  // Community ratings for these venues (the server only returns ones with 5+ people).
  useEffect(() => {
    if (!stopIds) return;
    void api<Record<string, { up: number; down: number }>>(`crowd/places?ids=${encodeURIComponent(stopIds)}`)
      .then(setCrowd)
      .catch(() => undefined);
  }, [stopIds]);
  const started = useRef(Date.now());
  const once = useRef(false);
  const entry = plan ? store.plans[plan.id] : store.plans[id];

  const fail = (e: unknown) => {
    const err = e instanceof ApiError ? e : new ApiError((e as Error).message);
    // The server enforces the free monthly allowance; send people to Plus instead of an error.
    if (err.code === "PLAN_LIMIT") return router.replace({ pathname: "/plus", params: { reason: "limit" } });
    setError({ title: friendly[err.code] ?? "We couldn’t build that plan", message: err.message });
  };

  // New plan: generate from the pending request.
  const generate = useCallback(async () => {
    const request = store.pendingRef.current;
    if (!request) {
      router.replace("/");
      return;
    }
    setError(null);
    setStage(0);
    started.current = Date.now();
    // Demo answers instantly; hold the route animation briefly so the moment reads. Live data sets its own pace.
    const timer = setInterval(() => setStage((s) => Math.min(stages.length - 1, s + 1)), store.demo ? 520 : 3500);
    const minimum = new Promise((resolve) => setTimeout(resolve, store.demo ? 2500 : 0));
    try {
      const [result] = await Promise.all([api<Itinerary>("generate", { request, demo: store.demo }), minimum]);
      store.remember(result);
      // Count against this month's free allowance and the lifetime summary.
      store.setProfile(countPlan({ ...store.profile, stats: { ...store.profile.stats, plans: store.profile.stats.plans + 1 } }));
      store.track("plan_generated", { ms: Date.now() - started.current, stops: result.stops.length, demo: result.demo, mode: result.request.mode });
      tap("success");
      setPlan(result);
      setSelected(result.stops[0]?.placeId);
      router.setParams({ id: result.id });
    } catch (e) {
      store.track("plan_failed", { code: e instanceof ApiError ? e.code : "UNKNOWN" });
      fail(e);
    } finally {
      clearInterval(timer);
    }
  }, [store]);

  // Saved/recent plan: re-hydrate live venue data from stored IDs.
  const hydrate = useCallback(async () => {
    const saved = store.plans[id];
    if (!saved) {
      setError({ title: "Plan not found", message: "This plan isn’t on this device anymore." });
      return;
    }
    setError(null);
    try {
      const result = await api<Itinerary>("hydrate", saved.spec);
      store.remember({ ...result, id: saved.spec.id });
      setPlan({ ...result, id: saved.spec.id });
      setSelected(result.stops[0]?.placeId);
      store.track("plan_viewed", { saved: saved.saved });
    } catch (e) {
      fail(e);
    }
  }, [id, store]);

  useEffect(() => {
    if (once.current) return;
    once.current = true;
    if (id === "new") void generate();
    else if (!plan) void hydrate();
    else setSelected(plan.stops[0]?.placeId);
  }, [id, plan, generate, hydrate]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const update = (next: Itinerary) => {
    setPlan(next);
    store.remember(next);
  };

  const magicEdit = async (instruction: string) => {
    if (!plan) return;
    if (editsLeft(store.profile, editsUsed) <= 0) {
      setEditOpen(false);
      router.push({ pathname: "/plus", params: { reason: "edits" } });
      return;
    }
    setEditBusy(true);
    setEditError("");
    try {
      const result = await api<{ plan: Itinerary; changed: string[]; summary: string; done: string; kind: string }>("magic-edit", { spec: toSpec(plan), instruction });
      const before = plan;
      update(result.plan);
      setChanged(result.changed);
      setSelected(result.changed[0] ?? result.plan.stops[0]?.placeId);
      setToast({ text: result.done, undo: before });
      setEditOpen(false);
      tap("success");
      setEditsUsed((n) => n + 1);
      store.setProfile({ ...store.profile, stats: { ...store.profile.stats, edits: store.profile.stats.edits + 1 } });
      store.track("magic_edit_applied", { kind: result.kind, changed: result.changed.length });
    } catch (e) {
      if (e instanceof ApiError && e.code === "EDIT_LIMIT") {
        setEditOpen(false);
        router.push({ pathname: "/plus", params: { reason: "edits" } });
      } else setEditError(e instanceof Error ? e.message : "That edit didn’t work. Try wording it differently.");
    } finally {
      setEditBusy(false);
    }
  };

  const toggleLock = (index: number) => {
    if (!plan) return;
    const stops = plan.stops.map((s, i) => (i === index ? { ...s, locked: !s.locked } : s));
    update({ ...plan, stops });
    store.track("stop_locked", { locked: stops[index].locked });
  };

  const swap = (index: number) => {
    if (!plan) return;
    const ordinal = ["first", "second", "third", "fourth", "fifth", "sixth"][index] ?? "last";
    void magicEdit(index === plan.stops.length - 1 ? "Change the last stop" : `Swap the ${ordinal} stop for something different`);
  };

  const save = async () => {
    if (!plan) return;
    const saved = !entry?.saved;
    store.remember(plan, { saved });
    tap(saved ? "success" : "light");
    if (saved) {
      store.track("plan_saved", { demo: plan.demo });
      if (store.session && !plan.demo) void api("plans", toSpec(plan)).catch(() => undefined);
    }
    setToast({ text: saved ? "Saved. Find it anytime in Saved." : "Removed from Saved." });
  };

  const share = async () => {
    if (!plan) return;
    setSharing(true);
    let url = shareUrl(SHARE_ORIGIN, PlanSpec.parse(plan));
    // Signed-in users get a short, revocable link; everyone else a private fragment link.
    if (store.session && !plan.demo) {
      try {
        await api("plans", toSpec(plan));
        const { shareId } = await api<{ shareId: string }>("share", { id: plan.id });
        url = `${SHARE_ORIGIN}/s/${shareId}`;
      } catch {
        // Fall back to the account-free link.
      }
    }
    const day = DateTime.fromISO(`${plan.request.date}T${plan.request.startTime}`).toFormat("cccc h:mm a");
    const message = `${plan.title} — ${day}\n${plan.stops.map((s, i) => `${i + 1}. ${s.place.name}`).join("\n")}\n\nSee the plan (and make it yours): ${url}`;
    store.setProfile({ ...store.profile, stats: { ...store.profile.stats, shares: store.profile.stats.shares + 1 } });
    store.track("plan_shared", { via: url.includes("/s/") ? "account" : "link", demo: plan.demo });
    setSharing(false);
    try {
      if (Platform.OS === "web" && !(typeof navigator !== "undefined" && "share" in navigator)) throw new Error("no share");
      await Share.share(Platform.OS === "ios" ? { message, url } : { message, title: plan.title });
    } catch {
      setShareLink(url);
    }
  };

  const go = () => {
    if (!plan) return;
    const url = navigationUrl(plan) ?? (plan.stops[0] ? (plan.demo ? plan.stops[0].place.mapsUrl : undefined) : undefined);
    const first = plan.stops[0];
    const fallback = first ? `https://www.google.com/maps/dir/?api=1&destination=${first.place.point.lat},${first.place.point.lng}&destination_place_id=${first.placeId}&travelmode=${plan.request.mode === "TRANSIT" ? "transit" : plan.request.mode === "WALK" ? "walking" : "driving"}` : undefined;
    const target = url ?? fallback;
    if (!target) return;
    store.track("navigation_opened", { scope: url ? "route" : "first-stop" });
    void Linking.openURL(target);
  };

  // ---------- States ----------
  if (error)
    return (
      <SafeAreaView style={s.center}>
        <View style={s.stateIcon}>
          <Icon name="compass" size={28} />
        </View>
        <T v="title" style={{ textAlign: "center" }}>
          {error.title}
        </T>
        <T v="body" tone={color.muted} style={{ textAlign: "center", maxWidth: 360 }}>
          {error.message}
        </T>
        <View style={{ flexDirection: "row", gap: space.md, marginTop: space.lg }}>
          <Button kind="soft" label="Change request" icon="edit-2" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
          <Button label="Try again" icon="refresh-cw" onPress={() => (id === "new" && !plan ? generate() : hydrate())} />
        </View>
      </SafeAreaView>
    );
  if (!plan)
    return (
      <SafeAreaView style={s.center}>
        <Generating stage={stage} refreshing={id !== "new"} />
      </SafeAreaView>
    );

  // ---------- Plan ----------
  const zone = plan.request.location.timezone;
  const start = DateTime.fromISO(plan.stops[0]?.arrival ?? "").setZone(zone);
  const end = DateTime.fromISO(plan.stops.at(-1)?.departure ?? "").setZone(zone);
  const people = plan.request.participants;
  const perPerson = plan.cost.high === 0 ? "Free" : `${money(plan.cost.low, plan.cost.currency)}–${money(plan.cost.high, plan.cost.currency)}`;
  const isPast = start.isValid && start < DateTime.now();
  const warnings = plan.issues.filter((i) => !["HOURS_UNCERTAIN"].includes(i.code) || plan.demo === false);
  return (
    <View style={{ flex: 1, backgroundColor: color.canvas }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 140 + insets.bottom }}>
        <LinearGradient colors={[color.ink, "#24394A"]} style={[s.hero, { paddingTop: insets.top + space.md }]}>
          <View style={s.heroInner}>
          <View style={s.heroTop}>
            <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} style={s.heroBtn}>
              <Icon name="arrow-left" tint={color.paper} />
            </Pressable>
            {plan.demo ? <Badge tone="yellow" label="Demo estimates" /> : null}
          </View>
          <Animated.View entering={FadeInDown.duration(420)}>
            <T v="eyebrow" tone={color.mint} style={{ marginTop: space.lg }}>
              {start.isValid ? start.toFormat("cccc d LLLL") : plan.request.date} in {plan.request.location.name}
            </T>
            <T v="hero" tone={color.paper} style={{ marginTop: space.sm }} testID="plan-title" accessibilityRole="header">
              {plan.title}
            </T>
            <T v="body" tone="#C9D1D6" style={{ marginTop: space.sm }}>
              {plan.summary}
            </T>
          </Animated.View>
          <Animated.View entering={FadeInDown.delay(80).duration(420)} style={s.stats}>
            <Stat value={start.isValid ? start.toFormat("h:mm a") : "—"} label={end.isValid ? `until ${end.toFormat("h:mm a")}` : ""} />
            <View style={s.statRule} />
            <Stat
              value={plan.cost.high === 0 ? "Free" : perPerson}
              label={plan.cost.high === 0 ? "nothing to pay" : plan.request.budgetBasis === "total" ? `each, about ${money(plan.cost.high * people)} for ${people}` : "each"}
            />
            <View style={s.statRule} />
            <Stat value={`${plan.stops.length} ${plan.stops.length === 1 ? "stop" : "stops"}`} label={`${(plan.totalMeters / 1000).toFixed(1)} km ${modeCopy[plan.request.mode].label.toLowerCase()}`} />
          </Animated.View>
          </View>
        </LinearGradient>

        <View style={s.content}>
          <RouteMap plan={plan} selected={selected} onSelect={setSelected} />

          <PlanPulse key={`${plan.id}-${plan.revision}`} plan={plan} onFix={(instruction) => void magicEdit(instruction)} />

          {plan.cost.unknown || plan.cost.high > plan.request.budget ? (
            <Notice icon="credit-card">
              {plan.cost.high > plan.request.budget ? `Top of the range is above your ${money(plan.request.budget)}/person budget. Try “make it cheaper”. ` : ""}
              {plan.cost.unknown ? `${plan.cost.unknown} stop${plan.cost.unknown > 1 ? "s have" : " has"} no published price.` : ""}
            </Notice>
          ) : null}

          <View>
            {plan.stops.map((stop, i) => {
              const next = plan.stops[i + 1];
              const leg = next ? plan.legs.find((l) => l.to === next.placeId) : undefined;
              return (
                <View key={stop.placeId}>
                  <StopCard
                    nextLeg={next ? { minutes: next.travel, meters: leg?.meters, verified: Boolean(leg?.verified) } : undefined}
                    plan={plan}
                    index={i}
                    selected={selected === stop.placeId}
                    isNew={changed.includes(stop.placeId)}
                    onSelect={() => setSelected(stop.placeId)}
                    onToggleLock={() => toggleLock(i)}
                    onSwap={() => swap(i)}
                    onBook={() => setBooking(i)}
                    crowd={crowd[stop.placeId]}
                    favourite={store.profile.favourites.some((f) => f.id === stop.placeId)}
                    onFavourite={() => {
                      const p = store.profile;
                      const has = p.favourites.some((f) => f.id === stop.placeId);
                      const cat = stop.place.category.toLowerCase().slice(0, 60);
                      store.setProfile({
                        ...p,
                        favourites: has
                          ? p.favourites.filter((f) => f.id !== stop.placeId)
                          : [{ id: stop.placeId, name: stop.place.name.slice(0, 120), area: nearestArea(stop.place.point)?.key, category: cat }, ...p.favourites].slice(0, 100),
                        affinity: has ? p.affinity : { ...p.affinity, [cat]: Math.min(3, (p.affinity[cat] ?? 0) + 0.3) },
                      });
                      if (!has) store.react("stop", placeKeys(stop.place).map((key) => ({ key, value: 1 as const })));
                      setToast({ text: has ? `Removed ${stop.place.name} from your places.` : `Saved ${stop.place.name}. Plan around it anytime from You.` });
                    }}
                    onReact={(value) => {
                      store.react("stop", placeKeys(stop.place).map((key) => ({ key, value })));
                      store.track("stop_reacted", { value });
                      if (value === -1) {
                        // Never suggest this exact place to this user again, and offer a swap now.
                        store.setProfile({ ...store.profile, disliked: [...new Set([...store.profile.disliked, stop.placeId])].slice(-100) });
                        setToast({ text: `Got it — we’ll skip ${stop.place.name} from now on.`, swapIndex: i });
                      } else setToast({ text: `Noted — more places like ${stop.place.name}.` });
                    }}
                    onOpenLink={(kind) => store.track(kind === "booking" ? "booking_link_opened" : "navigation_opened", { scope: "stop" })}
                  />
                </View>
              );
            })}
          </View>

          {warnings.length ? (
            <View style={s.goodToKnow}>
              <T v="bodyStrong">Good to know</T>
              {warnings.map((w) => (
                <View key={w.code} style={{ flexDirection: "row", gap: space.sm }}>
                  <Icon name="info" size={14} tint={color.muted} />
                  <T v="small" tone={color.inkSoft} style={{ flex: 1 }}>
                    {w.message}
                  </T>
                </View>
              ))}
              {plan.demo ? (
                <T v="small" tone={color.warning}>
                  Demo mode: these are real places, but hours, prices and travel times are estimates, not live data.
                </T>
              ) : null}
            </View>
          ) : null}

          <Pressable accessibilityRole="button" onPress={() => setFeedbackOpen(true)} style={[s.feedback, isPast && !entry?.feedback && { borderColor: color.coral }]} testID="feedback-open">
            <Icon name={entry?.feedback ? "check-circle" : "message-circle"} />
            <View style={{ flex: 1 }}>
              <T v="bodyStrong">{entry?.feedback ? "Thanks for the feedback" : isPast ? "How did it go?" : "Back from it? Tell us how it went"}</T>
              <T v="small" tone={color.muted}>
                Your reactions tune the next plan.
              </T>
            </View>
            <Icon name="chevron-right" tint={color.faint} />
          </Pressable>
        </View>
      </ScrollView>

      {toast ? (
        <Animated.View entering={SlideInDown.duration(260)} exiting={FadeOut.duration(160)} style={[s.toast, { bottom: 96 + insets.bottom }]} accessibilityLiveRegion="polite">
          <Icon name="star" size={16} tint={color.coral} />
          <T v="small" tone={color.paper} style={{ flex: 1 }}>
            {toast.text}
          </T>
          {toast.swapIndex !== undefined ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                const i = toast.swapIndex!;
                setToast(null);
                swap(i);
              }}
              hitSlop={10}
            >
              <T v="smallStrong" tone={color.coral}>
                Swap it
              </T>
            </Pressable>
          ) : null}
          {toast.undo ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                update(toast.undo!);
                setChanged([]);
                setToast(null);
              }}
              hitSlop={10}
            >
              <T v="smallStrong" tone={color.coral}>
                Undo
              </T>
            </Pressable>
          ) : null}
        </Animated.View>
      ) : null}

      <View style={[s.bar, { paddingBottom: Math.max(insets.bottom, space.md) }]}>
        <View style={s.barInner}>
        <Button testID="magic-edit" label="Magic edit" icon="star" kind="dark" onPress={() => { setEditError(""); setEditOpen(true); }} style={{ flex: 1 }} />
        <IconButton icon={entry?.saved ? "check" : "bookmark"} label={entry?.saved ? "Saved" : "Save plan"} active={entry?.saved} onPress={save} />
        <IconButton icon={sharing ? "loader" : "share"} label="Share plan" onPress={share} />
        <IconButton icon="navigation" label="Start: open directions" onPress={go} tint={color.coralText} />
        </View>
      </View>

      <MagicEditSheet open={editOpen} onClose={() => setEditOpen(false)} plan={plan} busy={editBusy} error={editError} onApply={magicEdit} />
      <FeedbackSheet
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        plan={plan}
        onSubmit={async (f) => {
          const where = await store.submitFeedback(plan, f);
          setFeedbackOpen(false);
          setToast({ text: where === "account" ? "Thanks! Saved to your account and your next plans will reflect it." : "Thanks! Your next plans will reflect it." });
        }}
      />
      <Sheet open={booking !== null} onClose={() => setBooking(null)} title={booking !== null ? plan.stops[booking].place.name : ""}>
        {booking !== null
          ? bookingOptions(plan.stops[booking].place, {
              date: plan.request.date,
              time: DateTime.fromISO(plan.stops[booking].arrival).setZone(zone).toFormat("HH:mm"),
              people,
              mode: plan.request.mode,
              demo: plan.demo,
              directionsUrl: plan.demo
                ? plan.stops[booking].place.mapsUrl
                : stopDirectionsUrl({ point: plan.stops[booking].place.point, placeId: plan.stops[booking].placeId }, plan.request.mode, booking > 0 ? plan.stops[booking - 1].place.point : undefined),
            }).map((o) => (
              <Press
                key={o.kind}
                testID={`book-${o.kind}`}
                accessibilityRole="link"
                accessibilityLabel={`${o.label}. ${o.hint}`}
                onPress={() => {
                  store.track(o.kind === "directions" || o.kind === "ride" ? "navigation_opened" : "booking_link_opened", { kind: o.kind, scope: "stop" });
                  void Linking.openURL(o.url);
                }}
                style={s.bookRow}
              >
                <View style={s.bookIcon}>
                  <Icon name={o.icon} size={17} />
                </View>
                <View style={{ flex: 1 }}>
                  <T v="bodyStrong">{o.label}</T>
                  <T v="small" tone={color.muted}>
                    {o.hint}
                  </T>
                </View>
                <Icon name="arrow-up-right" size={16} tint={color.faint} />
              </Press>
            ))
          : null}
        <T v="small" tone={color.muted} style={{ marginTop: space.md }}>
          These open the venue or a booking service. Whimway hasn’t reserved anything or checked availability.
        </T>
      </Sheet>
      <Sheet open={Boolean(shareLink)} onClose={() => setShareLink("")} title="Share this plan">
        <T v="body" tone={color.muted}>
          Anyone with this link can view the plan and make their own copy — no app needed. Your prompt, dietary and accessibility notes aren’t included.
        </T>
        <TextInput value={shareLink} editable={false} selectTextOnFocus multiline style={s.link} accessibilityLabel="Share link" testID="share-link" />
      </Sheet>
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={s.stat}>
      <T v="heading" tone={color.paper} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {value}
      </T>
      <T v="small" tone="#AEB9C0" style={{ fontSize: 12, lineHeight: 16 }} numberOfLines={2}>
        {label}
      </T>
    </View>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, padding: space.xl, backgroundColor: color.canvas },
  stateIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: color.mintTint, alignItems: "center", justifyContent: "center" },
  orb: { width: 72, height: 72, borderRadius: 36, backgroundColor: color.coral, alignItems: "center", justifyContent: "center", ...shadow.lift },
  stageRow: { flexDirection: "row", gap: 6 },
  stageDot: { width: 28, height: 4, borderRadius: 2, backgroundColor: color.line },
  hero: { paddingHorizontal: space.xl, paddingBottom: space.xl, borderBottomLeftRadius: radius.xl, borderBottomRightRadius: radius.xl, alignItems: "center" },
  heroInner: { width: "100%", maxWidth: 720 },
  heroTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  heroBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.12)", alignItems: "center", justifyContent: "center" },
  stats: { flexDirection: "row", marginTop: space.xl, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: radius.lg, paddingVertical: space.md },
  stat: { flex: 1, paddingHorizontal: space.md, gap: 2 },
  statRule: { width: 1, backgroundColor: "rgba(255,255,255,0.14)" },
  content: { padding: space.lg, gap: space.lg, maxWidth: 720, width: "100%", alignSelf: "center" },
  goodToKnow: { gap: space.sm, padding: space.lg, borderRadius: radius.lg, backgroundColor: color.paper, borderWidth: 1, borderColor: color.line },
  feedback: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.lg, borderRadius: radius.lg, backgroundColor: color.paper, borderWidth: 1, borderColor: color.line },
  toast: { position: "absolute", left: space.lg, right: space.lg, flexDirection: "row", alignItems: "center", gap: space.sm, backgroundColor: color.ink, padding: space.md, borderRadius: radius.md, maxWidth: 680, alignSelf: "center", ...shadow.lift },
  bar: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.md, backgroundColor: color.paper, borderTopWidth: 1, borderTopColor: color.line, justifyContent: "center" },
  barInner: { flex: 1, maxWidth: 720, flexDirection: "row", gap: space.sm },
  bookRow: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: color.paper, borderWidth: 1, borderColor: color.line, marginBottom: space.sm, minHeight: 64 },
  bookIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: color.mintTint, alignItems: "center", justifyContent: "center" },
  link: { marginTop: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: color.paper, borderWidth: 1, borderColor: color.line, fontSize: 13, color: color.ink },
});
