import React, { useState } from "react";
import {
  Text,
  View,
  TextInput,
  Switch,
  Pressable,
  Keyboard,
} from "react-native";
import { router } from "expo-router";
import { Asterisk, Sparkles, ArrowUpRight, MapPin } from "lucide-react-native";
import { Screen, styles, Button, Reveal, Chip } from "../../src/components/ui";
import { RouteArt } from "../../src/components/RouteArt";
import { LocationSearch } from "../../src/components/LocationSearch";
import { useApp } from "../../src/state/AppState";
import { colors as c } from "../../src/design/theme";
import type { Location } from "../../../../lib/schema";
import {
  applySavedPreferences,
  choosePreferences,
  defaultStart,
  type Draft,
} from "../../src/core/planning";
export default function Explore() {
  const { draft, setDraft, preferences } = useApp();
  const [prompt, setPrompt] = useState("");
  const [entry, setEntry] = useState<"place" | "idea">("place");
  const [location, setLocation] = useState<Location>();
  const [demo, setDemo] = useState(false);
  const [selecting, setSelecting] = useState(false);
  function start(interest?: string) {
    if (selecting) return;
    let next: Draft = applySavedPreferences(
      {
        prompt,
        location,
        demo,
        known: location ? ["location"] : [],
        ...(location ? defaultStart(location) : {}),
      },
      preferences,
    );
    if (interest)
      next = choosePreferences(next, {
        interests: [interest as "Food & drinks"],
      });
    setDraft(next);
    router.push("/planner");
  }
  return (
    <Screen>
      <Reveal>
        <View
          style={[
            styles.row,
            {
              justifyContent: "space-between",
              flexWrap: "wrap",
              columnGap: 12,
              rowGap: 8,
              marginBottom: 24,
            },
          ]}
        >
          <View
            accessible
            accessibilityRole="header"
            accessibilityLabel="Whimway"
            style={[styles.row, { gap: 2 }]}
          >
            <Text style={[styles.heading, { fontSize: 24 }]}>whimway</Text>
            <Asterisk size={24} strokeWidth={3} color={c.coral} />
          </View>
          <Text style={styles.eyebrow}>GOOD DAYS AHEAD</Text>
        </View>
        <Text style={[styles.title, { fontSize: 36, lineHeight: 40 }]}>
          Where are we heading?
        </Text>
        <Text style={[styles.body, { marginTop: 10, marginBottom: 24 }]}>
          A little whim. A whole good day.
        </Text>
      </Reveal>
      <Reveal delay={80}>
        <View style={styles.section}>
          <View style={[styles.row, { gap: 8, alignItems: "stretch" }]}>
            {(
              [
                ["place", "Pick a place", MapPin],
                ["idea", "Describe a day", Sparkles],
              ] as const
            ).map(([value, label, Icon]) => (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityState={{
                  selected: entry === value,
                  disabled: selecting,
                }}
                aria-pressed={entry === value}
                disabled={selecting}
                onPress={() => {
                  Keyboard.dismiss();
                  setEntry(value);
                }}
                style={({ pressed }) => ({
                  flex: 1,
                  minHeight: 52,
                  paddingHorizontal: 12,
                  paddingVertical: 12,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: entry === value ? c.ink : c.line,
                  backgroundColor: entry === value ? c.lilac : c.white,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Icon size={18} color={c.ink} />
                <Text style={[styles.label, { flexShrink: 1 }]}>{label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={{ display: entry === "place" ? "flex" : "none" }}>
            <LocationSearch
              value={location}
              onChange={setLocation}
              demo={demo}
              onBusyChange={setSelecting}
            />
          </View>
          <View
            style={[
              styles.row,
              {
                alignItems: "flex-start",
                backgroundColor: c.lilac,
                borderRadius: 20,
                padding: 16,
                display: entry === "idea" ? "flex" : "none",
              },
            ]}
          >
            <Sparkles size={20} color={c.ink} />
            <TextInput
              multiline
              maxLength={1500}
              accessibilityLabel="Describe your ideal outing"
              value={prompt}
              onChangeText={setPrompt}
              placeholder="A slow morning, good coffee, a little fresh air…"
              placeholderTextColor={c.muted}
              style={[
                styles.body,
                {
                  color: c.ink,
                  flex: 1,
                  minHeight: 70,
                  textAlignVertical: "top",
                },
              ]}
            />
          </View>
          <Button
            disabled={selecting}
            title={
              prompt.trim()
                ? "Make it my kind of day"
                : "Let’s find something good"
            }
            onPress={() => start()}
          />
        </View>
      </Reveal>
      <Reveal delay={160}>
        <RouteArt />
        <View style={{ gap: 16, marginTop: 26 }}>
          <View style={[styles.row, { justifyContent: "space-between" }]}>
            <Text style={styles.heading}>Follow a feeling</Text>
            <ArrowUpRight color={c.ink} size={22} />
          </View>
          <View style={[styles.row, { flexWrap: "wrap" }]}>
            {[
              ["A bite & a wander", "Food & drinks"],
              ["Fresh-air feelings", "Outdoors"],
              ["A little culture", "Arts & culture"],
            ].map(([label, interest]) => (
              <Chip key={label} label={label} onPress={() => start(interest)} />
            ))}
          </View>
        </View>
      </Reveal>
      {__DEV__ ? (
        <View style={[styles.row, { marginTop: 28 }]}>
          <Switch
            accessibilityLabel="Use synthetic development fixtures"
            value={demo}
            onValueChange={setDemo}
          />
          <Text style={[styles.body, { flex: 1, fontSize: 12 }]}>
            Development fixtures · synthetic places, never live directions
          </Text>
        </View>
      ) : null}
      {draft.location ? (
        <Text style={[styles.body, { fontSize: 12, marginTop: 20 }]}>
          Your previous answers stay in the planner until you start a new
          outing.
        </Text>
      ) : null}
    </Screen>
  );
}
