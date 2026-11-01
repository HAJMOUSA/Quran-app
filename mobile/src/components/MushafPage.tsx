import { memo, useCallback, useMemo, useState } from "react";
import { Dimensions, LayoutChangeEvent, Pressable, StyleSheet, Text, View } from "react-native";
import { groupWordsByLine, type MushafLine } from "../db/quranDb";
import type { WordRow } from "../db/schema";

type WordStatus = "correct" | "wrong" | "missed";

// Reading margin on each side; lines are scaled to fit the remaining width so no
// word runs off the edge into the next/previous page.
const H_PADDING = 18;
const AVAILABLE = Dimensions.get("window").width - 2 * H_PADDING;

interface Props {
  words: WordRow[];
  fontFamily: string;
  selectedVerseKey: string | null;
  onSelectAyah: (verseKey: string) => void;
  activeWordId?: number | null;      // word currently being recited (playback / follow-along)
  playingVerseKey?: string | null;   // ayah currently being recited
  wordStatuses?: Record<number, WordStatus>;  // follow-along: by word_id
  hidden?: boolean;                  // memorization: mask words until recited/revealed
}

interface LineProps {
  line: MushafLine;
  fontFamily: string;
  selectedVerseKey: string | null;
  onSelectAyah: (verseKey: string) => void;
  activeWordId: number | null;
  playingVerseKey: string | null;
  wordStatuses?: Record<number, WordStatus>;
  hidden: boolean;
}

function MushafLineView({
  line, fontFamily, selectedVerseKey, onSelectAyah, activeWordId, playingVerseKey, wordStatuses, hidden,
}: LineProps) {
  // Shrink a too-wide line to fit the reading area (transforms don't affect
  // layout, so onLayout always reports the line's natural width).
  const [scale, setScale] = useState(1);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setScale(AVAILABLE > 0 && w > AVAILABLE ? AVAILABLE / w : 1);
  }, []);
  return (
    <View style={styles.lineClip}>
      <View style={[styles.line, { transform: [{ scaleX: scale }] }]} onLayout={onLayout}>
        {line.words.map((word) => {
          const status = wordStatuses?.[word.id];
          // Ayah-end markers (numbers) always stay visible so the page still reads;
          // only actual words are masked until recited.
          const masked = hidden && !status && word.char_type === "word";
          return (
            <Pressable key={word.id} testID={`word-${word.id}`} hitSlop={4} onPress={() => onSelectAyah(word.verse_key)}>
              <Text
                style={[
                  styles.word,
                  { fontFamily },
                  masked && styles.masked,
                  !masked && word.verse_key === selectedVerseKey && styles.selected,
                  !masked && word.verse_key === playingVerseKey && styles.playingAyah,
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
    </View>
  );
}

export const MushafPage = memo(function MushafPage({
  words, fontFamily, selectedVerseKey, onSelectAyah,
  activeWordId = null, playingVerseKey = null, wordStatuses, hidden = false,
}: Props) {
  const lines = useMemo(() => groupWordsByLine(words), [words]);
  return (
    <View style={styles.page}>
      {lines.map((line) => (
        <MushafLineView
          key={line.line}
          line={line}
          fontFamily={fontFamily}
          selectedVerseKey={selectedVerseKey}
          onSelectAyah={onSelectAyah}
          activeWordId={activeWordId}
          playingVerseKey={playingVerseKey}
          wordStatuses={wordStatuses}
          hidden={hidden}
        />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  page: { flex: 1, paddingHorizontal: H_PADDING, paddingVertical: 20, justifyContent: "space-evenly", overflow: "hidden" },
  lineClip: { width: AVAILABLE, alignItems: "center", overflow: "hidden" },
  // Pin RTL explicitly: the app forces app-wide RTL (I18nManager.forceRTL) and
  // Yoga flips `row`/`row-reverse` under RTL, so relying on `row-reverse` renders
  // words left-to-right. `direction: "rtl"` + `row` is deterministic regardless
  // of the global isRTL state — words (sorted first-word-first) flow right-to-left.
  line: { flexDirection: "row", direction: "rtl", flexWrap: "nowrap", alignItems: "center" },
  word: { fontSize: 28, color: "#111", lineHeight: 46 },
  masked: { color: "transparent", backgroundColor: "#c7ced6", borderRadius: 5 }, // hidden-text placeholder
  selected: { backgroundColor: "#fdf0c8" },
  playingAyah: { backgroundColor: "#eaf5ea" },
  activeWord: { backgroundColor: "#8ddf8d", color: "#06310a" },
  correctWord: { color: "#1f6f43" },                       // recited correctly
  missedWord: { backgroundColor: "#ffe08a" },              // skipped
  wrongWord: { backgroundColor: "#f6b1ab", color: "#7a1008" }, // said something different
});
