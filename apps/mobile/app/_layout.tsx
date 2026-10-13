import React, { useEffect } from "react";
import { Platform } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { Stack, router } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import { Outfit_600SemiBold } from "@expo-google-fonts/outfit/600SemiBold";
import { DMSans_400Regular } from "@expo-google-fonts/dm-sans/400Regular";
import { DMSans_600SemiBold } from "@expo-google-fonts/dm-sans/600SemiBold";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import { initializeNotifications } from "../src/services/notifications";
import { AppProvider } from "../src/state/AppState";
import { colors } from "../src/design/theme";
import { ErrorBoundary } from "../src/components/ErrorBoundary";
void SplashScreen.preventAutoHideAsync().catch(() => {});
export default function Layout() {
  const reduced = useReducedMotion();
  const [loaded, error] = useFonts({
    Outfit: Outfit_600SemiBold,
    DMSans: DMSans_400Regular,
    DMSansMedium: DMSans_600SemiBold,
  });
  useEffect(() => {
    if (loaded || error) void SplashScreen.hideAsync();
  }, [loaded, error]);
  useEffect(() => {
    if (Platform.OS === "web" || (!loaded && !error)) return;
    initializeNotifications();
    const open = (response: Notifications.NotificationResponse) => {
      const id = response.notification.request.content.data?.planId;
      if (typeof id === "string" && /^[a-f0-9-]{36}$/.test(id)) {
        router.push("/plan/" + id);
        Notifications.clearLastNotificationResponse();
      }
    };
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    try {
      const response = Notifications.getLastNotificationResponse();
      if (response) open(response);
    } catch {}
    return () => sub.remove();
  }, [loaded, error]);
  if (!loaded && !error) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ErrorBoundary>
          <AppProvider>
            <StatusBar style="dark" />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.paper },
                animation: reduced ? "none" : "slide_from_right",
              }}
            >
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="planner" />
              <Stack.Screen
                name="generating"
                options={{ gestureEnabled: false }}
              />
              <Stack.Screen name="plan/[id]" />
              <Stack.Screen name="day/[id]" />
              <Stack.Screen name="auth/callback" />
            </Stack>
          </AppProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
