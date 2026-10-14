import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Text,
  View,
  Pressable,
  TextInput,
  Platform,
  BackHandler,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import DateTimePicker from "@react-native-community/datetimepicker";
import { DateTime } from "luxon";
import * as Haptics from "expo-haptics";
import { ArrowLeft, Coffee, Compass, Zap } from "lucide-react-native";
import Animated, {
  FadeInRight,
  FadeInLeft,
  FadeOutLeft,
  FadeOutRight,
  useAnimatedStyle,
  useSharedValue,
  useReducedMotion,
  withTiming,
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
function ProgressSegment({
  active,
  reduced,
}: {
  active: boolean;
  reduced: boolean;
}) {
  const progress = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    progress.set(
      reduced ? Number(active) : withTiming(Number(active), { duration: 220 }),
    );
  }, [active, reduced, progress]);
  const fill = useAnimatedStyle(() => ({ opacity: progress.value }));
  return (
    <View
      style={{
        flex: 1,
        height: 4,
        borderRadius: 3,
        backgroundColor: c.line,
        overflow: "hidden",
      }}
    >
      <Animated.View style={[{ flex: 1, backgroundColor: c.ink }, fill]} />
    </View>
  );
}
export default function Planner() {
  const { draft, setDraft } = useApp();
  const [queue, setQueue] = useState<Step[]>(() => remainingSteps(draft));
  const [index, setIndex] = useState(0);
  const [transition, setTransition] = useState<{
    index: number;
    direction: "forward" | "back";
  }>();
  const moving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [intent, setIntent] = useState<PlanningIntent>();
  const [advanced, setAdvanced] = useState(false);
  const [picking, setPicking] = useState(false);
  const intake = useRef(draft);
  const current = useRef(draft);
  const reduced = useReducedMotion();
  const step = queue[index];
  const ready = !step;
  // Commit the new exit direction before changing the keyed question. This
  // keeps the outgoing card and the incoming card moving in the same direction.
  useEffect(() => {
    if (!transition) return;
    if (reduced) {
      setIndex(transition.index);
      moving.current = false;
      return;
    }
    const frame = requestAnimationFrame(() => {
      setIndex(transition.index);
      moving.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [transition, reduced]);
  const move = useCallback(
    (nextIndex: number, direction: "forward" | "back") => {
      if (moving.current) return;
      moving.current = true;
      setTransition({ index: nextIndex, direction });
    },
    [],
  );
  const back = useCallback(() => {
    if (index > 0) move(index - 1, "back");
    else router.back();
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
        setIndex(0);
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
      setIndex(0);
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
    <Screen>
      <View
        style={[
          styles.row,
          { justifyContent: "space-between", marginBottom: 24 },
        ]}
      >
        <Pressable
          accessibilityLabel="Back"
          accessibilityRole="button"
          onPress={back}
          style={{ padding: 12, backgroundColor: c.white, borderRadius: 24 }}
        >
          <ArrowLeft color={c.ink} size={22} />
        </Pressable>
        <Text style={styles.eyebrow}>YOUR KIND OF DAY</Text>
        <Text style={styles.label}>
          {Math.min(index + 1, queue.length)} / {queue.length}
        </Text>
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
        style={[styles.row, { gap: 5, marginBottom: 30 }]}
      >
        {queue.map((s, i) => (
          <ProgressSegment key={s} active={i <= index} reduced={reduced} />
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
      <Animated.View
        pointerEvents={busy ? "none" : "auto"}
        key={step || "ready"}
        entering={
          reduced
            ? undefined
            : transition?.direction === "back"
              ? FadeInLeft.duration(250)
              : FadeInRight.duration(250)
        }
        exiting={
          reduced
            ? undefined
            : transition?.direction === "back"
              ? FadeOutRight.duration(150)
              : FadeOutLeft.duration(150)
        }
        style={{ gap: 22 }}
      >
        <Text style={styles.title}>
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
              <Chip
                key={label}
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
                      participants: Math.max(1, (draft.participants || 2) - 1),
                    })
                  }
                />
                <Text style={styles.heading}>{draft.participants || 2}</Text>
                <Chip
                  label="+"
                  onPress={() =>
                    update({
                      participants: Math.min(20, (draft.participants || 2) + 1),
                    })
                  }
                />
              </View>
            ) : null}
          </>
        ) : null}
        {step === "energy" ? (
          <View style={{ gap: 14 }}>
            {(
              [
                {
                  value: "chill",
                  label: "Chill & relaxed",
                  note: "Slow down. Soak it in.",
                  color: c.mint,
                  Icon: Coffee,
                },
                {
                  value: "balanced",
                  label: "A little of both",
                  note: "A wander, with a little wow.",
                  color: c.lavender,
                  Icon: Compass,
                },
                {
                  value: "active",
                  label: "Active & adventurous",
                  note: "Let’s make a story.",
                  color: c.sun,
                  Icon: Zap,
                },
              ] as const
            ).map(({ value, label, note, color, Icon }) => (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityState={{ selected: draft.energy === value }}
                onPress={() => {
                  void Haptics.selectionAsync().catch(() => {});
                  update({ energy: value });
                }}
                style={[
                  styles.row,
                  {
                    padding: 22,
                    borderRadius: 24,
                    backgroundColor: color,
                    borderWidth: draft.energy === value ? 2 : 0,
                    borderColor: c.ink,
                  },
                ]}
              >
                <Icon color={c.ink} size={32} />
                <View style={{ flex: 1, gap: 5 }}>
                  <Text style={[styles.heading, { fontSize: 22 }]}>
                    {label}
                  </Text>
                  <Text style={[styles.body, { color: c.ink, fontSize: 14 }]}>
                    {note}
                  </Text>
                </View>
                <Text style={styles.label}>
                  {draft.energy === value ? "✓" : "↗"}
                </Text>
              </Pressable>
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
              {draft.location?.timezone}. You can change the start time below.
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
              value={draft.duration === undefined ? "" : String(draft.duration)}
              onChangeText={(value) =>
                update({ duration: value === "" ? undefined : Number(value) })
              }
            />
          </>
        ) : null}
        {summary ? (
          <View
            style={{
              backgroundColor: c.lilac,
              borderRadius: 20,
              padding: 18,
              gap: 5,
            }}
          >
            <Text style={styles.label}>{summary.location.name}</Text>
            <Text style={styles.body}>
              {summary.date} at {summary.startTime} · {summary.duration / 60}{" "}
              hours
            </Text>
            <Text style={styles.body}>
              {summary.location.currency} {summary.budget} / person ·{" "}
              {summary.mode === "WALK" ? "Walking" : "Driving"}
            </Text>
            {!draft.known.includes("date") ||
            !draft.known.includes("duration") ||
            !draft.known.includes("budget") ? (
              <Text style={[styles.body, { fontSize: 12 }]}>
                Unchosen details use the starting choices above. Adjust them
                anytime.
              </Text>
            ) : null}
            {draft.dateChoice === "flexible" ? (
              <Text style={[styles.body, { fontSize: 12 }]}>
                Using tomorrow for route and opening-hour checks.
              </Text>
            ) : null}
          </View>
        ) : null}
        {!ready ? (
          <Button
            title={step === "location" ? "That’s the place" : "Next"}
            onPress={next}
            disabled={busy || (step === "location" && !draft.location)}
          />
        ) : null}
        {step && step !== "location" ? (
          <Pressable
            onPress={next}
            accessibilityRole="button"
            style={{ padding: 14, alignItems: "center" }}
          >
            <Text style={styles.label}>Skip for now</Text>
          </Pressable>
        ) : null}
        {draft.location ? (
          <Button
            title="Make my day"
            secondary={!ready}
            onPress={generate}
            disabled={busy || !summary}
          />
        ) : null}
        {draft.location ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setAdvanced(true)}
            style={{ padding: 12 }}
          >
            <Text style={[styles.label, { textAlign: "center" }]}>
              Fine-tune time, travel & area
            </Text>
          </Pressable>
        ) : null}
      </Animated.View>
      <Sheet
        error={error || validation}
        visible={advanced}
        title="The little details"
        onClose={() => setAdvanced(false)}
      >
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
