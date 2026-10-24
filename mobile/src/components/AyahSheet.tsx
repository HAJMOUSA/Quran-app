import { forwardRef, useEffect, useState } from "react";
import { Pressable, Share, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import BottomSheet, { BottomSheetView } from "@gorhom/bottom-sheet";
import { getVerse } from "../db/quranDb";
import { useUserStore } from "../store/userStore";
import { t } from "../i18n";
import type { VerseRow } from "../db/schema";

export const AyahSheet = forwardRef<BottomSheet, { verseKey: string | null }>(
  function AyahSheet({ verseKey }, ref) {
    const [verse, setVerse] = useState<VerseRow | null>(null);
    const bookmarks = useUserStore((s) => s.bookmarks);
    const toggleBookmark = useUserStore((s) => s.toggleBookmark);
    useEffect(() => { if (verseKey) getVerse(verseKey).then(setVerse); }, [verseKey]);
    const bookmarked = !!verseKey && bookmarks.some((b) => b.verseKey === verseKey);
    return (
      <BottomSheet ref={ref} index={-1} snapPoints={["35%"]} enablePanDownToClose>
        <BottomSheetView style={{ padding: 20 }}>
          {verse && (
            <>
              <Text style={{ fontSize: 14, color: "#888" }}>{verse.verse_key}</Text>
              <Text style={{ fontSize: 26, textAlign: "right", marginVertical: 8 }}>{verse.text_uthmani}</Text>
              <Text style={{ fontSize: 16, color: "#333" }}>{verse.translation_en}</Text>
              <View style={{ flexDirection: "row", gap: 24, marginTop: 16 }}>
                <Pressable onPress={() => toggleBookmark(verse.verse_key)}>
                  <Text style={{ color: bookmarked ? "#c08a00" : "#007aff" }}>
                    {bookmarked ? "★ " : "☆ "}{t("sheet.bookmark")}
                  </Text>
                </Pressable>
                <Pressable onPress={() => Clipboard.setStringAsync(`${verse.text_uthmani}\n${verse.translation_en ?? ""}`)}>
                  <Text style={{ color: "#007aff" }}>{t("sheet.copy")}</Text>
                </Pressable>
                <Pressable onPress={() => Share.share({ message: `${verse.text_uthmani} (${verse.verse_key})` })}>
                  <Text style={{ color: "#007aff" }}>{t("sheet.share")}</Text>
                </Pressable>
              </View>
            </>
          )}
        </BottomSheetView>
      </BottomSheet>
    );
  },
);
