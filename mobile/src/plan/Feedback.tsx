import { useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import type { Feedback } from "@shared/profile";
import type { Itinerary } from "@shared/schema";
import { Button, Chip, Icon, Sheet, T, tap } from "@/ui/kit";
import { color, font, radius, space } from "@/ui/theme";

/** "Did you go? How was it?" — the core retention signal, and it tunes future plans. */
export function FeedbackSheet({ open, onClose, plan, onSubmit }: { open: boolean; onClose: () => void; plan: Itinerary; onSubmit: (f: Feedback) => Promise<void> }) {
  const [went, setWent] = useState<Feedback["went"] | null>(null);
  const [rating, setRating] = useState(0);
  const [reactions, setReactions] = useState<Record<string, 1 | -1>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!went) return;
    setBusy(true);
    await onSubmit({
      planId: plan.id,
      went,
      rating: rating || undefined,
      stops: plan.stops
        .filter((s) => reactions[s.placeId])
        .map((s) => ({ placeId: s.placeId, category: s.place.category.slice(0, 60), reaction: reactions[s.placeId] })),
      note: note.slice(0, 500),
    });
    setBusy(false);
  };
  return (
    <Sheet open={open} onClose={onClose} title="How was it?" footer={<Button testID="feedback-submit" label="Send feedback" busy={busy} disabled={!went} onPress={submit} />}>
      <T v="bodyStrong">Did you go?</T>
      <View style={s.chips}>
        <Chip label="Yes, all of it" selected={went === "yes"} onPress={() => setWent("yes")} />
        <Chip label="Some of it" selected={went === "partly"} onPress={() => setWent("partly")} />
        <Chip label="We didn’t go" selected={went === "no"} onPress={() => setWent("no")} />
      </View>
      {went && went !== "no" ? (
        <>
          <T v="bodyStrong" style={{ marginTop: space.lg }}>
            Overall
          </T>
          <View style={[s.chips, { gap: 4 }]} accessibilityRole="adjustable" accessibilityValue={{ min: 0, max: 5, now: rating }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Pressable key={n} accessibilityRole="button" accessibilityLabel={`${n} star${n > 1 ? "s" : ""}`} onPress={() => { tap("select"); setRating(n); }} style={s.star} hitSlop={4}>
                <Icon name="star" size={26} tint={n <= rating ? color.coral : color.line} />
              </Pressable>
            ))}
          </View>
          <T v="bodyStrong" style={{ marginTop: space.lg }}>
            Each stop
          </T>
          <T v="small" tone={color.muted}>
            We’ll lean toward what you loved and skip what you didn’t.
          </T>
          {plan.stops.map((st) => (
            <View key={st.placeId} style={s.stopRow}>
              <T v="body" style={{ flex: 1 }} numberOfLines={1}>
                {st.place.name}
              </T>
              <Pressable accessibilityRole="button" accessibilityLabel={`Loved ${st.place.name}`} accessibilityState={{ selected: reactions[st.placeId] === 1 }} onPress={() => setReactions({ ...reactions, [st.placeId]: 1 })} style={[s.react, reactions[st.placeId] === 1 && { backgroundColor: color.mint }]}>
                <Icon name="thumbs-up" size={16} />
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={`Not for us: ${st.place.name}`} accessibilityState={{ selected: reactions[st.placeId] === -1 }} onPress={() => setReactions({ ...reactions, [st.placeId]: -1 })} style={[s.react, reactions[st.placeId] === -1 && { backgroundColor: color.coralTint }]}>
                <Icon name="thumbs-down" size={16} />
              </Pressable>
            </View>
          ))}
        </>
      ) : null}
      {went ? (
        <TextInput value={note} onChangeText={setNote} placeholder={went === "no" ? "What got in the way? (optional)" : "Anything else? (optional)"} placeholderTextColor={color.faint} accessibilityLabel="Note" style={s.input} multiline maxLength={500} />
      ) : null}
    </Sheet>
  );
}
const s = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.sm },
  star: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  stopRow: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.sm },
  react: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: color.line, alignItems: "center", justifyContent: "center", backgroundColor: color.paper },
  input: { minHeight: 60, marginTop: space.lg, borderRadius: radius.md, borderWidth: 1, borderColor: color.line, backgroundColor: color.paper, padding: space.md, fontFamily: font.body, fontSize: 15, color: color.ink, textAlignVertical: "top" },
});
