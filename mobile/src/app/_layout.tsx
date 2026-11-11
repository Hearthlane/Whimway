import { DMSans_400Regular, DMSans_500Medium, DMSans_700Bold } from "@expo-google-fonts/dm-sans";
import { Outfit_500Medium, Outfit_600SemiBold } from "@expo-google-fonts/outfit";
import { useFonts } from "expo-font";
import { Stack, type ErrorBoundaryProps } from "expo-router";
import { Platform, View } from "react-native";
import { api } from "@/lib/api";
import { Button, Icon, T } from "@/ui/kit";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StoreProvider, useStore } from "@/lib/store";
import { color } from "@/ui/theme";

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

function Navigator() {
  const { ready, track } = useStore();
  const [fontsLoaded] = useFonts({ DMSans_400Regular, DMSans_500Medium, DMSans_700Bold, Outfit_500Medium, Outfit_600SemiBold });
  const visible = ready && fontsLoaded;
  useEffect(() => {
    if (visible) {
      void SplashScreen.hideAsync().catch(() => undefined);
      track("app_opened");
    }
  }, [visible, track]);
  if (!visible) return null;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.canvas } }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="onboarding" options={{ gestureEnabled: false, animation: "fade" }} />
      <Stack.Screen name="plan/[id]" options={{ animation: "slide_from_right" }} />
      <Stack.Screen name="import" options={{ animation: "slide_from_bottom" }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StoreProvider>
        <StatusBar style="dark" />
        <Navigator />
      </StoreProvider>
    </SafeAreaProvider>
  );
}

/**
 * Crash screen for any route. Reports a scrubbed error (name, first line of the message,
 * platform — never user content) so crashes show up in server logs, then offers recovery.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    void api("errors", {
      name: (error.name || "Error").slice(0, 60),
      message: (error.message || "").split("\n")[0].slice(0, 200),
      platform: Platform.OS,
    }).catch(() => undefined);
  }, [error]);
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 14, backgroundColor: color.canvas }}>
      <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: color.coralTint, alignItems: "center", justifyContent: "center" }}>
        <Icon name="alert-triangle" size={26} tint={color.coralText} />
      </View>
      <T v="title" style={{ textAlign: "center" }}>
        Something went sideways
      </T>
      <T v="body" tone={color.muted} style={{ textAlign: "center", maxWidth: 340 }}>
        That’s on us, not you. Your saved plans are safe. We’ve logged the problem.
      </T>
      <Button label="Try again" icon="refresh-cw" onPress={() => void retry()} />
    </View>
  );
}
