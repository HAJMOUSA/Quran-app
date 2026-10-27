import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { ActivityIndicator, Dimensions, FlatList, Text, View } from "react-native";
import { useEffect, useState } from "react";
import { MushafPage } from "./MushafPage";
import { getPageWords } from "../db/quranDb";
import { ensurePageFont } from "../fonts/pageFont";
import type { WordRow } from "../db/schema";

const { width } = Dimensions.get("window");
const PAGES = 604;

function PageHost({ page, selectedVerseKey, onSelectAyah, activeWordId, playingVerseKey, wordStatuses, hidden }: {
  page: number; selectedVerseKey: string | null; onSelectAyah: (k: string) => void;
  activeWordId: number | null; playingVerseKey: string | null;
  wordStatuses?: Record<number, "correct" | "wrong" | "missed">; hidden?: boolean;
}) {
  const [data, setData] = useState<{ words: WordRow[]; family: string } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [words, family] = await Promise.all([getPageWords(page), ensurePageFont(page)]);
        if (alive) setData({ words, family });
      } catch (e) {
        if (alive) { console.warn("page load failed", page, e); setFailed(true); }
      }
    })();
    return () => { alive = false; };
  }, [page]);
  if (!data) return (
    <View style={{ width, flex: 1, justifyContent: "center", alignItems: "center" }}>
      {failed ? <Text>Couldn't load this page</Text> : <ActivityIndicator />}
    </View>
  );
  return (
    <View style={{ width }}>
      <MushafPage words={data.words} fontFamily={data.family}
        selectedVerseKey={selectedVerseKey} onSelectAyah={onSelectAyah}
        activeWordId={activeWordId} playingVerseKey={playingVerseKey} wordStatuses={wordStatuses} hidden={hidden} />
    </View>
  );
}

export interface PagePagerHandle { scrollToPage: (page: number) => void; }

interface Props {
  initialPage: number; selectedVerseKey: string | null;
  onSelectAyah: (k: string) => void; onPageChange: (page: number) => void;
  activeWordId?: number | null; playingVerseKey?: string | null;
  wordStatuses?: Record<number, "correct" | "wrong" | "missed">;
  hidden?: boolean;
}

export const PagePager = forwardRef<PagePagerHandle, Props>(function PagePager(
  { initialPage, selectedVerseKey, onSelectAyah, onPageChange, activeWordId = null, playingVerseKey = null, wordStatuses, hidden },
  ref,
) {
  // RTL: page 1 is the rightmost. With `inverted`, list index 0 renders on the right,
  // so index = PAGES - page maps page 1 -> rightmost and increases leftward.
  const toIndex = (page: number) => PAGES - page;
  const listRef = useRef<FlatList>(null);
  useImperativeHandle(ref, () => ({
    scrollToPage: (page: number) => {
      listRef.current?.scrollToIndex({ index: PAGES - page, animated: false });
    },
  }), []);
  const renderItem = useCallback(({ index }: { index: number }) => (
    <PageHost page={PAGES - index} selectedVerseKey={selectedVerseKey} onSelectAyah={onSelectAyah}
      activeWordId={activeWordId} playingVerseKey={playingVerseKey} wordStatuses={wordStatuses} hidden={hidden} />
  ), [selectedVerseKey, onSelectAyah, activeWordId, playingVerseKey, wordStatuses, hidden]);
  return (
    <FlatList
      ref={listRef}
      horizontal
      pagingEnabled
      inverted
      initialScrollIndex={toIndex(initialPage)}
      getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
      data={Array.from({ length: PAGES })}
      keyExtractor={(_, i) => String(PAGES - i)}
      renderItem={renderItem}
      showsHorizontalScrollIndicator={false}
      onMomentumScrollEnd={(e) => {
        const index = Math.round(e.nativeEvent.contentOffset.x / width);
        onPageChange(PAGES - index);
      }}
      windowSize={3}
    />
  );
});
