import React, { useRef, useState, useEffect, useCallback } from "react";
import {
  Text,
  View,
  Pressable,
  TextInput,
  ScrollView,
  Linking,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, useFocusEffect, router } from "expo-router";
import { DateTime } from "luxon";
import {
  MoreHorizontal,
  LockKeyhole,
  Footprints,
  Bookmark,
} from "lucide-react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  LinearTransition,
  useReducedMotion,
} from "react-native-reanimated";
import {
  Screen,
  styles,
  Button,
  Chip,
  Notice,
  Sheet,
  Header,
  Reveal,
} from "../../src/components/ui";
import { PlacePhoto } from "../../src/components/PlacePhoto";
import RouteMap from "../../src/components/RouteMap";
import { usePlan } from "../../src/state/usePlan";
import { useApp } from "../../src/state/AppState";
import { api } from "../../src/services/api";
import {
  schedulePlanReminders,
  cancelPlanReminders,
} from "../../src/services/notifications";
import { sharePlan, shareCloudPlan } from "../../src/services/share";
import { savePlan, saveFavoritePlace } from "../../src/services/storage";
import { colors as c } from "../../src/design/theme";
import {
  remixActions,
  toSpec,
  type Itinerary,
  type ItineraryStop,
  type CandidatePlace,
  type PlanRequest,
} from "../../../../lib/schema";
import { money, timeLabel } from "../../../../lib/time";
export default function PlanScreen() {
  const { reminderError } = useApp();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { plan, setPlan, loading, error, setError, reload } = usePlan(id);
  const [selected, setSelected] = useState<string>();
  const [menu, setMenu] = useState<ItineraryStop>();
  const [remix, setRemix] = useState(false);
  const [add, setAdd] = useState(false);
  const [alternatives, setAlternatives] = useState<CandidatePlace[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [map, setMap] = useState(false);
  const [settings, setSettings] = useState(false);
  const [saveSheet, setSaveSheet] = useState(false);
  const [share, setShare] = useState(false);
  const [reminders, setReminders] = useState(false);
  const [upcoming, setUpcoming] = useState(false);
  const [before, setBefore] = useState(15);
  const [budget, setBudget] = useState("");
  const [duration, setDuration] = useState("");
  const [visit, setVisit] = useState("");
  const [query, setQuery] = useState("");
  const [history, setHistory] = useState<Itinerary[]>([]);
  const scroll = useRef<ScrollView>(null);
  const positions = useRef<Record<string, number>>({});
  const pendingScroll = useRef<string | null>(null);
  const operationLock = useRef(false);
  const request = useRef<AbortController | null>(null);
  const currentPlan = useRef(plan);
  useEffect(() => {
    currentPlan.current = plan;
  }, [plan]);
  useFocusEffect(
    useCallback(
      () => () => {
        request.current?.abort();
        operationLock.current = false;
      },
      [],
    ),
  );
  const reduced = useReducedMotion();
  const y = useSharedValue(0);
  const pan = Gesture.Pan()
    .onUpdate((e) => {
      y.set(Math.max(0, Math.min(90, e.translationY)));
    })
    .onEnd(() => {
      y.set(reduced ? 0 : withSpring(0, { damping: 18 }));
    });
  const panel = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value }],
  }));
  function cancelWork() {
    request.current?.abort();
    operationLock.current = false;
    setBusy(false);
  }
  async function operation(work: (signal: AbortSignal) => Promise<Itinerary>) {
    if (!plan || operationLock.current) return false;
    operationLock.current = true;
    const controller = new AbortController();
    request.current = controller;
    const revision = plan.revision;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const next = await work(controller.signal);
      if (controller.signal.aborted) return false;
      if (
        currentPlan.current?.id !== plan.id ||
        currentPlan.current.revision !== revision
      )
        throw new Error(
          "Your plan changed during this request. Try the change again.",
        );
      await setPlan(next, { signal: controller.signal });
      setHistory((h) => [plan, ...h].slice(0, 10));
      setMenu(undefined);
      setAdd(false);
      setRemix(false);
      setSettings(false);
      setMessage("Your route, timing and estimates are updated.");
      return true;
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
      return false;
    } finally {
      if (request.current === controller) {
        setBusy(false);
        operationLock.current = false;
      }
    }
  }
  async function edit(stops = plan!.stops, request?: PlanRequest) {
    await operation((signal) =>
      api<Itinerary>(
        "edit",
        {
          spec: toSpec(plan!),
          stops: stops.map((s) => ({
            placeId: s.placeId,
            minutes: s.minutes,
            reason: s.reason,
            locked: s.locked,
          })),
          request,
        },
        { signal },
      ),
    );
  }
  async function search() {
    if (!plan || operationLock.current) return;
    operationLock.current = true;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    try {
      setAlternatives(
        (
          await api<CandidatePlace[]>(
            "explore",
            {
              request: plan.request,
              query: query || undefined,
              demo: plan.demo,
            },
            { signal: controller.signal },
          )
        ).filter((p) => !plan.stops.some((s) => s.placeId === p.id)),
      );
      if (!controller.signal.aborted) setAdd(true);
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      if (request.current === controller) {
        setBusy(false);
        operationLock.current = false;
      }
    }
  }
  async function replace(place: CandidatePlace) {
    if (!plan) return;
    if (!menu && plan.stops.length >= 8) {
      setError(
        "A day can hold up to eight stops. Remove a stop before adding another.",
      );
      return;
    }
    const ref = {
      placeId: place.id,
      minutes: menu?.minutes || 45,
      locked: false,
      reason: "Chosen for your outing.",
    };
    const stops = plan.stops.map((s) => ({
      placeId: s.placeId,
      minutes: s.minutes,
      reason: s.reason,
      locked: s.locked,
    }));
    if (menu) {
      const i = stops.findIndex((s) => s.placeId === menu.placeId);
      stops[i] = ref;
    } else stops.push(ref);
    await operation((signal) =>
      api<Itinerary>("edit", { spec: toSpec(plan), stops }, { signal }),
    );
  }
  async function remind() {
    if (!plan) return;
    setBusy(true);
    setError("");
    try {
      const result = await schedulePlanReminders(plan, {
        beforeMinutes: before,
        upcomingStops: upcoming,
        stopBeforeMinutes: 5,
      });
      setMessage(
        result.status === "scheduled"
          ? result.count +
              " reminders scheduled. Delivery timing depends on your phone."
          : result.status === "denied"
            ? "Reminders are off. You can enable them in device settings."
            : result.status === "past"
              ? "There are no future reminders for this outing."
              : "Reminders are available in the native iOS or Android app.",
      );
      setReminders(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function focus(stopId: string) {
    setSelected(stopId);
    if (!map)
      scroll.current?.scrollTo({
        y: positions.current[stopId] || 0,
        animated: !reduced,
      });
  }
  if (!plan)
    return (
      <Screen>
        <Header title="Your plan" />
        <Text style={styles.title}>
          {loading ? "Opening your day…" : "Let’s reconnect."}
        </Text>
        {loading ? <ActivityIndicator color={c.ink} /> : null}
        <Notice message={error} error />
        {!loading ? (
          <Button title="Try again" onPress={() => void reload()} />
        ) : null}
      </Screen>
    );
  const selectedStop = plan.stops.find((s) => s.placeId === selected);
  return (
    <Screen scroll={false} style={{ padding: 0 }}>
      <View style={{ paddingHorizontal: 24, paddingTop: 16 }}>
        <Header title="YOUR GOOD DAY" />
        <View
          style={[
            styles.row,
            { justifyContent: "space-between", marginBottom: 12 },
          ]}
        >
          <Chip label={map ? "Timeline" : "Map"} onPress={() => setMap(!map)} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save plan"
            onPress={() => setSaveSheet(true)}
            style={{ padding: 12 }}
          >
            <Bookmark size={22} color={c.ink} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Share plan"
            onPress={() => setShare(true)}
            style={{ padding: 12 }}
          >
            <Text style={styles.label}>Share ↗</Text>
          </Pressable>
        </View>
      </View>
      <Notice message={error || reminderError} error />
      <Notice message={message} />
      {map ? (
        <View style={{ flex: 1 }}>
          <RouteMap
            plan={plan}
            selectedId={selected}
            onSelectStop={focus}
            style={{ flex: 1 }}
          />
          <GestureDetector gesture={pan}>
            <Animated.View
              style={[
                {
                  padding: 24,
                  paddingTop: 12,
                  backgroundColor: c.paper,
                  borderTopLeftRadius: 28,
                  borderTopRightRadius: 28,
                  gap: 12,
                },
                panel,
              ]}
            >
              <View
                style={{
                  width: 40,
                  height: 4,
                  backgroundColor: c.line,
                  alignSelf: "center",
                  borderRadius: 2,
                }}
              />
              <Text style={styles.heading}>
                {selectedStop?.place.name || plan.title}
              </Text>
              <Text style={styles.body}>
                {selectedStop
                  ? timeLabel(
                      selectedStop.arrival,
                      plan.request.location.timezone,
                    ) +
                    " · " +
                    selectedStop.minutes +
                    " min"
                  : plan.stops.length +
                    " stops · " +
                    Math.round(plan.totalMeters / 100) / 10 +
                    " km"}
              </Text>
              {selectedStop ? (
                <Button
                  secondary
                  title="See this stop"
                  onPress={() => {
                    pendingScroll.current = selectedStop.placeId;
                    setMap(false);
                  }}
                />
              ) : null}
              <Button
                title="Start my day"
                onPress={() => router.push("/day/" + id)}
              />
            </Animated.View>
          </GestureDetector>
        </View>
      ) : (
        <ScrollView
          ref={scroll}
          contentContainerStyle={{
            padding: 24,
            paddingTop: 6,
            paddingBottom: 40,
            gap: 20,
          }}
        >
          <Reveal>
            <Text style={styles.eyebrow}>
              {plan.request.location.name.toUpperCase()}
            </Text>
            <Text style={[styles.title, { marginVertical: 12 }]}>
              {plan.title}
            </Text>
            <Text style={styles.body}>{plan.summary}</Text>
            <View
              style={[styles.row, { flexWrap: "wrap", marginTop: 18, gap: 14 }]}
            >
              <Text style={styles.label}>
                {DateTime.fromISO(plan.request.date).toFormat("ccc, LLL d")}
              </Text>
              <Text style={styles.label}>
                {Math.round(plan.totalMinutes / 6) / 10} hrs
              </Text>
              <Text style={styles.label}>{plan.stops.length} stops</Text>
            </View>
            <Text style={[styles.body, { marginTop: 10 }]}>
              {money(plan.cost.low, plan.cost.currency)}–
              {money(plan.cost.high, plan.cost.currency)} estimated / person
              {plan.cost.unknown ? " + unknown prices" : ""}
            </Text>
            <View style={{ marginTop: 20 }}>
              <Button
                title="Start my day"
                onPress={() => router.push("/day/" + id)}
              />
            </View>
          </Reveal>
          {plan.demo ? (
            <Notice message="Development fixture. These places, prices and travel estimates are synthetic; this is not a real outing." />
          ) : null}
          <View style={[styles.row, { flexWrap: "wrap" }]}>
            <Chip label="Day Remix ✦" onPress={() => setRemix(true)} />
            <Chip
              label="Adjust plan"
              onPress={() => {
                setBudget(String(plan.request.budget));
                setDuration(String(plan.request.duration));
                setSettings(true);
              }}
            />
            {plan.stops.length < 8 ? (
              <Chip
                label="Add a stop +"
                onPress={() => {
                  setMenu(undefined);
                  setAdd(true);
                  setAlternatives([]);
                }}
              />
            ) : (
              <Text style={styles.label}>Eight stops · your day is full</Text>
            )}
          </View>
          {plan.stops.map((stop, index) => (
            <Animated.View
              key={stop.placeId}
              layout={reduced ? undefined : LinearTransition.springify()}
              onLayout={(event) => {
                const top = event.nativeEvent.layout.y;
                positions.current[stop.placeId] = top;
                if (pendingScroll.current === stop.placeId) {
                  pendingScroll.current = null;
                  requestAnimationFrame(() =>
                    scroll.current?.scrollTo({
                      y: top,
                      animated: !reduced,
                    }),
                  );
                }
              }}
              style={{ gap: 12, opacity: busy ? 0.65 : 1 }}
            >
              <Reveal delay={Math.min(index * 60, 240)}>
                <View style={[styles.row, { marginBottom: 12 }]}>
                  <View
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 17,
                      backgroundColor:
                        selected === stop.placeId ? "#C54532" : c.ink,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text style={[styles.label, { color: c.white }]}>
                      {index + 1}
                    </Text>
                  </View>
                  <Text style={[styles.label, { flex: 1 }]}>
                    {timeLabel(stop.arrival, plan.request.location.timezone)} ·{" "}
                    {stop.minutes} min
                  </Text>
                  {stop.locked ? <LockKeyhole size={17} color={c.ink} /> : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={"Customize " + stop.place.name}
                    disabled={busy}
                    onPress={() => {
                      setMenu(stop);
                      setVisit(String(stop.minutes));
                    }}
                    style={{ padding: 12 }}
                  >
                    <MoreHorizontal size={24} color={c.ink} />
                  </Pressable>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={"Show " + stop.place.name + " on map"}
                  onPress={() => {
                    setSelected(stop.placeId);
                    setMap(true);
                  }}
                >
                  <PlacePhoto place={stop.place} demo={plan.demo} />
                  <Text style={[styles.heading, { marginTop: 14 }]}>
                    {stop.place.name}
                  </Text>
                </Pressable>
                <Text style={[styles.body, { marginTop: 5 }]}>
                  {stop.reason}
                </Text>
                <View style={[styles.row, { marginTop: 10, flexWrap: "wrap" }]}>
                  <Text style={styles.label}>
                    {stop.place.price.high === null
                      ? "Price unknown"
                      : money(stop.place.price.low || 0, plan.cost.currency) +
                        "–" +
                        money(stop.place.price.high, plan.cost.currency) +
                        " est."}
                  </Text>
                  <Text style={[styles.body, { fontSize: 12 }]}>
                    {stop.hoursStatus}
                  </Text>
                </View>
                {stop.travel ? (
                  <View style={[styles.row, { marginTop: 14 }]}>
                    <Footprints size={16} color={c.muted} />
                    <Text style={[styles.body, { fontSize: 13 }]}>
                      {Math.round(stop.travel)} min{" "}
                      {plan.request.mode === "WALK" ? "walk" : "drive"} from
                      previous stop{plan.demo ? " · synthetic" : ""}
                    </Text>
                  </View>
                ) : null}
              </Reveal>
              <View style={styles.divider} />
            </Animated.View>
          ))}
          <Button
            secondary
            title="Want reminders for your day?"
            onPress={() => setReminders(true)}
          />
          {history.length ? (
            <Button
              secondary
              title="Undo last change"
              onPress={() => {
                const previous = history[0];
                void operation((signal) =>
                  api<Itinerary>(
                    "hydrate",
                    { ...toSpec(previous), revision: plan.revision + 1 },
                    { signal },
                  ),
                ).then((success) => {
                  if (success) setHistory(history.slice(1));
                });
              }}
            />
          ) : null}
          {plan.issues.map((issue, i) => (
            <Text key={i} style={[styles.body, { fontSize: 13 }]}>
              {issue.message}
            </Text>
          ))}
        </ScrollView>
      )}
      <Sheet
        visible={!!menu && !add}
        title={menu?.place.name || "Your stop"}
        onClose={() => {
          cancelWork();
          setMenu(undefined);
        }}
      >
        {menu ? (
          <>
            <Text style={styles.body}>{menu.place.address}</Text>
            <Button
              secondary
              title="Save to favourite places"
              onPress={() =>
                void saveFavoritePlace(plan, menu.placeId)
                  .then(() => {
                    setMessage("Added to your favourite places.");
                    setMenu(undefined);
                  })
                  .catch((e) => setError(e.message))
              }
            />
            <Button
              secondary
              title={menu.locked ? "Unlock stop" : "Lock this stop"}
              disabled={busy}
              onPress={() =>
                void edit(
                  plan.stops.map((s) =>
                    s.placeId === menu.placeId
                      ? { ...s, locked: !s.locked }
                      : s,
                  ),
                )
              }
            />
            <Button
              secondary
              title="Find a replacement"
              disabled={busy || menu.locked}
              onPress={() => void search()}
            />
            <Text style={styles.label}>Visit duration · minutes</Text>
            <TextInput
              accessibilityLabel="Visit duration in minutes"
              keyboardType="number-pad"
              style={styles.input}
              value={visit}
              onChangeText={setVisit}
            />
            <Button
              secondary
              title="Update visit duration"
              disabled={busy || menu.locked}
              onPress={() =>
                void edit(
                  plan.stops.map((s) =>
                    s.placeId === menu.placeId
                      ? { ...s, minutes: Number(visit) }
                      : s,
                  ),
                )
              }
            />
            <View style={styles.row}>
              {["earlier", "later"].map((direction, i) => (
                <Chip
                  key={direction}
                  label={"Move " + direction}
                  onPress={() => {
                    const stops = [...plan.stops];
                    const at = stops.findIndex(
                      (s) => s.placeId === menu.placeId,
                    );
                    const to = at + (i === 0 ? -1 : 1);
                    if (
                      menu.locked ||
                      to < 0 ||
                      to >= stops.length ||
                      stops[to].locked
                    ) {
                      setError(
                        "Locked stops stay in place. Choose another position.",
                      );
                      return;
                    }
                    [stops[at], stops[to]] = [stops[to], stops[at]];
                    void edit(stops);
                  }}
                />
              ))}
            </View>
            <Button
              secondary
              title="Remove stop"
              disabled={busy || menu.locked || plan.stops.length === 1}
              onPress={() =>
                void edit(plan.stops.filter((s) => s.placeId !== menu.placeId))
              }
            />
            {menu.place.website ? (
              <Button
                secondary
                title="Venue website"
                onPress={() => void Linking.openURL(menu.place.website!)}
              />
            ) : null}
          </>
        ) : null}
      </Sheet>
      <Sheet
        visible={remix}
        title="Same day. A new feeling."
        onClose={() => {
          cancelWork();
          setRemix(false);
        }}
      >
        <Text style={styles.body}>
          Locked stops stay yours. Routes and estimates are recalculated.
        </Text>
        {remixActions.map((action) => (
          <Button
            key={action}
            secondary
            title={action}
            busy={busy}
            onPress={() =>
              void operation((signal) =>
                api<Itinerary>(
                  "remix",
                  { spec: toSpec(plan), action },
                  { signal },
                ),
              )
            }
          />
        ))}
      </Sheet>
      <Sheet
        visible={add}
        title={menu ? "A fresh alternative" : "One more good stop"}
        onClose={() => {
          cancelWork();
          setAdd(false);
        }}
      >
        <TextInput
          accessibilityLabel="Search for an activity"
          style={styles.input}
          placeholder="Coffee, gallery, park…"
          value={query}
          onChangeText={setQuery}
        />
        <Button
          title="Find real places"
          busy={busy}
          onPress={() => void search()}
        />
        {alternatives.map((place) => (
          <Button
            key={place.id}
            secondary
            title={place.name}
            disabled={busy}
            onPress={() => void replace(place)}
          />
        ))}
        {!busy && !alternatives.length ? (
          <Text style={styles.body}>Search inside your selected area.</Text>
        ) : null}
      </Sheet>
      <Sheet
        visible={settings}
        title="Make room for your day"
        onClose={() => {
          cancelWork();
          setSettings(false);
        }}
      >
        <Text style={styles.label}>Budget / person · {plan.cost.currency}</Text>
        <TextInput
          accessibilityLabel="Plan budget"
          style={styles.input}
          keyboardType="decimal-pad"
          value={budget}
          onChangeText={setBudget}
        />
        <Text style={styles.label}>Available minutes</Text>
        <TextInput
          accessibilityLabel="Plan duration"
          style={styles.input}
          keyboardType="number-pad"
          value={duration}
          onChangeText={setDuration}
        />
        <View style={styles.row}>
          {(["WALK", "DRIVE"] as const).map((mode) => (
            <Chip
              key={mode}
              label={mode === "WALK" ? "Walking" : "Driving"}
              selected={plan.request.mode === mode}
              onPress={() => void edit(plan.stops, { ...plan.request, mode })}
            />
          ))}
        </View>
        <Button
          title="Update my plan"
          busy={busy}
          onPress={() =>
            void edit(plan.stops, {
              ...plan.request,
              budget: Number(budget),
              duration: Number(duration),
            })
          }
        />
      </Sheet>
      <Sheet
        visible={reminders}
        title="A little nudge for your day?"
        onClose={() => setReminders(false)}
      >
        <Text style={styles.body}>
          Permission is requested only when you choose reminders. Local delivery
          timing depends on your phone.
        </Text>
        <View style={[styles.row, { flexWrap: "wrap" }]}>
          {[5, 15, 30, 60].map((minutes) => (
            <Chip
              key={minutes}
              label={minutes + " min before"}
              selected={before === minutes}
              onPress={() => setBefore(minutes)}
            />
          ))}
        </View>
        <Chip
          label="Also remind me before each stop"
          selected={upcoming}
          onPress={() => setUpcoming(!upcoming)}
        />
        <Button
          title="Yes, remind me"
          busy={busy}
          onPress={() => void remind()}
        />
        <Button
          secondary
          title="Maybe later"
          onPress={() => setReminders(false)}
        />
        <Button
          secondary
          title="Cancel this plan’s reminders"
          onPress={() =>
            void cancelPlanReminders(id)
              .then(() => {
                setMessage("Reminders cancelled.");
                setReminders(false);
              })
              .catch((e) => setError(e.message))
          }
        />
      </Sheet>
      <Sheet
        visible={share}
        title="Take a friend along"
        onClose={() => setShare(false)}
      >
        <Text style={styles.body}>
          Share a short text summary, or create a read-only link with an
          account. A cloud link includes your outing title, stops, date, visit
          times, budget and group size. Anyone with the link can view it until
          you delete the cloud plan.
        </Text>
        <Button
          title="Share a text summary"
          onPress={() => void sharePlan(plan).catch((e) => setError(e.message))}
        />
        <Button
          secondary
          title="Create an account share link"
          disabled={plan.demo}
          onPress={() =>
            void shareCloudPlan(plan)
              .then(() => setMessage("Shared using your account."))
              .catch((e) => setError(e.message))
          }
        />
      </Sheet>
      <Sheet
        visible={saveSheet}
        title="Keep this good day"
        onClose={() => setSaveSheet(false)}
      >
        <Text style={styles.body}>
          Every plan is saved on this device. Sync to your account when you want
          to open it elsewhere.
        </Text>
        <Button
          title="Save on this device"
          onPress={() =>
            void savePlan(plan)
              .then(() => {
                setMessage("Saved on this device.");
                setSaveSheet(false);
              })
              .catch((e) => setError(e.message))
          }
        />
        <Button
          secondary
          title="Save to my account"
          disabled={plan.demo}
          onPress={() =>
            void api("plans", toSpec(plan))
              .then(() => {
                setMessage("Saved to your account.");
                setSaveSheet(false);
              })
              .catch((e) => setError(e.message))
          }
        />
      </Sheet>
    </Screen>
  );
}
