import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import BottomSheet from "@gorhom/bottom-sheet";
import { PagePager, type PagePagerHandle } from "../../components/PagePager";
import { AyahSheet } from "../../components/AyahSheet";
import { PlayerBar } from "../../components/PlayerBar";
import { FollowBar } from "../../components/FollowBar";
import { usePlayback } from "../../audio/usePlayback";
import { useFollowAlong } from "../../audio/useFollowAlong";
import { useUserStore } from "../../store/userStore";
import { t } from "../../i18n";

export default function MushafScreen() {
  const lastPage = useUserStore((s) => s.lastPage);
  const setLastPage = useUserStore((s) => s.setLastPage);
  const reciterId = useUserStore((s) => s.settings.reciterId);
  const serverUrl = useUserStore((s) => s.settings.serverUrl);
  const pendingJump = useUserStore((s) => s.pendingJump);
  const clearPendingJump = useUserStore((s) => s.clearPendingJump);
  const [selected, setSelected] = useState<string | null>(null);
  const pagerRef = useRef<PagePagerHandle>(null);
  const sheetRef = useRef<BottomSheet>(null);

  // Both playback and follow-along turn the page as the recitation advances.
  const onPage = useCallback((page: number) => {
    pagerRef.current?.scrollToPage(page);
    setLastPage(page);
  }, [setLastPage]);

  const playback = usePlayback(reciterId, onPage);
  const follow = useFollowAlong(serverUrl, onPage);

  const onSelectAyah = (k: string) => { setSelected(k); sheetRef.current?.expand(); };
  const onPlay = (k: string) => { sheetRef.current?.close(); playback.playFromVerse(k); };

  useEffect(() => {
    if (pendingJump != null) {
      pagerRef.current?.scrollToPage(pendingJump);
      clearPendingJump();
    }
  }, [pendingJump, clearPendingJump]);

  // Follow-along and playback are mutually exclusive highlight sources.
  const activeWordId = follow.active ? follow.state.currentWordId : playback.state.activeWordId;
  const playingVerseKey = follow.active ? follow.state.currentVerseKey : playback.state.activeVerseKey;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
      <FollowBar state={follow.state} onStop={follow.stop} />
      <PagePager
        ref={pagerRef}
        initialPage={lastPage}
        selectedVerseKey={selected}
        onSelectAyah={onSelectAyah}
        onPageChange={setLastPage}
        activeWordId={activeWordId}
        playingVerseKey={playingVerseKey}
        wordStatuses={follow.active ? follow.state.wordStatuses : undefined}
      />
      {!follow.active && (
        <PlayerBar
          state={playback.state}
          onToggle={playback.toggle}
          onStop={playback.stop}
          onToggleRepeat={() => playback.setRepeatAyah(!playback.state.repeatAyah)}
        />
      )}
      {!follow.active && playback.state.surah == null && (
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
});
