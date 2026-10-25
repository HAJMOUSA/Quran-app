import { useCallback, useEffect, useRef, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import BottomSheet from "@gorhom/bottom-sheet";
import { PagePager, type PagePagerHandle } from "../../components/PagePager";
import { AyahSheet } from "../../components/AyahSheet";
import { PlayerBar } from "../../components/PlayerBar";
import { usePlayback } from "../../audio/usePlayback";
import { useUserStore } from "../../store/userStore";

export default function MushafScreen() {
  const lastPage = useUserStore((s) => s.lastPage);
  const setLastPage = useUserStore((s) => s.setLastPage);
  const reciterId = useUserStore((s) => s.settings.reciterId);
  const pendingJump = useUserStore((s) => s.pendingJump);
  const clearPendingJump = useUserStore((s) => s.clearPendingJump);
  const [selected, setSelected] = useState<string | null>(null);
  const pagerRef = useRef<PagePagerHandle>(null);
  const sheetRef = useRef<BottomSheet>(null);

  // Playback turns the page as the recitation crosses page boundaries.
  const onPage = useCallback((page: number) => {
    pagerRef.current?.scrollToPage(page);
    setLastPage(page);
  }, [setLastPage]);
  const { state, playFromVerse, toggle, stop, setRepeatAyah } = usePlayback(reciterId, onPage);

  const onSelectAyah = (k: string) => { setSelected(k); sheetRef.current?.expand(); };
  const onPlay = (k: string) => { sheetRef.current?.close(); playFromVerse(k); };

  useEffect(() => {
    if (pendingJump != null) {
      pagerRef.current?.scrollToPage(pendingJump);
      clearPendingJump();
    }
  }, [pendingJump, clearPendingJump]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
      <PagePager
        ref={pagerRef}
        initialPage={lastPage}
        selectedVerseKey={selected}
        onSelectAyah={onSelectAyah}
        onPageChange={setLastPage}
        activeWordId={state.activeWordId}
        playingVerseKey={state.activeVerseKey}
      />
      <PlayerBar
        state={state}
        onToggle={toggle}
        onStop={stop}
        onToggleRepeat={() => setRepeatAyah(!state.repeatAyah)}
      />
      <AyahSheet ref={sheetRef} verseKey={selected} onPlay={onPlay} />
    </SafeAreaView>
  );
}
