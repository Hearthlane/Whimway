import React, { useCallback, useEffect, useRef, useState } from "react";
import { Text, View, AppState, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useFocusEffect, router } from "expo-router";
import { DateTime } from "luxon";
import * as Haptics from "expo-haptics";
import {
  Screen,
  styles,
  Button,
  Chip,
  Notice,
  Header,
  Sheet,
} from "../../src/components/ui";
import RouteMap from "../../src/components/RouteMap";
import { usePlan } from "../../src/state/usePlan";
import {
  getDayProgress,
  saveDayProgress,
  clearDayProgress,
  reconcileDayProgress,
  type DayProgress,
} from "../../src/services/storage";
import {
  requestCurrentLocation,
  watchForegroundLocation,
} from "../../src/services/location";
import {
  updatePlanReminders,
  cancelPlanReminders,
} from "../../src/services/notifications";
import { api } from "../../src/services/api";
import {
  advanceDayProgress,
  remainingDayMetrics,
} from "../../src/services/day-progress";
import { colors as c } from "../../src/design/theme";
import { money } from "../../../../lib/time";
import { distance } from "../../../../lib/geo";
import type { Point, TravelLeg } from "../../../../lib/schema";

export default function DayScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { plan, loading, error, setError, reload } = usePlan(id);
  const [progress, setProgress] = useState<DayProgress>();
  const [progressAttempt, setProgressAttempt] = useState(0);
  const [location, setLocation] = useState<Point>();
  const [following, setFollowing] = useState(false),
    [foreground, setForeground] = useState(AppState.currentState === "active");
  const [leg, setLeg] = useState<TravelLeg>();
  const [guideMode, setGuideMode] = useState<"WALK" | "DRIVE">("WALK");
  const [busy, setBusy] = useState(false),
    [finishing, setFinishing] = useState(false),
    [message, setMessage] = useState(""),
    [ending, setEnding] = useState(false);
  const routeAbort = useRef<AbortController | null>(null),
    completionPending = useRef(false),
    screenActive = useRef(false);
  const [now, setNow] = useState(DateTime.now());
  const plannedMode = plan?.request.mode;
  useEffect(() => {
    if (plannedMode) setGuideMode(plannedMode);
  }, [id, plannedMode]);
  useFocusEffect(
    useCallback(() => {
      screenActive.current = true;
      return () => {
        screenActive.current = false;
        routeAbort.current?.abort();
        setFollowing(false);
        setLocation(undefined);
        setLeg(undefined);
      };
    }, []),
  );
  useEffect(() => {
    const timer = setInterval(() => {
      if (AppState.currentState === "active") setNow(DateTime.now());
    }, 30000);
    const sub = AppState.addEventListener("change", (state) => {
      setForeground(state === "active");
      if (state === "active") setNow(DateTime.now());
      else routeAbort.current?.abort();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
      routeAbort.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!plan) return;
    let active = true;
    void getDayProgress(id)
      .then(async (saved) => {
        if (!active) return;
        const value = reconcileDayProgress(
          saved ?? {
            planId: id,
            startedAt: new Date().toISOString(),
            completed: [],
            skipped: [],
          },
          plan,
        );
        await saveDayProgress(value);
        if (!active) return;
        setProgress(value);
        // Day Mode has started. Do not send an outing-start reminder again,
        // including when a plan is edited or hydrated after returning.
        await updatePlanReminders(plan).catch(() => {
          if (active)
            setMessage(
              "Your day is ready. Reminder updates failed; open plan reminders to retry.",
            );
        });
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [id, plan, progressAttempt, setError]);
  useEffect(() => {
    if (!following || !foreground) return;
    let stop: (() => void) | undefined,
      disposed = false;
    void watchForegroundLocation(
      (point) => {
        if (!disposed) setLocation(point);
      },
      (message) => {
        if (!disposed) setError(message);
      },
    )
      .then((cleanup) => {
        if (disposed) cleanup();
        else stop = cleanup;
      })
      .catch((e) => {
        if (!disposed) setError(e.message);
      });
    return () => {
      disposed = true;
      stop?.();
    };
  }, [following, foreground, setError]);
  const pending =
    plan?.stops.filter(
      (s) =>
        !progress?.completed.includes(s.placeId) &&
        !progress?.skipped.includes(s.placeId),
    ) ?? [];
  const current = pending[0],
    next = pending[1];
  useEffect(() => {
    routeAbort.current?.abort();
    setLeg(undefined);
  }, [current?.placeId, plan?.request.mode]);

  async function guide() {
    if (!plan || !current || busy) return;
    setBusy(true);
    setError("");
    routeAbort.current?.abort();
    const controller = new AbortController();
    routeAbort.current = controller;
    try {
      const point = await requestCurrentLocation();
      if (controller.signal.aborted || !screenActive.current) return;
      setLocation(point);
      setFollowing(true);
      if (plan.demo) {
        setMessage(
          "Fixture places cannot provide real location-to-stop guidance.",
        );
        return;
      }
      const route = await api<TravelLeg>(
        "route",
        {
          from: point,
          to: current.place.point,
          toId: current.placeId,
          mode: guideMode,
        },
        { signal: controller.signal },
      );
      if (controller.signal.aborted || !screenActive.current) return;
      setLeg(route);
      setMessage(
        route.verified
          ? "Route preview updated from your current position. Turn-by-turn instructions are unavailable in this beta."
          : "A verified route is unavailable. Your venue location is still shown on the map.",
      );
    } catch (e) {
      if (!controller.signal.aborted && screenActive.current)
        setError((e as Error).message);
    } finally {
      if (routeAbort.current === controller) setBusy(false);
    }
  }
  async function finish(skipped: boolean) {
    if (!progress || !current || !plan || completionPending.current) return;
    completionPending.current = true;
    setFinishing(true);
    setError("");
    const updated = advanceDayProgress(
      plan,
      progress,
      current.placeId,
      skipped ? "skipped" : "completed",
    );
    try {
      await saveDayProgress(updated);
      setProgress(updated);
      setMessage(
        skipped
          ? "Skipped. On to something good."
          : "A good moment, well spent.",
      );
      void Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      ).catch(() => {});
      if (
        plan.stops.some(
          (s) =>
            !updated.completed.includes(s.placeId) &&
            !updated.skipped.includes(s.placeId),
        )
      ) {
        await updatePlanReminders(plan).catch(() =>
          setMessage(
            "Progress saved. Reminder updates failed; open plan reminders to retry.",
          ),
        );
      } else
        await cancelPlanReminders(id).catch(() =>
          setMessage(
            "Your day is complete. Reminder cancellation failed; retry from Profile.",
          ),
        );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      completionPending.current = false;
      setFinishing(false);
    }
  }
  async function switchMode(mode: "WALK" | "DRIVE") {
    if (!plan || !current || mode === guideMode || busy || finishing) return;
    setGuideMode(mode);
    setLeg(undefined);
    setError("");
    routeAbort.current?.abort();
    if (!following || !location) {
      setMessage(
        `Guidance set to ${mode === "WALK" ? "walking" : "driving"}. Request a route from your location when ready.`,
      );
      return;
    }
    if (plan.demo) {
      setMessage(
        "Fixture places cannot provide real location-to-stop guidance.",
      );
      return;
    }
    setBusy(true);
    const controller = new AbortController();
    routeAbort.current = controller;
    try {
      const route = await api<TravelLeg>(
        "route",
        {
          from: location,
          to: current.place.point,
          toId: current.placeId,
          mode,
        },
        { signal: controller.signal },
      );
      if (controller.signal.aborted || !screenActive.current) return;
      setLeg(route);
      setMessage(
        route.verified
          ? "Guidance route and estimated travel time updated."
          : "A verified route is unavailable for this travel mode.",
      );
    } catch (e) {
      if (!controller.signal.aborted && screenActive.current)
        setError((e as Error).message);
    } finally {
      if (routeAbort.current === controller) setBusy(false);
    }
  }
  if (!plan || !progress || progress.planId !== id)
    return (
      <Screen>
        <Header title="YOUR DAY" />
        <Text style={styles.title}>
          {loading ? "Opening your day…" : "Getting your day ready…"}
        </Text>
        <Notice message={error} error />
        {error ? (
          <Button
            title="Try again"
            onPress={() => {
              if (plan) setProgressAttempt((n) => n + 1);
              else void reload();
            }}
          />
        ) : (
          <ActivityIndicator color={c.ink} />
        )}
      </Screen>
    );
  const metrics = remainingDayMetrics(plan, progress, leg),
    remainingCost = metrics.costHigh,
    unknown = metrics.unknownPrices,
    remainingMinutes = metrics.minutes;
  const last = plan.stops.at(-1),
    end = last ? DateTime.fromISO(last.departure) : now;
  const clock = end.isValid
    ? Math.max(0, Math.ceil(end.diff(now, "minutes").minutes))
    : 0;
  const percentage: `${number}%` = `${((progress.completed.length + progress.skipped.length) / Math.max(1, plan.stops.length)) * 100}%`;
  return (
    <Screen style={{ gap: 18 }}>
      <Header title="LET THE DAY UNFOLD" />
      <View style={[styles.row, { justifyContent: "space-between" }]}>
        <Text style={styles.eyebrow}>
          {progress.completed.length} DONE · {progress.skipped.length} SKIPPED
        </Text>
        <Text style={styles.label}>{pending.length} TO GO</Text>
      </View>
      <View
        accessibilityRole="progressbar"
        accessibilityLabel="Outing progress"
        accessibilityValue={{
          min: 0,
          max: plan.stops.length,
          now: progress.completed.length + progress.skipped.length,
        }}
        style={{ height: 5, backgroundColor: c.line, borderRadius: 5 }}
      >
        <View
          style={{
            height: 5,
            width: percentage,
            backgroundColor: c.ink,
            borderRadius: 5,
          }}
        />
      </View>
      {current ? (
        <>
          <Text style={styles.title}>{current.place.name}</Text>
          <Text style={styles.body}>{current.place.address}</Text>
          <RouteMap
            plan={plan}
            selectedId={current.placeId}
            userLocation={location}
            showUserLocation={following}
            guideLeg={leg}
            style={{ height: 290, borderRadius: 24 }}
          />
          {plan.demo ? (
            <Notice message="Development fixture. Map positions and route estimates do not describe a real outing." />
          ) : null}
          <View
            style={[
              styles.row,
              { flexWrap: "wrap", justifyContent: "space-between" },
            ]}
          >
            <View>
              <Text style={styles.eyebrow}>PLANNED ACTIVITIES LEFT</Text>
              <Text style={styles.heading}>{remainingMinutes} min</Text>
            </View>
            <View>
              <Text style={styles.eyebrow}>REMAINING ESTIMATE / PERSON</Text>
              <Text style={styles.heading}>
                {money(remainingCost, plan.cost.currency)}
                {unknown ? " + ?" : ""}
              </Text>
            </View>
          </View>
          <Text style={[styles.body, { fontSize: 13 }]}>
            Time until your planned finish: {clock} min. Spending is estimated,
            not tracked.
          </Text>
          {leg?.verified ? (
            <Text style={styles.label}>
              {Math.round(leg.minutes)} min{" "}
              {guideMode === "WALK" ? "walk" : "drive"} ·{" "}
              {(leg.meters / 1000).toFixed(1)} km from your last route request
            </Text>
          ) : null}
          {location && distance(location, current.place.point) < 75 ? (
            <Notice message="You’re near this stop. Mark it done whenever you’re ready." />
          ) : null}
          <Notice message={error} error />
          <Notice message={message} />
          <Button
            title={
              following
                ? "Refresh route from my location"
                : "Guide me from my location"
            }
            busy={busy}
            onPress={() => void guide()}
          />
          {following ? (
            <Button
              secondary
              title="Stop location following"
              onPress={() => {
                routeAbort.current?.abort();
                setFollowing(false);
                setLocation(undefined);
                setLeg(undefined);
              }}
            />
          ) : null}
          <Button
            title="I’m done here ✓"
            busy={finishing}
            onPress={() => void finish(false)}
          />
          <Button
            secondary
            title="Skip this stop"
            disabled={finishing}
            onPress={() => void finish(true)}
          />
          {next ? (
            <View
              style={{
                padding: 20,
                backgroundColor: c.lilac,
                borderRadius: 22,
                gap: 8,
              }}
            >
              <Text style={styles.eyebrow}>UP NEXT</Text>
              <Text style={styles.heading}>{next.place.name}</Text>
              <Text style={styles.body}>
                {next.minutes} min · {next.reason}
              </Text>
            </View>
          ) : null}
        </>
      ) : (
        <>
          <Text style={styles.title}>That’s a day{"\n"}worth keeping.</Text>
          <Text style={styles.body}>
            {progress.completed.length} moments enjoyed. Your plan stays in
            Saved.
          </Text>
          <Button
            title="Back to my plan"
            onPress={() => router.replace("/plan/" + id)}
          />
        </>
      )}
      {current ? (
        <>
          <Text style={styles.label}>Guidance to this stop</Text>
          <View style={[styles.row, { flexWrap: "wrap" }]}>
            {(["WALK", "DRIVE"] as const).map((mode) => (
              <Chip
                key={mode}
                label={mode === "WALK" ? "Walking" : "Driving"}
                selected={guideMode === mode}
                onPress={() => void switchMode(mode)}
              />
            ))}
          </View>
        </>
      ) : null}
      <Text style={[styles.body, { fontSize: 12 }]}>
        In-app map and route preview. Turn-by-turn voice navigation is
        unavailable. Routes refresh when requested; driving times exclude live
        traffic.
      </Text>
      <Button
        secondary
        title="End this outing"
        onPress={() => setEnding(true)}
      />
      <Sheet
        visible={ending}
        title="Call it a good day?"
        onClose={() => setEnding(false)}
      >
        <Text style={styles.body}>
          This clears live progress and cancels future reminders. Your saved
          plan stays.
        </Text>
        <Button
          title="End my day"
          onPress={() =>
            void cancelPlanReminders(id)
              .then(() => clearDayProgress(id))
              .then(() => router.replace("/"))
              .catch((e) => setError(e.message))
          }
        />
        <Button
          secondary
          title="Keep exploring"
          onPress={() => setEnding(false)}
        />
      </Sheet>
    </Screen>
  );
}
