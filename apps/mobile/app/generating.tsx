import React, { useEffect, useRef, useState } from "react";
import { Text, View, ActivityIndicator, BackHandler } from "react-native";
import { router } from "expo-router";
import { useApp } from "../src/state/AppState";
import { api } from "../src/services/api";
import { requestFromDraft } from "../src/core/planning";
import { Screen, styles, Button, Notice, Reveal } from "../src/components/ui";
import { RouteArt } from "../src/components/RouteArt";
import type { Itinerary } from "../../../lib/schema";
import { colors as c } from "../src/design/theme";
export default function Generating() {
  const { draft, setPlan } = useApp();
  const [error, setError] = useState("");
  const [slow, setSlow] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    active.current = controller;
    setError("");
    setSlow(false);
    const timer = setTimeout(() => setSlow(true), 20000);
    async function run() {
      try {
        const plan = await api<Itinerary>(
          "generate",
          { request: requestFromDraft(draft), demo: draft.demo },
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        // A generated UUID has no opted-in reminders. Hand off as soon as its
        // durable/state transaction accepts, without a cancellable-looking wait.
        await setPlan(plan, {
          signal: controller.signal,
          refreshReminders: false,
        });
        if (controller.signal.aborted || active.current !== controller) return;
        router.replace("/plan/" + plan.id);
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      } finally {
        clearTimeout(timer);
      }
    }
    void run();
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      controller.abort();
      router.back();
      return true;
    });
    return () => {
      controller.abort();
      clearTimeout(timer);
      back.remove();
    };
    // An attempt captures its draft; preference changes are impossible on this screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);
  function cancel() {
    active.current?.abort();
    router.back();
  }
  return (
    <Screen style={{ justifyContent: "center", gap: 26 }}>
      <Reveal>
        <RouteArt animate />
        <Text
          maxFontSizeMultiplier={2}
          style={[styles.title, { marginTop: 32 }]}
        >
          Making your{"\n"}perfect day…
        </Text>
        <Text style={[styles.body, { marginTop: 16 }]}>
          Your places, route and timing come together here.
        </Text>
      </Reveal>
      {!error ? (
        <View
          accessibilityLiveRegion="polite"
          style={[styles.row, { marginVertical: 12 }]}
        >
          <ActivityIndicator color={c.ink} />
          <Text style={[styles.body, { flex: 1 }]}>
            {slow
              ? "A thoughtful day can take a moment. Still waiting on the planner."
              : "Preparing your outing"}
          </Text>
        </View>
      ) : null}
      <Notice message={error} error />
      {error ? (
        <Button title="Try again" onPress={() => setAttempt(attempt + 1)} />
      ) : null}
      <Button
        secondary
        title={error ? "Back to my choices" : "Cancel"}
        onPress={cancel}
      />
    </Screen>
  );
}
