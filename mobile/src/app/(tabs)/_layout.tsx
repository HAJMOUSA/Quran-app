import { Tabs } from "expo-router";
import { t } from "../../i18n";

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" options={{ title: t("tab.mushaf") }} />
      <Tabs.Screen name="browse" options={{ title: t("tab.index") }} />
      <Tabs.Screen name="search" options={{ title: t("tab.search") }} />
      <Tabs.Screen name="settings" options={{ title: t("tab.settings") }} />
    </Tabs>
  );
}
