import { DMSans_400Regular, DMSans_500Medium, DMSans_700Bold } from "@expo-google-fonts/dm-sans";
import { Outfit_500Medium, Outfit_600SemiBold } from "@expo-google-fonts/outfit";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
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
