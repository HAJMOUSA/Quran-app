import { useEffect } from "react";
import { I18nManager } from "react-native";
import { Stack } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useUserStore } from "../store/userStore";
import { setLanguage } from "../i18n";

export default function RootLayout() {
  const language = useUserStore((s) => s.settings.language);
  useEffect(() => {
    setLanguage(language);
    if (!I18nManager.isRTL) {
      I18nManager.allowRTL(true);
      I18nManager.forceRTL(true);
    }
  }, [language]);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }} />
    </GestureHandlerRootView>
  );
}
