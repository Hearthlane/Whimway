import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { Easing, FadeIn, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withSpring, withTiming } from "react-native-reanimated";
import { Icon, Spark, T } from "@/ui/kit";
import { color, motion, shadow, space } from "@/ui/theme";

export const stages = ["Reading the vibe", "Finding real places nearby", "Checking opening hours", "Mapping the route", "Putting it all together"];

/**
 * The one big moment: the plan is drawn as a route, stage by stage. Each node fills
 * as that step completes, so waiting reads as progress along the night ahead.
 */
export function Generating({ stage, refreshing }: { stage: number; refreshing?: boolean }) {
  const pulse = useSharedValue(1);
  const spin = useSharedValue(0);
  useEffect(() => {
    pulse.set(withRepeat(withSequence(withTiming(1.1, { duration: 800, easing: Easing.inOut(Easing.quad) }), withTiming(1, { duration: 800, easing: Easing.inOut(Easing.quad) })), -1));
    spin.set(withRepeat(withTiming(360, { duration: 9000, easing: Easing.linear }), -1));
  }, [pulse, spin]);
  const orb = useAnimatedStyle(() => ({ transform: [{ scale: pulse.get() }] }));
  const ring = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.get()}deg` }] }));

  return (
    <Animated.View entering={FadeIn.duration(motion.standard)} style={s.wrap} testID="generating">
      <View style={s.orbWrap}>
        <Animated.View style={[s.ring, ring]}>
          <View style={[s.satellite, { top: -6, left: 58, backgroundColor: color.mint }]} />
          <View style={[s.satellite, { bottom: 4, left: 8, backgroundColor: color.lavender, width: 10, height: 10 }]} />
          <View style={[s.satellite, { top: 40, right: -7, backgroundColor: color.yellow }]} />
        </Animated.View>
        <Animated.View style={[s.orb, orb]}>
          <Spark size={64} />
        </Animated.View>
      </View>

      <T v="title" style={{ textAlign: "center" }} accessibilityLiveRegion="polite">
        {refreshing ? "Refreshing live details" : "Building your night"}
      </T>

      {refreshing ? null : (
        <View style={s.route} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: stages.length, now: stage + 1 }}>
          {stages.map((label, i) => (
            <Step key={label} label={label} state={i < stage ? "done" : i === stage ? "now" : "next"} last={i === stages.length - 1} />
          ))}
        </View>
      )}
    </Animated.View>
  );
}

function Step({ label, state, last }: { label: string; state: "done" | "now" | "next"; last: boolean }) {
  const fill = useSharedValue(state === "next" ? 0 : 1);
  const line = useSharedValue(state === "done" ? 1 : 0);
  useEffect(() => {
    fill.set(withSpring(state === "next" ? 0 : 1, motion.spring));
    line.set(withTiming(state === "done" ? 1 : 0, { duration: motion.slow }));
  }, [state, fill, line]);
  const node = useAnimatedStyle(() => ({ transform: [{ scale: 0.6 + fill.get() * 0.4 }], opacity: 0.35 + fill.get() * 0.65 }));
  const bar = useAnimatedStyle(() => ({ height: `${line.get() * 100}%` }));
  return (
    <View style={s.step}>
      <View style={s.rail}>
        <Animated.View style={[s.node, state === "done" && { backgroundColor: color.ink }, state === "now" && { backgroundColor: color.coral }, node]}>
          {state === "done" ? <Icon name="check" size={12} tint={color.paper} /> : null}
        </Animated.View>
        {last ? null : (
          <View style={s.track}>
            <Animated.View style={[s.trackFill, bar]} />
          </View>
        )}
      </View>
      <T v={state === "now" ? "bodyStrong" : "body"} tone={state === "next" ? color.faint : color.ink} style={s.label}>
        {label}
        {state === "now" ? "…" : ""}
      </T>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { alignItems: "center", gap: space.xl, width: "100%", maxWidth: 320 },
  orbWrap: { width: 132, height: 132, alignItems: "center", justifyContent: "center" },
  ring: { position: "absolute", width: 132, height: 132, borderRadius: 66, borderWidth: 1.5, borderColor: color.line, borderStyle: "dashed" },
  satellite: { position: "absolute", width: 14, height: 14, borderRadius: 7 },
  orb: { width: 92, height: 92, borderRadius: 30, backgroundColor: color.coral, alignItems: "center", justifyContent: "center", ...shadow.lift },
  route: { alignSelf: "stretch", paddingHorizontal: space.lg },
  step: { flexDirection: "row", gap: space.md, minHeight: 44 },
  rail: { width: 22, alignItems: "center" },
  node: { width: 22, height: 22, borderRadius: 11, backgroundColor: color.line, alignItems: "center", justifyContent: "center" },
  track: { flex: 1, width: 2, backgroundColor: color.line, marginVertical: 2, borderRadius: 1, overflow: "hidden" },
  trackFill: { width: 2, backgroundColor: color.ink },
  label: { paddingTop: 0, flex: 1 },
});
