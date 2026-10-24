import { useEffect, useState } from "react";
import { FlatList, Pressable, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { getSurahs } from "../../db/quranDb";
import { useUserStore } from "../../store/userStore";
import type { SurahRow } from "../../db/schema";

export default function BrowseScreen() {
  const [surahs, setSurahs] = useState<SurahRow[]>([]);
  const requestJump = useUserStore((s) => s.requestJump);
  useEffect(() => { getSurahs().then(setSurahs); }, []);
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <FlatList
        data={surahs}
        keyExtractor={(s) => String(s.id)}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => { requestJump(item.first_page); router.navigate("/(tabs)"); }}
            style={{ padding: 16, borderBottomWidth: 1, borderColor: "#eee" }}
          >
            <Text style={{ fontSize: 18, textAlign: "right" }}>
              {item.id}. {item.name_arabic} — {item.name_simple}
            </Text>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}
