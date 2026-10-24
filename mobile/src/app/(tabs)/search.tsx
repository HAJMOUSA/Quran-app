import { useState } from "react";
import { FlatList, Pressable, Text, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { search } from "../../db/quranDb";
import { useUserStore } from "../../store/userStore";
import { t } from "../../i18n";
import type { SearchHit } from "../../db/schema";

export default function SearchScreen() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const requestJump = useUserStore((s) => s.requestJump);
  const run = async (text: string) => {
    setQ(text);
    if (!text.trim()) { setHits([]); return; }
    try { setHits(await search(text)); } catch (e) { console.warn("search failed", e); setHits([]); }
  };
  return (
    <SafeAreaView style={{ flex: 1, padding: 12 }}>
      <TextInput
        value={q}
        onChangeText={run}
        placeholder={t("search.placeholder")}
        style={{ borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 12, textAlign: "right", fontSize: 16 }}
      />
      <FlatList
        data={hits}
        keyExtractor={(h) => h.verse_key}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <Pressable
            onPress={() => { requestJump(item.page); router.navigate("/(tabs)"); }}
            style={{ paddingVertical: 12, borderBottomWidth: 1, borderColor: "#eee" }}
          >
            <Text style={{ color: "#888" }}>{item.verse_key} · p.{item.page}</Text>
            <Text numberOfLines={2}>{item.translation_en}</Text>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}
