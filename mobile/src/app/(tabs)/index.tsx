import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import BottomSheet from "@gorhom/bottom-sheet";
import { PagePager, type PagePagerHandle } from "../../components/PagePager";
import { AyahSheet } from "../../components/AyahSheet";
import { PlayerBar } from "../../components/PlayerBar";
import { FollowBar } from "../../components/FollowBar";
import { usePlayback } from "../../audio/usePlayback";
import { useFollowAlong } from "../../audio/useFollowAlong";
import { getPageWordIds } from "../../db/quranDb";
import { gradeFromRatio } from "../../memorize/srs";
import { useUserStore } from "../../store/userStore";
import { t } from "../../i18n";

export default function MushafScreen() {
  const lastPage = useUserStore((s) => s.lastPage);
  const setLastPage = useUserStore((s) => s.setLastPage);
  const reciterId = useUserStore((s) => s.settings.reciterId);
  const serverUrl = useUserStore((s) => s.settings.serverUrl);
  const pendingJump = useUserStore((s) => s.pendingJump);
  const clearPendingJump = useUserStore((s) => s.clearPendingJump);
  const memorizeSession = useUserStore((s) => s.memorizeSession);
  const endMemorize = useUserStore((s) => s.endMemorize);
  const gradePage = useUserStore((s) => s.gradePage);
  const [selected, setSelected] = useState<string | null>(null);
  const pagerRef = useRef<PagePagerHandle>(null);
  const sheetRef = useRef<BottomSheet>(null);
  const pageWordIds = useRef<number[]>([]);

  const onPage = useCallback((page: number) => {
    pagerRef.current?.scrollToPage(page);
    setLastPage(page);
  }, [setLastPage]);

  const playback = usePlayback(reciterId, onPage);
  // In a memorize session the page is fixed, so don't auto-turn on tracking.
  const follow = useFollowAlong(serverUrl, memorizeSession == null ? onPage : undefined);

  const onSelectAyah = (k: string) => { setSelected(k); sheetRef.current?.expand(); };
  const onPlay = (k: string) => { sheetRef.current?.close(); playback.playFromVerse(k); };

  useEffect(() => {
    if (pendingJump != null) {
      pagerRef.current?.scrollToPage(pendingJump);
      clearPendingJump();
    }
  }, [pendingJump, clearPendingJump]);

  // Entering a memorize session: load the page's words (for grading) and start
  // follow-along so hidden words reveal as they're recited.
  const started = useRef<number | null>(null);
  useEffect(() => {
    if (memorizeSession != null && started.current !== memorizeSession) {
      started.current = memorizeSession;
      getPageWordIds(memorizeSession).then((ids) => { pageWordIds.current = ids; }).catch(() => {});
      follow.start();
    }
    if (memorizeSession == null) started.current = null;
  }, [memorizeSession, follow]);

  const finishMemorize = () => {
    const page = memorizeSession;
    if (page == null) return;
    const ids = pageWordIds.current;
    const statuses = follow.state.wordStatuses;
    const correct = ids.filter((id) => statuses[id] === "correct").length;
    const ratio = ids.length ? correct / ids.length : 0;
    follow.stop();
    gradePage(page, gradeFromRatio(ratio));
    endMemorize();
    Alert.alert(`${t("memorize.page")} ${page}`, `${t("memorize.result")}: ${Math.round(ratio * 100)}%`);
  };

  const inMemorize = memorizeSession != null;
  const activeWordId = follow.active ? follow.state.currentWordId : playback.state.activeWordId;
  const playingVerseKey = follow.active ? follow.state.currentVerseKey : playback.state.activeVerseKey;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
      {!inMemorize && <FollowBar state={follow.state} onStop={follow.stop} />}
      <PagePager
        ref={pagerRef}
        initialPage={lastPage}
        selectedVerseKey={selected}
        onSelectAyah={onSelectAyah}
        onPageChange={setLastPage}
        activeWordId={activeWordId}
        playingVerseKey={playingVerseKey}
        wordStatuses={follow.active ? follow.state.wordStatuses : undefined}
        hidden={inMemorize}
      />

      {inMemorize && (
        <View style={styles.memoBar}>
          <Text style={styles.memoHint} numberOfLines={2}>{t("memorize.recallHint")}</Text>
          <Pressable onPress={finishMemorize} style={styles.memoFinish} testID="memorize-finish">
            <Text style={styles.memoFinishText}>{t("memorize.finish")}</Text>
          </Pressable>
        </View>
      )}

      {!inMemorize && !follow.active && (
        <PlayerBar
          state={playback.state}
          onToggle={playback.toggle}
          onStop={playback.stop}
          onToggleRepeat={() => playback.setRepeatAyah(!playback.state.repeatAyah)}
        />
      )}
      {!inMemorize && !follow.active && playback.state.surah == null && (
        <Pressable style={styles.fab} onPress={() => follow.start()} testID="follow-start">
          <Text style={styles.fabText}>🎧 {t("follow.start")}</Text>
        </Pressable>
      )}
      <AyahSheet ref={sheetRef} verseKey={selected} onPlay={onPlay} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute", right: 16, bottom: 20,
    backgroundColor: "#1f6f43", borderRadius: 24, paddingHorizontal: 18, paddingVertical: 12,
    elevation: 4, shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
  },
  fabText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  memoBar: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: "#243b55" },
  memoHint: { flex: 1, color: "#dfe8f5", fontSize: 13 },
  memoFinish: { backgroundColor: "#1f6f43", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 },
  memoFinishText: { color: "#fff", fontWeight: "600" },
});
