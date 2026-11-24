import { BricolageGrotesque_600SemiBold, BricolageGrotesque_700Bold } from "@expo-google-fonts/bricolage-grotesque";
import { InstrumentSans_400Regular, InstrumentSans_500Medium, InstrumentSans_600SemiBold } from "@expo-google-fonts/instrument-sans";
import { useFonts } from "expo-font";
import { router, Stack, type ErrorBoundaryProps } from "expo-router";
import { Platform, View , StyleSheet, useWindowDimensions } from "react-native";
import { api } from "@/lib/api";
import { Button, Icon, T , Spark } from "@/ui/kit";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import Animated, { FadeOut, ZoomIn } from "react-native-reanimated";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StoreProvider, useStore } from "@/lib/store";
import { allowReminders, onReminderOpened, syncReminders } from "@/lib/reminders";
import { endOf } from "@shared/today";
import { DateTime } from "luxon";
import { color } from "@/ui/theme";

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

// Web: a clear keyboard focus ring that follows each control's shape, and visible
// scrollbars on horizontal rows so they can be scrolled with a mouse.
if (Platform.OS === "web" && typeof document !== "undefined" && !document.getElementById("whimway-focus")) {
  const css = document.createElement("style");
  css.id = "whimway-focus";
  css.textContent = `
    [tabindex]:focus-visible, a:focus-visible, button:focus-visible, input:focus-visible, textarea:focus-visible {
      outline: 2px solid ${color.ink} !important; outline-offset: 2px; box-shadow: 0 0 0 4px ${color.paper};
    }
    @media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; } }
  `;
  document.head.appendChild(css);
}

function Navigator() {
  const { ready, track, plans, profile } = useStore();
  // Phone reminders follow the saved plans; opening one opens its plan.
  useEffect(() => {
    if (!ready) return;
    const wanted = (profile.remindDayOf || profile.remindRate) && Object.values(plans).some((p) => p.saved && endOf(p) > DateTime.now());
    void (async () => {
      if (wanted) await allowReminders();
      await syncReminders(plans, profile);
    })().catch(() => undefined);
  }, [ready, plans, profile]);
  useEffect(() => onReminderOpened((url) => router.push(url as never)), []);
  const [fontsLoaded] = useFonts({ InstrumentSans_400Regular, InstrumentSans_500Medium, InstrumentSans_600SemiBold, BricolageGrotesque_600SemiBold, BricolageGrotesque_700Bold });
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
        <Stack.Screen name="settings" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="create" options={{ animation: "slide_from_bottom", presentation: "modal" }} />
        <Stack.Screen name="activity" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="history" options={{ animation: "slide_from_right" }} />
      </Stack>
      {launching ? (
        <Animated.View exiting={FadeOut.duration(240)} style={[StyleSheet.absoluteFill, { backgroundColor: color.coral, alignItems: "center", justifyContent: "center" }]} pointerEvents="none">
          <Animated.View entering={ZoomIn.springify().damping(11)}>
            <Spark size={120} />
          </Animated.View>
        </Animated.View>
      ) : null}
    </>
  );
}

/**
 * The page's main landmark. On a wide browser the app sits in a centred column at full height
 * (no fake phone bezel); on phones it fills the screen.
 */
function Frame({ children }: { children: React.ReactNode }) {
  const { width } = useWindowDimensions();
  if (Platform.OS !== "web") return <>{children}</>;
  if (width < 600) return <View role="main" style={{ flex: 1 }}>{children}</View>;
  return (
    <View style={{ flex: 1, backgroundColor: "#E9EBF2", alignItems: "center" }}>
      <View role="main" style={{ flex: 1, width: Math.min(560, width), backgroundColor: color.canvas, borderLeftWidth: 1, borderRightWidth: 1, borderColor: color.line }}>{children}</View>
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
