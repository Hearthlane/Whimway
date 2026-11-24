import { router, Stack } from "expo-router";
import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Icon, T } from "@/ui/kit";
import { color, space } from "@/ui/theme";

/** Any link that doesn't lead anywhere: say so plainly and offer the two useful ways out. */
export default function NotFound() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.canvas }}>
      <Stack.Screen options={{ title: "Not found" }} />
      <View style={s.body}>
        <View style={s.icon}>
          <Icon name="map" size={28} />
        </View>
        <T v="title" accessibilityRole="header" style={{ textAlign: "center" }}>
          This page took a wrong turn
        </T>
        <T v="body" tone={color.muted} style={{ textAlign: "center", maxWidth: 320 }}>
          The link may be old or mistyped. Your plans are safe.
        </T>
        <View style={{ flexDirection: "row", gap: space.sm, marginTop: space.md }}>
          <Button kind="soft" icon="home" label="Go home" onPress={() => router.replace("/")} testID="not-found-home" />
          <Button kind="dark" icon="plus" label="Make a plan" onPress={() => router.replace("/create")} />
        </View>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  body: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, padding: space.xl },
  icon: { width: 64, height: 64, borderRadius: 32, backgroundColor: color.paper, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: color.line },
});
