import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { ColorValue } from "react-native";
import { t } from "../../i18n";

type IconName = keyof typeof Ionicons.glyphMap;

// Each tab: [focused (filled), unfocused (outline)] — iOS-style weight shift so the
// active tab reads clearly without relying on colour alone.
const ICONS: Record<string, [IconName, IconName]> = {
  index: ["book", "book-outline"],          // Mushaf reader
  browse: ["list", "list-outline"],         // Surah index
  search: ["search", "search-outline"],     // Recite / text search
  memorize: ["school", "school-outline"],   // Memorization / review
  settings: ["settings", "settings-outline"],
};

const icon = (route: string) =>
  ({ focused, color, size }: { focused: boolean; color: ColorValue; size: number }) => {
    const [on, off] = ICONS[route];
    return <Ionicons name={focused ? on : off} size={size} color={color as string} />;
  };

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#1f6f43",   // app green
        tabBarInactiveTintColor: "#9aa0a6", // muted grey
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        tabBarItemStyle: { paddingVertical: 4 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t("tab.mushaf"), tabBarIcon: icon("index") }} />
      <Tabs.Screen name="browse" options={{ title: t("tab.index"), tabBarIcon: icon("browse") }} />
      <Tabs.Screen name="search" options={{ title: t("tab.search"), tabBarIcon: icon("search") }} />
      <Tabs.Screen name="memorize" options={{ title: t("tab.memorize"), tabBarIcon: icon("memorize") }} />
      <Tabs.Screen name="settings" options={{ title: t("tab.settings"), tabBarIcon: icon("settings") }} />
    </Tabs>
  );
}
