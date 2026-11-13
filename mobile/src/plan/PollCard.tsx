import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { applyPoll, nextPoll, polls, type Poll, type PollTally } from "@shared/polls";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";
import { Icon, T, tap } from "@/ui/kit";
import { color, radius, space } from "@/ui/theme";

/**
 * One-tap "this or that" poll. Answering tunes your own taste instantly and adds an
 * anonymous vote to the community signal that re-ranks plans for everyone.
 */
export function PollCard() {
  const { profile, setProfile, installId, track } = useStore();
  const [skipped, setSkipped] = useState<string[]>([]);
  const [poll, setPoll] = useState<Poll | undefined>(() => nextPoll(profile.polls));
  const [result, setResult] = useState<{ choice: "a" | "b"; tally: PollTally } | null>(null);
  const [tallies, setTallies] = useState<Record<string, PollTally>>({});

  useEffect(() => {
    void api<{ tallies: Record<string, PollTally> }>("polls")
      .then((r) => setTallies(r.tallies))
      .catch(() => undefined);
  }, []);
  if (!poll) return null;

  const answer = async (choice: "a" | "b") => {
    tap("success");
    setProfile(applyPoll(profile, poll, choice));
    track("poll_answered", { poll: poll.id, choice });
    // Optimistic: show results right away, then reconcile with the server tally.
    const prior = tallies[poll.id] ?? { a: 0, b: 0 };
    setResult({ choice, tally: { ...prior, [choice]: prior[choice] + 1 } });
    try {
      const r = await api<{ tally: PollTally }>("polls/answer", { pollId: poll.id, choice, installId });
      setResult({ choice, tally: r.tally });
      setTallies((t) => ({ ...t, [poll.id]: r.tally }));
    } catch {
      // Offline: the personal taste update still stands.
    }
  };
  const next = () => {
    const skip = [...skipped, poll.id];
    setSkipped(skip);
    setResult(null);
    setPoll(nextPoll({ ...profile.polls, [poll.id]: result?.choice ?? "a" }, skip) ?? polls[0]);
  };
  const total = result ? result.tally.a + result.tally.b : 0;
  const pct = (k: "a" | "b") => (total ? Math.round((result!.tally[k] / total) * 100) : 0);
  const answeredCount = Object.keys(profile.polls).length;

  return (
    <Animated.View key={poll.id} entering={FadeInDown.duration(300)} style={s.card} testID="poll-card">
      <View style={s.header}>
        <View style={s.badge}>
          <Icon name="bar-chart-2" size={13} tint={color.ink} />
          <T v="eyebrow" style={{ fontSize: 10 }}>
            Quick poll
          </T>
        </View>
        <Pressable accessibilityRole="button" onPress={next} hitSlop={10} testID="poll-next">
          <T v="smallStrong" tone={color.muted}>
            {result ? "Next" : "Skip"}
          </T>
        </Pressable>
      </View>
      <T v="heading" style={{ marginTop: space.sm }}>
        {poll.question}
      </T>
      <View style={{ gap: space.sm, marginTop: space.md }}>
        {(["a", "b"] as const).map((k) =>
          result ? (
            <Animated.View key={k} entering={FadeIn.duration(250)} style={[s.result, result.choice === k && { borderColor: color.ink }]}>
              <View style={[s.fill, { width: `${pct(k)}%`, backgroundColor: result.choice === k ? color.coral : color.mint }]} />
              <T v="bodyStrong" style={{ flex: 1 }}>
                {poll[k].label}
                {result.choice === k ? "  ✓" : ""}
              </T>
              <T v="bodyStrong">{total >= 10 ? `${pct(k)}%` : ""}</T>
            </Animated.View>
          ) : (
            <Pressable
              key={k}
              testID={`poll-${k}`}
              accessibilityRole="button"
              accessibilityLabel={poll[k].label}
              onPress={() => answer(k)}
              style={({ pressed }) => [s.option, pressed && { backgroundColor: color.mintTint }]}
            >
              <T v="bodyStrong">{poll[k].label}</T>
            </Pressable>
          ),
        )}
      </View>
      <T v="small" tone={color.muted} style={{ marginTop: space.md }}>
        {result
          ? total >= 10
            ? `${total} people answered. Your plans just got a little more you.`
            : "You’re one of the first — results show after 10 votes. Your plans just got a little more you."
          : answeredCount
            ? `${answeredCount} answered · anonymous · helps everyone get better plans`
            : "Anonymous. Every answer makes your plans (and everyone’s) better."}
      </T>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: color.lavenderTint, borderRadius: radius.xl, padding: space.lg },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  badge: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: color.paper, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  option: { minHeight: 52, borderRadius: radius.md, backgroundColor: color.paper, paddingHorizontal: space.lg, justifyContent: "center", borderWidth: 1, borderColor: color.line },
  result: { minHeight: 52, borderRadius: radius.md, backgroundColor: color.paper, paddingHorizontal: space.lg, flexDirection: "row", alignItems: "center", overflow: "hidden", borderWidth: 1, borderColor: color.line },
  fill: { position: "absolute", left: 0, top: 0, bottom: 0, opacity: 0.45 },
});
