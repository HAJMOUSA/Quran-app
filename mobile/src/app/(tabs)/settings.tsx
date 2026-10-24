import { useEffect, useState } from "react";
import { FlatList, Pressable, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useUserStore } from "../../store/userStore";
import { getVerse } from "../../db/quranDb";
import { t } from "../../i18n";

export default function SettingsScreen() {
  const settings = useUserStore((s) => s.settings);
  const setSettings = useUserStore((s) => s.setSettings);
  const bookmarks = useUserStore((s) => s.bookmarks);
  const requestJump = useUserStore((s) => s.requestJump);
  const [pages, setPages] = useState<Record<string, number>>({});
  useEffect(() => {
    Promise.all(bookmarks.map((b) => getVerse(b.verseKey))).then((vs) =>
      setPages(Object.fromEntries(vs.filter((v): v is NonNullable<typeof v> => !!v).map((v) => [v.verse_key, v.page]))));
  }, [bookmarks]);
  return (
    <SafeAreaView style={{ flex: 1, padding: 16 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 12 }}>
        <Text style={{ fontSize: 16 }}>{t("settings.language")}</Text>
        <Pressable onPress={() => setSettings({ language: settings.language === "ar" ? "en" : "ar" })}>
          <Text style={{ fontSize: 16, color: "#007aff" }}>{settings.language.toUpperCase()}</Text>
        </Pressable>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 12 }}>
        <Text style={{ fontSize: 16 }}>{t("settings.theme")} (dark)</Text>
        <Switch
          value={settings.theme === "dark"}
          onValueChange={(on) => setSettings({ theme: on ? "dark" : "light" })}
        />
      </View>
      <Text style={{ fontSize: 18, marginTop: 20, marginBottom: 8 }}>★</Text>
      <FlatList
        data={bookmarks}
        keyExtractor={(b) => b.verseKey}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => { const p = pages[item.verseKey]; if (p) { requestJump(p); router.navigate("/(tabs)"); } }}
            style={{ paddingVertical: 10 }}
          >
            <Text style={{ fontSize: 16 }}>{item.verseKey}</Text>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}
