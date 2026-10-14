import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, fonts } from "../design/theme";
import type { RouteMapProps } from "./RouteMap.types";
export type { RouteMapProps } from "./RouteMap.types";
export function RouteMap({
  plan,
  selectedId,
  onSelectStop,
  style,
}: RouteMapProps) {
  return (
    <View style={[styles.container, style]}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: 12 }}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>The day, mapped out.</Text>
        <Text style={styles.note}>
          Interactive maps and location following are available in the iOS and
          Android app.
        </Text>
        {plan?.stops.map((stop, index) => (
          <Pressable
            key={stop.placeId}
            onPress={() => onSelectStop?.(stop.placeId)}
            accessibilityRole="button"
            accessibilityLabel={`Select stop ${index + 1}, ${stop.place.name}`}
            accessibilityState={{ selected: selectedId === stop.placeId }}
            style={[
              styles.stop,
              selectedId === stop.placeId && styles.selected,
            ]}
          >
            <View style={styles.number}>
              <Text style={styles.numberText}>{index + 1}</Text>
            </View>
            <Text style={styles.name}>{stop.place.name}</Text>
          </Pressable>
        ))}
        {!plan ? (
          <Text style={styles.note}>
            Use Search a place in this browser preview.
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}
export default RouteMap;
const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.mint,
    borderRadius: 24,
    padding: 20,
    gap: 12,
    overflow: "hidden",
  },
  title: { fontFamily: fonts.display, color: colors.ink, fontSize: 24 },
  note: {
    fontFamily: fonts.body,
    color: colors.ink,
    fontSize: 13,
    lineHeight: 20,
  },
  stop: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 44,
    gap: 12,
    padding: 6,
    borderRadius: 14,
  },
  selected: { backgroundColor: "rgba(255,255,255,0.65)" },
  number: {
    height: 28,
    width: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: colors.ink,
  },
  numberText: { fontFamily: fonts.medium, color: colors.white },
  name: { flex: 1, fontFamily: fonts.medium, color: colors.ink, fontSize: 14 },
});
