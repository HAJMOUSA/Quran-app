import { memo, useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { groupWordsByLine } from "../db/quranDb";
import type { WordRow } from "../db/schema";

interface Props {
  words: WordRow[];
  fontFamily: string;
  selectedVerseKey: string | null;
  onSelectAyah: (verseKey: string) => void;
}

export const MushafPage = memo(function MushafPage({ words, fontFamily, selectedVerseKey, onSelectAyah }: Props) {
  const lines = useMemo(() => groupWordsByLine(words), [words]);
  return (
    <View style={styles.page}>
      {lines.map((line) => (
        <View key={line.line} style={styles.line}>
          {line.words.map((word) => (
            <Pressable key={word.id} testID={`word-${word.id}`} hitSlop={4} onPress={() => onSelectAyah(word.verse_key)}>
              <Text
                style={[
                  styles.word,
                  { fontFamily },
                  word.verse_key === selectedVerseKey && styles.selected,
                ]}
              >
                {word.code_v2 ?? ""}
              </Text>
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  page: { flex: 1, paddingHorizontal: 12, paddingVertical: 20, justifyContent: "space-evenly" },
  line: { flexDirection: "row-reverse", flexWrap: "nowrap", justifyContent: "center", alignItems: "center" },
  word: { fontSize: 28, color: "#111", lineHeight: 46 },
  selected: { backgroundColor: "#fdf0c8" },
});
