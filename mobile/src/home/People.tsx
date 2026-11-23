import { router } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, TextInput, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { activities, cuisines } from "@shared/guide";
import type { TasteProfile } from "@shared/profile";
import { useStore } from "@/lib/store";
import { Button, Chip, Icon, Press, Sheet, T, tap } from "@/ui/kit";
import { color, font, radius, space } from "@/ui/theme";

export type Person = TasteProfile["people"][number];
const fills = [color.coral, color.mint, color.lavender, color.yellow];
const relationLabel = { partner: "Partner", friend: "Friend", family: "Family" } as const;

/** A round initial, coloured by name, for people and the profile. */
export function Avatar({ name, size = 56, ring }: { name: string; size?: number; ring?: boolean }) {
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  const fill = fills[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % fills.length];
  return (
    <View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: fill, alignItems: "center", justifyContent: "center" }, ring && s.ring]}>
      <T style={{ fontFamily: font.displayBold, fontSize: size * 0.42, lineHeight: size * 0.5, color: color.ink }}>{initial}</T>
    </View>
  );
}

/** Start the guided planner with this person: who, group size and their favourites first. */
export function planWith(person: Person) {
  router.push({ pathname: "/guide", params: { person: person.id } });
}

/** Horizontal row of people with an add button, for the home screen. */
/** The add/edit sheet is rendered by the screen (`onEdit`), so it covers the whole screen. */
export function PeopleRow({ onEdit }: { onEdit: (p: Person | "new") => void }) {
  const { profile } = useStore();
  const setEditing = onEdit;
  return (
    <View style={{ gap: space.md }}>
      <View style={s.head}>
        <T v="heading">Your people</T>
        {profile.people.length ? (
          <Press accessibilityRole="button" onPress={() => router.push({ pathname: "/profile", params: { tab: "people" } })} hitSlop={8}>
            <T v="smallStrong" tone={color.coralText}>
              See all
            </T>
          </Press>
        ) : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.bleed} contentContainerStyle={s.row}>
        <Press testID="person-add" accessibilityRole="button" accessibilityLabel="Add someone you go out with" onPress={() => setEditing("new")} style={s.item}>
          <View style={s.add}>
            <Icon name="plus" size={24} />
          </View>
          <T v="small" numberOfLines={1}>
            Add
          </T>
        </Press>
        {profile.people.map((p) => (
          <Press key={p.id} testID={`person-${p.id}`} accessibilityRole="button" accessibilityLabel={`Plan with ${p.name}`} onPress={() => (tap("select"), planWith(p))} onLongPress={() => setEditing(p)} style={s.item}>
            <Avatar name={p.name} ring />
            <T v="small" numberOfLines={1} style={{ maxWidth: 72, textAlign: "center" }}>
              {p.name}
            </T>
          </Press>
        ))}
      </ScrollView>
      {!profile.people.length ? (
        <T v="small" tone={color.muted}>
          Add the people you go out with and what they like. Tap someone to plan with them.
        </T>
      ) : (
        <T v="small" tone={color.faint}>
          Tap to plan with someone. Press and hold to edit.
        </T>
      )}
    </View>
  );
}

/** Add or edit a person. Kept on this device (and synced with the profile when signed in). */
export function PersonSheet({ person, onClose }: { person: Person | "new" | null; onClose: () => void }) {
  const store = useStore();
  const { profile } = store;
  const current = person && person !== "new" ? person : null;
  const [draft, setDraft] = useState<Person>(() => current ?? { id: "", name: "", relation: "friend", likes: [], note: "" });
  const [shownFor, setShownFor] = useState<string | null>(null);
  const key = person === "new" ? "new" : (current?.id ?? null);
  // Reset the form whenever a different person (or "new") opens the sheet.
  if (key !== shownFor) {
    setShownFor(key);
    setDraft(current ?? { id: "", name: "", relation: "friend", likes: [], note: "" });
  }
  const save = () => {
    const name = draft.name.trim().slice(0, 40);
    if (!name) return;
    const id = draft.id || `p${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
    const next = { ...draft, id, name, note: draft.note.trim().slice(0, 120) };
    store.setProfile({ ...profile, people: [next, ...profile.people.filter((p) => p.id !== id)].slice(0, 30) });
    tap("success");
    onClose();
  };
  const remove = () => {
    if (!current) return;
    store.setProfile({ ...profile, people: profile.people.filter((p) => p.id !== current.id) });
    onClose();
  };
  const toggle = (k: string) => setDraft({ ...draft, likes: draft.likes.includes(k) ? draft.likes.filter((x) => x !== k) : [...draft.likes, k].slice(-8) });
  return (
    <Sheet open={Boolean(person)} onClose={onClose} title={current ? `Edit ${current.name}` : "Add someone"}>
      <Animated.View entering={FadeIn.duration(200)} style={{ gap: space.lg }}>
        <View style={{ alignItems: "center" }}>
          <Avatar name={draft.name || "?"} size={72} />
        </View>
        <View style={{ gap: space.sm }}>
          <T v="smallStrong">Name</T>
          <TextInput testID="person-name" value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} placeholder="Sam" placeholderTextColor={color.faint} maxLength={40} accessibilityLabel="Name" style={s.input} />
        </View>
        <View style={{ gap: space.sm }}>
          <T v="smallStrong">Who they are to you</T>
          <View style={s.chips}>
            {(["partner", "friend", "family"] as const).map((r) => (
              <Chip key={r} label={relationLabel[r]} selected={draft.relation === r} onPress={() => setDraft({ ...draft, relation: r })} testID={`person-relation-${r}`} />
            ))}
          </View>
        </View>
        <View style={{ gap: space.sm }}>
          <T v="smallStrong">What they enjoy</T>
          <View style={s.chips}>
            {[...cuisines, ...activities].map((g) => (
              <Chip key={g.key} label={g.label} selected={draft.likes.includes(g.key)} onPress={() => toggle(g.key)} testID={`person-like-${g.key}`} />
            ))}
          </View>
        </View>
        <View style={{ gap: space.sm }}>
          <T v="smallStrong">Anything to keep in mind</T>
          <TextInput value={draft.note} onChangeText={(note) => setDraft({ ...draft, note })} placeholder="Vegetarian, no late nights…" placeholderTextColor={color.faint} maxLength={120} accessibilityLabel="Notes" style={s.input} />
        </View>
        <Button testID="person-save" label={current ? "Save" : "Add"} disabled={!draft.name.trim()} onPress={save} />
        {current ? (
          <View style={s.rowEnd}>
            <Button kind="ghost" label={`Plan with ${current.name}`} icon="arrow-right" onPress={() => (onClose(), planWith(current))} />
            <Button kind="ghost" label="Remove" icon="trash-2" onPress={remove} />
          </View>
        ) : null}
        <T v="small" tone={color.faint}>
          Only you can see this list. Nobody is contacted or notified.
        </T>
      </Animated.View>
    </Sheet>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  bleed: { marginHorizontal: -space.xl },
  row: { gap: space.lg, paddingHorizontal: space.xl },
  item: { alignItems: "center", gap: 6, width: 72 },
  add: { width: 56, height: 56, borderRadius: 28, borderWidth: 1.5, borderColor: color.line, borderStyle: "dashed", backgroundColor: color.paper, alignItems: "center", justifyContent: "center" },
  ring: { borderWidth: 2.5, borderColor: color.paper, shadowColor: color.ink, shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  input: { minHeight: 50, borderRadius: radius.md, borderWidth: 1.5, borderColor: color.line, backgroundColor: color.paper, paddingHorizontal: space.lg, fontFamily: font.body, fontSize: 16, color: color.ink },
  rowEnd: { flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: space.sm },
});
