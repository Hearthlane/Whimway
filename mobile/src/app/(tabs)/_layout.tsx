import { Redirect, router } from "expo-router";
import { Tabs } from "expo-router/js-tabs";
import { View } from "react-native";
import { useStore } from "@/lib/store";
import { Icon, type IconName } from "@/ui/kit";
import { color, font, shadow } from "@/ui/theme";

function icon(name: IconName) {
  return function TabIcon({ color: c }: { color: unknown }) {
    return <Icon name={name} tint={c as string} size={22} />;
  };
}

export default function TabsLayout() {
  const { profile } = useStore();
  if (!profile.onboarded) return <Redirect href="/onboarding" />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color.ink,
        tabBarInactiveTintColor: color.muted,
        tabBarStyle: { backgroundColor: color.paper, borderTopColor: color.line, height: 68, paddingTop: 6, paddingBottom: 8 },
        tabBarLabelStyle: { fontFamily: font.bodyMedium, fontSize: 12 },
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
          tabBarIcon: () => (
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
