import { memo, useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { groupWordsByLine } from "../db/quranDb";
import type { WordRow } from "../db/schema";

type WordStatus = "correct" | "wrong" | "missed";

interface Props {
  words: WordRow[];
  fontFamily: string;
  selectedVerseKey: string | null;
  onSelectAyah: (verseKey: string) => void;
  activeWordId?: number | null;      // word currently being recited (playback / follow-along)
  playingVerseKey?: string | null;   // ayah currently being recited
  wordStatuses?: Record<number, WordStatus>;  // follow-along: by word_id
}

export const MushafPage = memo(function MushafPage({
  words, fontFamily, selectedVerseKey, onSelectAyah,
  activeWordId = null, playingVerseKey = null, wordStatuses,
}: Props) {
  const lines = useMemo(() => groupWordsByLine(words), [words]);
  return (
    <View style={styles.page}>
      {lines.map((line) => (
        <View key={line.line} style={styles.line}>
          {line.words.map((word) => {
            const status = wordStatuses?.[word.id];
            return (
              <Pressable key={word.id} testID={`word-${word.id}`} hitSlop={4} onPress={() => onSelectAyah(word.verse_key)}>
                <Text
                  style={[
                    styles.word,
                    { fontFamily },
                    word.verse_key === selectedVerseKey && styles.selected,
                    word.verse_key === playingVerseKey && styles.playingAyah,
                    status === "correct" && styles.correctWord,
                    status === "missed" && styles.missedWord,
                    status === "wrong" && styles.wrongWord,
                    word.id === activeWordId && styles.activeWord,
                  ]}
                >
                  {word.code_v2 ?? ""}
                </Text>
              </Pressable>
            );
          })}
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
  playingAyah: { backgroundColor: "#eaf5ea" },
  activeWord: { backgroundColor: "#8ddf8d", color: "#06310a" },
  correctWord: { color: "#1f6f43" },                       // recited correctly
  missedWord: { backgroundColor: "#ffe08a" },              // skipped
  wrongWord: { backgroundColor: "#f6b1ab", color: "#7a1008" }, // said something different
});
