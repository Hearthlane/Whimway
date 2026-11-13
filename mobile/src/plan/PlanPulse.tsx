import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { placeKeys, pulseReasons, type PulseReason } from "@shared/polls";
import type { Itinerary } from "@shared/schema";
import { useStore } from "@/lib/store";
import { Button, Chip, Icon, T, tap } from "@/ui/kit";
import { color, radius, space } from "@/ui/theme";

/**
 * "Feel like you?" — instant reaction to a fresh plan. A thumbs-down asks why and
 * offers the matching Magic Edit, so feedback turns straight into a better plan.
 */
export function PlanPulse({ plan, onFix }: { plan: Itinerary; onFix: (instruction: string) => void }) {
  const { react, track } = useStore();
  const [vote, setVote] = useState<1 | -1 | null>(null);
  const [reason, setReason] = useState<PulseReason | null>(null);

  const send = (value: 1 | -1, why?: PulseReason) => {
    // Plan-level reactions count lightly toward each stop's category and type (not the venues themselves).
    const entries = plan.stops
      .flatMap((s) => placeKeys(s.place).filter((k) => !k.startsWith("place:")))
      .filter((k, i, all) => all.indexOf(k) === i)
      .map((key) => ({ key, value }));
    react("plan", entries, why);
    track("plan_pulse", { value, reason: why ?? "none" });
  };

  if (vote === 1)
    return (
      <Animated.View entering={FadeIn} style={[s.card, { backgroundColor: color.mintTint }]}>
        <Icon name="heart" tint={color.success} />
        <T v="bodyStrong" style={{ flex: 1 }}>
          Love that. We’ll find more like this.
        </T>
      </Animated.View>
    );

  if (vote === -1)
    return (
      <Animated.View entering={FadeIn} style={[s.card, { flexDirection: "column", alignItems: "stretch" }]} testID="pulse-reasons">
        <T v="bodyStrong">What’s off?</T>
        <View style={s.chips}>
          {(Object.keys(pulseReasons) as PulseReason[]).map((r) => (
            <Chip
              key={r}
              label={pulseReasons[r].label}
              selected={reason === r}
              onPress={() => {
                setReason(r);
                send(-1, r);
              }}
            />
          ))}
        </View>
        {reason && pulseReasons[reason].fix ? (
          <Button label={`Fix it: “${pulseReasons[reason].fix}”`} icon="star" kind="dark" onPress={() => onFix(pulseReasons[reason].fix)} />
        ) : reason === "wrong_time" ? (
          <T v="small" tone={color.muted}>
            Go back and tap the time chip to pick another slot — everything else is kept.
          </T>
        ) : (
          <T v="small" tone={color.muted}>
            Thanks — this tunes what we suggest to you and to people like you.
          </T>
        )}
      </Animated.View>
    );

  return (
    <View style={s.card} testID="plan-pulse">
      <T v="bodyStrong" style={{ flex: 1 }}>
        Does this feel like you?
      </T>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Yes, this feels like me"
        testID="pulse-up"
        onPress={() => {
          tap("success");
          setVote(1);
          send(1);
        }}
        style={s.thumb}
      >
        <Icon name="thumbs-up" />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="No, not quite"
        testID="pulse-down"
        onPress={() => {
          tap("select");
          setVote(-1);
        }}
        style={s.thumb}
      >
        <Icon name="thumbs-down" />
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.lg, borderRadius: radius.lg, backgroundColor: color.paper, borderWidth: 1, borderColor: color.line },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginVertical: space.md },
  thumb: { width: 48, height: 48, borderRadius: 24, borderWidth: 1, borderColor: color.line, alignItems: "center", justifyContent: "center", backgroundColor: color.canvas },
});
