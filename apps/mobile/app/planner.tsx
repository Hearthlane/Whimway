import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Text,
  View,
  Pressable,
  TextInput,
  Platform,
  BackHandler,
  Keyboard,
  useWindowDimensions,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import DateTimePicker from "@react-native-community/datetimepicker";
import { DateTime } from "luxon";
import * as Haptics from "expo-haptics";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Coffee,
  Compass,
  Zap,
} from "lucide-react-native";
import Animated, {
  FadeInRight,
  FadeInLeft,
  useAnimatedStyle,
  useSharedValue,
  useReducedMotion,
  withTiming,
  withSpring,
} from "react-native-reanimated";
import {
  Screen,
  styles,
  Button,
  Chip,
  Notice,
  Sheet,
} from "../src/components/ui";
import { LocationSearch } from "../src/components/LocationSearch";
import { colors as c } from "../src/design/theme";
import { useApp } from "../src/state/AppState";
import { api } from "../src/services/api";
import {
  applyIntent,
  choosePreferences,
  budgetPresets,
  defaultStart,
  requestFromDraft,
  relativeDate,
  remainingSteps,
  withLocation,
  type Step,
  type Draft,
} from "../src/core/planning";
import {
  interests,
  type Location,
  type PlanningIntent,
  type PlanRequest,
} from "../../../lib/schema";
const headings: Record<Step, string> = {
  location: "Where are we heading?",
  interests: "What sounds fun?",
  companion: "Who’s joining?",
  energy: "What’s your energy today?",
  vibes: "What’s the vibe?",
  budget: "What’s your budget?",
  date: "When’s the adventure?",
  duration: "How long are we out?",
};
function EnergyChoice({
  value,
  selected,
  largeText,
  onPress,
}: {
  value: "chill" | "balanced" | "active";
  selected: boolean;
  largeText: boolean;
  onPress: () => void;
}) {
  const reduced = useReducedMotion();
  const pressed = useSharedValue(1);
  const chosen = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    chosen.set(
      reduced
        ? Number(selected)
        : withSpring(Number(selected), { damping: 18, stiffness: 220 }),
    );
  }, [selected, reduced, chosen]);
  const response = useAnimatedStyle(() => ({
    transform: [{ scale: pressed.value }],
  }));
  const illustration = useAnimatedStyle(() => ({
    transform: [
      { scale: 1 + chosen.value * 0.08 },
      { rotate: `${chosen.value * (value === "chill" ? -7 : 7)}deg` },
    ],
  }));
  const details = {
    chill: {
      label: "Chill & relaxed",
      note: "Slow down. Soak it in.",
      color: c.mint,
      Icon: Coffee,
    },
    balanced: {
      label: "A little of both",
      note: "A wander, with a little wow.",
      color: c.lavender,
      Icon: Compass,
    },
    active: {
      label: "Active & adventurous",
      note: "Let’s make a story.",
      color: c.sun,
      Icon: Zap,
    },
  }[value];
  const { Icon } = details;
  const wide = largeText || value === "active";
  return (
    <Animated.View
      style={[
        { flexBasis: wide ? "100%" : "46%", flexGrow: 1, minWidth: 130 },
        response,
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={details.label}
        accessibilityHint={details.note}
        accessibilityState={{ selected }}
        aria-pressed={selected}
        onPressIn={() =>
          pressed.set(reduced ? 1 : withTiming(0.98, { duration: 90 }))
        }
        onPressOut={() =>
          pressed.set(
            reduced ? 1 : withSpring(1, { damping: 18, stiffness: 260 }),
          )
        }
        onPress={() => {
          void Haptics.selectionAsync().catch(() => {});
          onPress();
        }}
        style={{
          flex: 1,
          padding: 18,
          gap: 16,
          flexDirection: wide ? "row-reverse" : "column",
          alignItems: wide ? "center" : "flex-start",
          backgroundColor: details.color,
          borderRadius: value === "chill" ? 30 : value === "balanced" ? 22 : 18,
          borderWidth: 2,
          borderColor: selected ? c.ink : "transparent",
        }}
      >
        {selected ? (
          <View style={{ position: "absolute", top: 10, right: 10 }}>
            <Check size={18} color={c.ink} />
          </View>
        ) : null}
        <Animated.View
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          style={[
            {
              width: 64,
              height: 64,
              alignItems: "center",
              justifyContent: "center",
            },
            illustration,
          ]}
        >
          {value === "chill" ? (
            <View
              style={{
                position: "absolute",
                width: 64,
                height: 46,
                borderRadius: 30,
                backgroundColor: "#E9F7F1",
                transform: [{ rotate: "-18deg" }],
              }}
            />
          ) : value === "balanced" ? (
            <>
              <View
                style={{
                  position: "absolute",
                  width: 62,
                  height: 62,
                  borderRadius: 31,
                  borderWidth: 1,
                  borderColor: c.ink,
                }}
              />
              <View
                style={{
                  position: "absolute",
                  width: 14,
                  height: 14,
                  borderRadius: 7,
                  top: 1,
                  right: 1,
                  backgroundColor: c.sun,
                }}
              />
              <View
                style={{
                  position: "absolute",
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  bottom: 2,
                  left: 2,
                  backgroundColor: c.paper,
                }}
              />
            </>
          ) : (
            <View
              style={{
                position: "absolute",
                width: 48,
                height: 48,
                borderRadius: 10,
                backgroundColor: c.peach,
                transform: [{ rotate: "22deg" }],
              }}
            />
          )}
          <View style={{ position: "relative", zIndex: 1 }}>
            <Icon
              color={c.ink}
              size={value === "active" ? 40 : 32}
              strokeWidth={1.7}
            />
          </View>
        </Animated.View>
        <View
          style={{ flex: wide ? 1 : undefined, alignSelf: "stretch", gap: 5 }}
        >
          <Text style={[styles.heading, { fontSize: 22 }]}>
            {details.label}
          </Text>
          <Text
            style={[
              styles.body,
              { color: c.ink, fontSize: 14, lineHeight: 20 },
            ]}
          >
            {details.note}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}
export default function Planner() {
  const { draft, setDraft } = useApp();
  const [queue, setQueue] = useState<Step[]>(() => remainingSteps(draft));
  const [{ index, direction }, setPage] = useState<{
    index: number;
    direction: "forward" | "back";
  }>({ index: 0, direction: "forward" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [intent, setIntent] = useState<PlanningIntent>();
  const [advanced, setAdvanced] = useState(false);
  const [picking, setPicking] = useState(false);
  const intake = useRef(draft);
  const current = useRef(draft);
  const reduced = useReducedMotion();
  const largeText = useWindowDimensions().fontScale > 1.3;
  const step = queue[index];
  const ready = !step;
  const questionKey = `${queue.join(",")}:${step ?? "ready"}`;
  const move = useCallback(
    (nextIndex: number, direction: "forward" | "back") => {
      setPage((page) =>
        page.index === nextIndex ? page : { index: nextIndex, direction },
      );
    },
    [],
  );
  const back = useCallback(() => {
    Keyboard.dismiss();
    if (index > 0) move(index - 1, "back");
    else if (router.canGoBack()) router.back();
    else router.replace("/");
  }, [index, move]);
  useFocusEffect(
    useCallback(() => {
      const listener = BackHandler.addEventListener("hardwareBackPress", () => {
        if (index === 0) return false;
        back();
        return true;
      });
      return () => listener.remove();
    }, [index, back]),
  );
  useEffect(() => {
    current.current = draft;
  }, [draft]);
  useEffect(() => {
    const input = intake.current;
    if (!input.prompt.trim()) return;
    const controller = new AbortController();
    setBusy(true);
    api<PlanningIntent>(
      "intent",
      { prompt: input.prompt, timezone: input.location?.timezone },
      { signal: controller.signal },
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        setIntent(result);
        const next = applyIntent(current.current, result);
        setError(
          [
            ...result.warnings,
            ...(result.dateChoice === "today" && !next.known.includes("date")
              ? [
                  "There’s no upcoming start hour left today here. Choose a date below.",
                ]
              : []),
          ].join(" "),
        );
        setDraft(next);
        setQueue(remainingSteps(next));
        setPage({ index: 0, direction: "forward" });
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e.message + " You can still choose your preferences below.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [setDraft]);
  function update(patch: Partial<Draft>) {
    setDraft((current) => choosePreferences(current, patch));
  }
  function chooseLocation(location: Location) {
    try {
      setDraft(withLocation(draft, location));
      setError("");
    } catch (e) {
      const next = withLocation(
        {
          ...draft,
          dateChoice: undefined,
          known: draft.known.filter((key) => key !== "date"),
        },
        location,
      );
      setDraft(next);
      setQueue(remainingSteps(next));
      setPage({ index: 0, direction: "forward" });
      setError((e as Error).message);
    }
  }
  function chooseDate(label: string) {
    try {
      if (!draft.location) return;
      update({
        ...(label === "I’m flexible"
          ? defaultStart(draft.location)
          : relativeDate(
              label === "Today" ? "today" : "tomorrow",
              draft.location,
            )),
        dateChoice:
          label === "I’m flexible"
            ? "flexible"
            : label === "Today"
              ? "today"
              : "tomorrow",
      });
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function next() {
    if (step === "location" && !draft.location) return;
    setDraft((current) => ({
      ...current,
      known: [...new Set([...current.known, step])],
    }));
    move(index + 1, "forward");
  }
  function generate() {
    try {
      requestFromDraft(draft);
      router.push("/generating");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function toggle(key: "interests" | "vibes", value: string) {
    const selected = (draft[key] || []) as string[];
    if (key === "vibes" && !selected.includes(value) && selected.length >= 3)
      return;
    update({
      [key]: selected.includes(value)
        ? selected.filter((x) => x !== value)
        : [...selected, value],
    } as Partial<Draft>);
  }
  let summary: PlanRequest | null = null;
  let validation = "";
  if (draft.location) {
    try {
      summary = requestFromDraft(draft);
    } catch (e) {
      validation = (e as Error).message;
    }
  }
  const amounts = budgetPresets(draft.location?.currency || "CAD");
  return (
    <Screen
      scrollResetKey={questionKey}
      scrollTestID="planner-scroll"
      style={{ paddingBottom: 16 }}
      footer={
        <View
          testID="planner-footer"
          style={{
            backgroundColor: c.paper,
            borderTopWidth: 1,
            borderTopColor: c.line,
            paddingHorizontal: 24,
            paddingTop: 12,
            paddingBottom: 12,
            gap: 4,
          }}
        >
          <View style={[styles.row, { alignItems: "stretch" }]}>
            <Pressable
              accessibilityLabel="Back"
              accessibilityRole="button"
              onPress={back}
              style={[
                styles.row,
                { minHeight: 56, padding: 12, gap: 8, maxWidth: "38%" },
              ]}
            >
              <ArrowLeft color={c.ink} size={20} />
              <Text style={[styles.label, { flexShrink: 1 }]}>Back</Text>
            </Pressable>
            <View style={{ flex: 1 }}>
              <Button
                title={
                  ready
                    ? "Make my day"
                    : step === "location"
                      ? "That’s the place"
                      : "Next"
                }
                onPress={ready ? generate : next}
                disabled={
                  busy ||
                  (ready ? !summary : step === "location" && !draft.location)
                }
              />
            </View>
          </View>
          {!ready && (step !== "location" || draft.location) ? (
            <View style={[styles.row, { alignItems: "stretch", gap: 8 }]}>
              {step !== "location" ? (
                <Pressable
                  onPress={() => {
                    Keyboard.dismiss();
                    next();
                  }}
                  accessibilityRole="button"
                  disabled={busy}
                  accessibilityState={{ disabled: busy }}
                  style={{
                    flex: 1,
                    padding: 10,
                    minHeight: 44,
                    justifyContent: "center",
                    alignItems: "center",
                  }}
                >
                  <Text style={[styles.label, { textAlign: "center" }]}>
                    Skip for now
                  </Text>
                </Pressable>
              ) : null}
              {draft.location ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={busy || !summary}
                  accessibilityState={{ disabled: busy || !summary }}
                  onPress={() => {
                    Keyboard.dismiss();
                    void Haptics.selectionAsync().catch(() => {});
                    generate();
                  }}
                  style={{
                    flex: 1,
                    padding: 10,
                    minHeight: 44,
                    justifyContent: "center",
                    alignItems: "center",
                  }}
                >
                  <Text
                    style={[
                      styles.label,
                      {
                        textAlign: "center",
                        textDecorationLine: "underline",
                        opacity: busy || !summary ? 0.45 : 1,
                      },
                    ]}
                  >
                    Make my day
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
      }
    >
      {/* Remove the outgoing page immediately. The header, progress and
          question enter as one native view, so no old question can remain
          underneath the next page's counter. */}
      <Animated.View
        testID="planner-question"
        key={questionKey}
        collapsable={false}
        entering={
          reduced
            ? undefined
            : direction === "back"
              ? FadeInLeft.duration(250)
              : FadeInRight.duration(250)
        }
      >
        <View
          style={[
            styles.row,
            {
              justifyContent: "space-between",
              marginBottom: 12,
              minHeight: 44,
              flexWrap: "wrap",
              gap: 8,
            },
          ]}
        >
          <Text style={styles.eyebrow}>YOUR KIND OF DAY</Text>
          <Text style={styles.label}>
            {ready ? "Ready" : `${index + 1} / ${queue.length}`}
          </Text>
          {draft.location ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Review day details"
              accessibilityState={{ expanded: advanced, disabled: busy }}
              disabled={busy}
              aria-expanded={advanced}
              onPress={() => {
                Keyboard.dismiss();
                setAdvanced(true);
              }}
              style={[styles.row, { minHeight: 44, padding: 8, gap: 4 }]}
            >
              <Text style={styles.label}>Details</Text>
              <ChevronDown size={18} color={c.ink} />
            </Pressable>
          ) : (
            <View style={{ width: 44 }} />
          )}
        </View>
        <View
          accessibilityRole="progressbar"
          accessibilityLabel="Planning progress"
          aria-valuemin={0}
          aria-valuemax={Math.max(1, queue.length)}
          aria-valuenow={ready ? Math.max(1, queue.length) : index + 1}
          accessibilityValue={{
            min: 0,
            max: Math.max(1, queue.length),
            now: ready ? Math.max(1, queue.length) : index + 1,
          }}
          style={[styles.row, { gap: 5, marginBottom: 20 }]}
        >
          {queue.map((s, i) => (
            <View
              key={s}
              style={{
                flex: 1,
                height: 4,
                borderRadius: 3,
                backgroundColor: i <= index ? c.ink : c.line,
              }}
            />
          ))}
        </View>
        <Notice message={error || validation} error />
        {busy ? (
          <Text
            accessibilityLiveRegion="polite"
            style={[styles.body, { marginBottom: 20 }]}
          >
            Reading your idea…
          </Text>
        ) : null}
        <View pointerEvents={busy ? "none" : "auto"} style={{ gap: 16 }}>
          <Text
            accessibilityRole="header"
            maxFontSizeMultiplier={2}
            style={styles.title}
          >
            {ready ? "Your day,\nyour way." : headings[step]}
          </Text>
          {step === "location" ? (
            <LocationSearch
              value={draft.location}
              onChange={chooseLocation}
              demo={draft.demo}
              initialQuery={intent?.locationQuery}
            />
          ) : null}
          {step === "interests" ? (
            <View style={[styles.row, { flexWrap: "wrap" }]}>
              {interests.map((label, i) => (
                <View
                  key={label}
                  style={{ flexBasis: largeText ? "100%" : "46%", flexGrow: 1 }}
                >
                  <Chip
                    label={
                      label === "Interactive fun"
                        ? "Games & entertainment"
                        : label === "Outdoors"
                          ? "Nature & outdoors"
                          : label
                    }
                    selected={draft.interests?.includes(label)}
                    color={[c.mint, c.sun, c.lavender, c.peach][i % 4]}
                    onPress={() => toggle("interests", label)}
                  />
                </View>
              ))}
            </View>
          ) : null}
          {step === "companion" ? (
            <>
              <View style={[styles.row, { flexWrap: "wrap" }]}>
                {[
                  ["solo", "Just me"],
                  ["date", "A date"],
                  ["friends", "Friends"],
                  ["family", "Family"],
                  ["group", "A group"],
                ].map(([value, label]) => (
                  <Chip
                    key={value}
                    label={label}
                    selected={draft.companion === value}
                    onPress={() =>
                      update({
                        companion: value as Draft["companion"],
                        participants:
                          value === "solo" ? 1 : value === "date" ? 2 : 4,
                      })
                    }
                  />
                ))}
              </View>
              {draft.companion && draft.companion !== "solo" ? (
                <View style={styles.row}>
                  <Text style={styles.label}>People</Text>
                  <Chip
                    label="−"
                    onPress={() =>
                      update({
                        participants: Math.max(
                          1,
                          (draft.participants || 2) - 1,
                        ),
                      })
                    }
                  />
                  <Text style={styles.heading}>{draft.participants || 2}</Text>
                  <Chip
                    label="+"
                    onPress={() =>
                      update({
                        participants: Math.min(
                          20,
                          (draft.participants || 2) + 1,
                        ),
                      })
                    }
                  />
                </View>
              ) : null}
            </>
          ) : null}
          {step === "energy" ? (
            <View
              style={[
                styles.row,
                { flexWrap: "wrap", alignItems: "stretch", gap: 12 },
              ]}
            >
              {(["chill", "balanced", "active"] as const).map((value) => (
                <EnergyChoice
                  key={value}
                  value={value}
                  selected={draft.energy === value}
                  largeText={largeText}
                  onPress={() => update({ energy: value })}
                />
              ))}
            </View>
          ) : null}
          {step === "vibes" ? (
            <>
              <Text style={styles.body}>Pick up to three.</Text>
              <View style={[styles.row, { flexWrap: "wrap" }]}>
                {[
                  ["budget-friendly", "Budget-friendly"],
                  ["romantic", "Cute & romantic"],
                  ["exciting", "Exciting"],
                  ["cozy", "Cozy"],
                  ["trendy", "Trendy"],
                  ["hidden-gems", "Hidden gems"],
                  ["luxurious", "Luxurious"],
                  ["anything", "Anything goes"],
                ].map(([value, label]) => (
                  <Chip
                    key={value}
                    label={label}
                    selected={draft.vibes?.includes(
                      value as NonNullable<Draft["vibes"]>[number],
                    )}
                    onPress={() => toggle("vibes", value)}
                  />
                ))}
              </View>
            </>
          ) : null}
          {step === "budget" ? (
            <>
              <Text style={styles.body}>
                Estimated spending per person ·{" "}
                {draft.location?.currency || "local currency"}
              </Text>
              <View style={[styles.row, { flexWrap: "wrap" }]}>
                {[
                  ["Free", 0],
                  ["Affordable", amounts[0]],
                  ["Moderate", amounts[1]],
                  ["Treat myself", amounts[2]],
                ].map(([label, value]) => (
                  <Chip
                    key={label}
                    label={String(label)}
                    selected={draft.budget === value}
                    onPress={() => update({ budget: Number(value) })}
                  />
                ))}
              </View>
              <TextInput
                style={styles.input}
                accessibilityLabel="Custom budget per person"
                keyboardType="decimal-pad"
                placeholder="Custom amount"
                value={draft.budget === undefined ? "" : String(draft.budget)}
                onChangeText={(value) =>
                  update({ budget: value === "" ? undefined : Number(value) })
                }
              />
            </>
          ) : null}
          {step === "date" ? (
            <>
              <Text style={styles.body}>
                {draft.location?.timezone}. Change the start time in Details.
              </Text>
              <View style={[styles.row, { flexWrap: "wrap" }]}>
                {["Today", "Tomorrow", "I’m flexible"].map((label) => (
                  <Chip
                    key={label}
                    label={label}
                    selected={
                      draft.dateChoice ===
                      (label === "I’m flexible"
                        ? "flexible"
                        : label === "Today"
                          ? "today"
                          : "tomorrow")
                    }
                    onPress={() => chooseDate(label)}
                  />
                ))}
              </View>
              <Button
                secondary
                title={draft.date || "Pick a date"}
                onPress={() => setPicking(true)}
              />
              {picking ? (
                Platform.OS === "web" ? (
                  <TextInput
                    accessibilityLabel="Outing date YYYY-MM-DD"
                    style={styles.input}
                    value={draft.date}
                    placeholder="YYYY-MM-DD"
                    onChangeText={(date) =>
                      update({ date, dateChoice: "specific" })
                    }
                  />
                ) : (
                  <DateTimePicker
                    value={
                      new Date(
                        (draft.date && DateTime.fromISO(draft.date).isValid
                          ? draft.date
                          : DateTime.now().toISODate()) + "T12:00:00",
                      )
                    }
                    mode="date"
                    onChange={(_, date) => {
                      setPicking(false);
                      if (date)
                        update({
                          date: DateTime.fromJSDate(date).toISODate()!,
                          dateChoice: "specific",
                        });
                    }}
                  />
                )
              ) : null}
            </>
          ) : null}
          {step === "duration" ? (
            <>
              <View style={[styles.row, { flexWrap: "wrap" }]}>
                {[
                  ["A quick outing", 90],
                  ["A few hours", 240],
                  ["Half a day", 360],
                  ["All day", 600],
                ].map(([label, value]) => (
                  <Chip
                    key={label}
                    label={String(label)}
                    selected={draft.duration === value}
                    onPress={() => update({ duration: Number(value) })}
                  />
                ))}
              </View>
              <TextInput
                style={styles.input}
                accessibilityLabel="Custom duration in minutes"
                keyboardType="number-pad"
                placeholder="Custom minutes (60–720)"
                value={
                  draft.duration === undefined ? "" : String(draft.duration)
                }
                onChangeText={(value) =>
                  update({ duration: value === "" ? undefined : Number(value) })
                }
              />
            </>
          ) : null}
          {ready && summary ? (
            <View style={{ gap: 12 }}>
              <Text style={styles.heading}>{summary.location.name}</Text>
              <Text style={styles.body}>
                {summary.duration / 60} hours · {summary.location.currency}{" "}
                {summary.budget} / person
              </Text>
              <Text style={styles.body}>
                Review the details above, or make room for a little surprise.
              </Text>
            </View>
          ) : null}
        </View>
      </Animated.View>
      <Sheet
        error={error || validation}
        visible={advanced}
        title="The little details"
        onClose={() => setAdvanced(false)}
      >
        {summary ? (
          <View style={{ gap: 12, marginBottom: 8 }}>
            <Text style={styles.heading}>{summary.location.name}</Text>
            <Text style={styles.body}>
              {summary.duration / 60} hours · {summary.location.currency}{" "}
              {summary.budget} / person
            </Text>
            <Text style={styles.body}>
              {summary.date} at {summary.startTime} ·{" "}
              {summary.mode === "WALK" ? "Walking" : "Driving"}
            </Text>
            {!draft.known.includes("date") ||
            !draft.known.includes("duration") ||
            !draft.known.includes("budget") ? (
              <Text style={styles.body}>
                Unchosen details use these starting choices. Adjust them
                anytime.
              </Text>
            ) : null}
            {draft.dateChoice === "flexible" ? (
              <Text style={styles.body}>
                Using tomorrow for route and opening-hour checks.
              </Text>
            ) : null}
          </View>
        ) : null}
        <Text style={styles.label}>
          Start time · {draft.location?.timezone}
        </Text>
        <TextInput
          accessibilityLabel="Start time HH:mm"
          style={styles.input}
          value={draft.startTime || "11:00"}
          onChangeText={(startTime) => update({ startTime })}
          placeholder="11:00"
        />
        <Text style={styles.label}>Destination currency</Text>
        <TextInput
          accessibilityLabel="Destination currency code"
          style={styles.input}
          autoCapitalize="characters"
          maxLength={3}
          value={draft.location?.currency}
          onChangeText={(value) => {
            if (draft.location)
              update({
                location: {
                  ...draft.location,
                  currency: value.toUpperCase().replace(/[^A-Z]/g, ""),
                },
              });
          }}
          placeholder="CAD, EUR, JPY…"
        />
        <Text style={[styles.body, { fontSize: 12 }]}>
          Confirm the currency for your destination. Changing it does not
          convert amounts.
        </Text>
        <View style={styles.row}>
          {(["WALK", "DRIVE"] as const).map((mode) => (
            <Chip
              key={mode}
              label={mode === "WALK" ? "Walking" : "Driving"}
              selected={(draft.mode || "WALK") === mode}
              onPress={() => update({ mode })}
            />
          ))}
        </View>
        <Text style={styles.label}>Explore within</Text>
        <View style={[styles.row, { flexWrap: "wrap" }]}>
          {[1000, 2000, 5000, 10000].map((radius) => (
            <Chip
              key={radius}
              label={radius / 1000 + " km"}
              selected={(draft.area?.radius || 2000) === radius}
              onPress={() =>
                draft.location &&
                update({
                  area: { center: draft.location.center, radius, locked: true },
                })
              }
            />
          ))}
        </View>
        <Text style={styles.label}>Dietary or access needs</Text>
        <TextInput
          style={styles.input}
          value={draft.dietary}
          maxLength={300}
          placeholder="Dietary needs (optional)"
          accessibilityLabel="Dietary needs"
          onChangeText={(dietary) => update({ dietary })}
        />
        <TextInput
          style={styles.input}
          value={draft.accessibility}
          maxLength={300}
          placeholder="Accessibility needs (optional)"
          accessibilityLabel="Accessibility needs"
          onChangeText={(accessibility) => update({ accessibility })}
        />
        <Button title="All set" onPress={() => setAdvanced(false)} />
      </Sheet>
    </Screen>
  );
}
