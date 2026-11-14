import { DMSans_400Regular, DMSans_500Medium, DMSans_700Bold } from "@expo-google-fonts/dm-sans";
import { Outfit_500Medium, Outfit_600SemiBold } from "@expo-google-fonts/outfit";
import { useFonts } from "expo-font";
import { Stack, type ErrorBoundaryProps } from "expo-router";
import { Platform, View , StyleSheet, useWindowDimensions } from "react-native";
import { api } from "@/lib/api";
import { Button, Icon, T , Spark } from "@/ui/kit";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import Animated, { FadeOut, ZoomIn } from "react-native-reanimated";
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
  // Launch moment: the spark lands, then the app is revealed beneath it.
  const [launching, setLaunching] = useState(true);
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => setLaunching(false), 900);
    return () => clearTimeout(t);
  }, [visible]);
  if (!visible) return null;
  return (
    <>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.canvas } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="onboarding" options={{ gestureEnabled: false, animation: "fade" }} />
        <Stack.Screen name="plan/[id]" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="import" options={{ animation: "slide_from_bottom" }} />
        <Stack.Screen name="plus" options={{ animation: "slide_from_bottom" }} />
      </Stack>
      {launching ? (
        <Animated.View exiting={FadeOut.duration(320)} style={[StyleSheet.absoluteFill, { backgroundColor: color.coral, alignItems: "center", justifyContent: "center" }]} pointerEvents="none">
          <Animated.View entering={ZoomIn.springify().damping(11)}>
            <Spark size={120} />
          </Animated.View>
        </Animated.View>
      ) : null}
    </>
  );
}

/** On a desktop browser, present the app at phone size in a device frame. */
function Frame({ children }: { children: React.ReactNode }) {
  const { width, height } = useWindowDimensions();
  if (Platform.OS !== "web" || width < 600) return <>{children}</>;
  const frameHeight = Math.min(880, height - 48);
  return (
    <View style={{ flex: 1, backgroundColor: "#E9E7DF", alignItems: "center", justifyContent: "center" }}>
      <View style={{ width: 412, height: frameHeight, borderRadius: 44, overflow: "hidden", backgroundColor: color.canvas, borderWidth: 10, borderColor: color.ink, shadowColor: color.ink, shadowOpacity: 0.25, shadowRadius: 40, shadowOffset: { width: 0, height: 24 } }}>{children}</View>
    </View>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StoreProvider>
        <StatusBar style="dark" />
        <Frame>
          <Navigator />
        </Frame>
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
