import { useMemo, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { interpretEdit } from "@shared/magic-edit";
import { distance } from "@shared/geo";
import type { Itinerary } from "@shared/schema";
import { Button, Chip, Icon, Notice, Sheet, T } from "@/ui/kit";
import { color, font, radius, space } from "@/ui/theme";

// Suggestions that fit this plan: no "romantic" for friends, no "replace dinner" without one.
function suggestionsFor(plan: Itinerary) {
  const dinner = plan.stops.some((s) => /restaurant/.test(s.place.types.join(" ")) && new Date(s.arrival).getHours() >= 16);
  const sweet = plan.stops.some((s) => /dessert|ice_cream|bakery/.test(s.place.types.join(" ")));
  return [
    "Make it cheaper",
    plan.request.companions === "partner" ? "Make it more romantic" : "Make it more fun",
    dinner ? "Swap dinner for somewhere different" : "Add a proper meal",
    plan.stops.length > 2 ? "Keep the first two stops, change the last one" : "Add a stop",
    "Reduce walking",
    "It’s raining — make it indoors",
    sweet ? "Make it shorter" : "Add dessert at the end",
    "Finish by 9pm",
  ];
}

export function MagicEditSheet({ open, onClose, plan, busy, error, onApply }: { open: boolean; onClose: () => void; plan: Itinerary; busy: boolean; error: string; onApply: (instruction: string) => void }) {
  const [text, setText] = useState("");
  // The same deterministic interpreter the server uses, for an honest preview.
  const preview = useMemo(() => {
    if (text.trim().length < 2) return null;
    return interpretEdit(
      text,
      plan.stops.map((s, i) => ({
        placeId: s.placeId,
        locked: s.locked,
        name: s.place.name,
        category: s.place.category,
        types: s.place.types,
        priceHigh: s.place.price.high,
        travel: i ? distance(plan.stops[i - 1].place.point, s.place.point) : 0,
      })),
      plan.request,
    );
  }, [text, plan]);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Magic edit"
      footer={
        <Button
          testID="magic-apply"
          label={busy ? "Reworking your plan…" : "Apply"}
          icon="star"
          busy={busy}
          disabled={!preview || preview.kind === "noop"}
          onPress={() => onApply(text.trim())}
        />
      }
    >
      <T v="body" tone={color.muted}>
        Say what to change. We only touch what’s needed and keep everything you’ve locked.
      </T>
      <TextInput
        testID="magic-input"
        value={text}
        onChangeText={setText}
        placeholder="e.g. swap the last stop for live music"
        placeholderTextColor={color.faint}
        accessibilityLabel="What should change?"
        style={s.input}
        multiline
        maxLength={300}
        autoFocus
      />
      <View style={s.chips}>
        {suggestionsFor(plan).map((x) => (
          <Chip key={x} label={x} onPress={() => setText(x)} selected={text === x} />
        ))}
      </View>
      {preview ? (
        <View style={s.preview} accessibilityLiveRegion="polite">
          <Icon name={preview.kind === "noop" ? "info" : "eye"} size={16} tint={color.inkSoft} />
          <T v="small" tone={color.inkSoft} style={{ flex: 1 }}>
            {preview.summary}
          </T>
        </View>
      ) : null}
      {error ? (
        <View style={{ marginTop: space.md }}>
          <Notice tone="coral" icon="alert-circle">
            {error}
          </Notice>
        </View>
      ) : null}
    </Sheet>
  );
}

const s = StyleSheet.create({
  input: { minHeight: 70, marginTop: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: color.line, backgroundColor: color.paper, padding: space.md, fontFamily: font.body, fontSize: 16, color: color.ink, textAlignVertical: "top" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.md },
  preview: { flexDirection: "row", gap: space.sm, marginTop: space.lg, padding: space.md, borderRadius: radius.md, backgroundColor: color.lavenderTint },
});
