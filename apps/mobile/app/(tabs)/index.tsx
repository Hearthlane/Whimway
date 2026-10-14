import React, { useState } from "react";
import { Text, View, TextInput, Switch } from "react-native";
import { router } from "expo-router";
import { Sparkles, ArrowUpRight } from "lucide-react-native";
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
            { justifyContent: "space-between", marginBottom: 28 },
          ]}
        >
          <Text style={[styles.heading, { fontSize: 24 }]}>
            whimway<Text style={{ color: c.coral }}>✳</Text>
          </Text>
          <Text style={styles.eyebrow}>GOOD DAYS AHEAD</Text>
        </View>
        <Text style={styles.title}>
          A little whim.{"\n"}A whole{" "}
          <Text style={{ color: "#A13A2D" }}>good day.</Text>
        </Text>
        <Text style={[styles.body, { marginTop: 12, marginBottom: 24 }]}>
          Real places. Your kind of adventure.
        </Text>
      </Reveal>
      <Reveal delay={80}>
        <View style={styles.section}>
          <Text style={styles.heading}>Where are we heading?</Text>
          <LocationSearch
            value={location}
            onChange={setLocation}
            demo={demo}
            onBusyChange={setSelecting}
          />
          <View
            style={[
              styles.row,
              {
                alignItems: "flex-start",
                backgroundColor: c.lilac,
                borderRadius: 20,
                padding: 16,
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
              placeholder="Or tell me your perfect day…"
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
