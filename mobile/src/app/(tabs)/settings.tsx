import { useEffect, useState } from "react";
import { FlatList, Pressable, Switch, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useUserStore } from "../../store/userStore";
import { getVerse } from "../../db/quranDb";
import { getReciters, type Reciter } from "../../audio/recitations";
import { t } from "../../i18n";

export default function SettingsScreen() {
  const settings = useUserStore((s) => s.settings);
  const setSettings = useUserStore((s) => s.setSettings);
  const bookmarks = useUserStore((s) => s.bookmarks);
  const requestJump = useUserStore((s) => s.requestJump);
  const [pages, setPages] = useState<Record<string, number>>({});
  const [reciters, setReciters] = useState<Reciter[]>([]);
  const [pickingReciter, setPickingReciter] = useState(false);
  useEffect(() => {
    Promise.all(bookmarks.map((b) => getVerse(b.verseKey))).then((vs) =>
      setPages(Object.fromEntries(vs.filter((v): v is NonNullable<typeof v> => !!v).map((v) => [v.verse_key, v.page]))))
      .catch((e) => console.warn("bookmark pages failed", e));
  }, [bookmarks]);
  useEffect(() => { getReciters().then(setReciters).catch((e) => console.warn("reciters failed", e)); }, []);
  const currentReciter = reciters.find((r) => r.id === settings.reciterId);
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
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 12 }}>
        <Text style={{ fontSize: 16 }}>{t("settings.reciter")}</Text>
        <Pressable onPress={() => setPickingReciter((v) => !v)}>
          <Text style={{ fontSize: 16, color: "#007aff" }} numberOfLines={1}>
            {currentReciter ? currentReciter.name : `#${settings.reciterId}`} ▾
          </Text>
        </Pressable>
      </View>
      {pickingReciter && (
        <View style={{ maxHeight: 220, borderWidth: 1, borderColor: "#eee", borderRadius: 8 }}>
          <FlatList
            data={reciters}
            keyExtractor={(r) => String(r.id)}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => { setSettings({ reciterId: item.id }); setPickingReciter(false); }}
                style={{ padding: 12, borderBottomWidth: 1, borderColor: "#f2f2f2" }}
              >
                <Text style={{ fontSize: 15, color: item.id === settings.reciterId ? "#1f6f43" : "#111" }}>
                  {item.id === settings.reciterId ? "✓ " : ""}{item.name}{item.style ? ` · ${item.style}` : ""}
                </Text>
              </Pressable>
            )}
          />
        </View>
      )}
      <View style={{ paddingVertical: 12 }}>
        <Text style={{ fontSize: 16, marginBottom: 6 }}>{t("settings.server")}</Text>
        <TextInput
          value={settings.serverUrl}
          onChangeText={(v) => setSettings({ serverUrl: v.trim() })}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="http://localhost:8000"
          style={{ borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 10, fontSize: 14 }}
        />
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 12 }}>
        <Text style={{ fontSize: 16, flex: 1, paddingRight: 12 }}>{t("settings.offline")}</Text>
        <Switch
          value={settings.offlineFollow}
          onValueChange={(on) => setSettings({ offlineFollow: on })}
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
