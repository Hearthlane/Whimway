import { Redirect } from "expo-router";
import { Tabs } from "expo-router/js-tabs";
import { useStore } from "@/lib/store";
import { Icon } from "@/ui/kit";
import { color, font } from "@/ui/theme";

export default function TabsLayout() {
  const { profile } = useStore();
  if (!profile.onboarded) return <Redirect href="/onboarding" />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color.ink,
        tabBarInactiveTintColor: color.faint,
        tabBarStyle: { backgroundColor: color.paper, borderTopColor: color.line, height: 64, paddingTop: 6 },
        tabBarLabelStyle: { fontFamily: font.bodyMedium, fontSize: 12 },
        sceneStyle: { backgroundColor: color.canvas },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Plan", tabBarIcon: ({ color: c }) => <Icon name="star" tint={c as string} size={20} /> }} />
      <Tabs.Screen name="saved" options={{ title: "Saved", tabBarIcon: ({ color: c }) => <Icon name="bookmark" tint={c as string} size={20} /> }} />
      <Tabs.Screen name="profile" options={{ title: "You", tabBarIcon: ({ color: c }) => <Icon name="user" tint={c as string} size={20} /> }} />
    </Tabs>
  );
}
