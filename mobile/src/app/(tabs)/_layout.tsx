import { Redirect, router } from "expo-router";
import { Tabs } from "expo-router/js-tabs";
import { View } from "react-native";
import { useStore } from "@/lib/store";
import { useWide } from "@/ui/layout";
import { Icon, type IconName } from "@/ui/kit";
import { color, font, shadow } from "@/ui/theme";

function icon(name: IconName) {
  return function TabIcon({ color: c }: { color: unknown }) {
    return <Icon name={name} tint={c as string} size={22} />;
  };
}

export default function TabsLayout() {
  const { profile } = useStore();
  const wide = useWide();
  if (!profile.onboarded) return <Redirect href="/onboarding" />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color.ink,
        tabBarInactiveTintColor: color.muted,
        // Phones: a bottom tab bar. Computers: the same tabs as a left sidebar.
        tabBarPosition: wide ? "left" : "bottom",
        tabBarVariant: wide ? "material" : "uikit",
        tabBarLabelPosition: wide ? "beside-icon" : "below-icon",
        tabBarStyle: wide
          ? { backgroundColor: color.paper, borderRightColor: color.line, width: 232, paddingTop: 24, paddingHorizontal: 8 }
          : { backgroundColor: color.paper, borderTopColor: color.line, height: 68, paddingTop: 6, paddingBottom: 8 },
        tabBarItemStyle: wide ? { justifyContent: "flex-start", minHeight: 52, borderRadius: 14, paddingHorizontal: 12 } : undefined,
        tabBarActiveBackgroundColor: wide ? color.canvas : undefined,
        tabBarLabelStyle: { fontFamily: font.bodyMedium, fontSize: wide ? 16 : 13 },
        sceneStyle: { backgroundColor: color.canvas },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: icon("home") }} />
      <Tabs.Screen name="discover" options={{ title: "Explore", tabBarIcon: icon("search") }} />
      <Tabs.Screen
        name="new"
        options={{
          title: "Plan",
          tabBarAccessibilityLabel: "Make a plan",
          tabBarButtonTestID: "tab-plan",
          tabBarIcon: () =>
            wide ? (
              <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: color.coral, alignItems: "center", justifyContent: "center" }}>
                <Icon name="plus" size={18} tint={color.ink} />
              </View>
            ) : (
              <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: color.coral, alignItems: "center", justifyContent: "center", marginTop: -14, borderWidth: 3, borderColor: color.paper, ...shadow.card }}>
                <Icon name="plus" size={24} tint={color.ink} />
              </View>
            ),
        }}
        // Tabs are places; making a plan is an action, so it opens a sheet over the current tab.
        listeners={{
          tabPress: (e) => {
            e.preventDefault();
            router.push("/create");
          },
        }}
      />
      <Tabs.Screen name="saved" options={{ title: "Saved", tabBarIcon: icon("bookmark") }} />
      <Tabs.Screen name="profile" options={{ title: "You", tabBarIcon: icon("user") }} />
    </Tabs>
  );
}
