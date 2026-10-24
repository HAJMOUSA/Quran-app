import { useEffect, useRef, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import BottomSheet from "@gorhom/bottom-sheet";
import { PagePager, type PagePagerHandle } from "../../components/PagePager";
import { AyahSheet } from "../../components/AyahSheet";
import { useUserStore } from "../../store/userStore";

export default function MushafScreen() {
  const lastPage = useUserStore((s) => s.lastPage);
  const setLastPage = useUserStore((s) => s.setLastPage);
  const pendingJump = useUserStore((s) => s.pendingJump);
  const clearPendingJump = useUserStore((s) => s.clearPendingJump);
  const [selected, setSelected] = useState<string | null>(null);
  const pagerRef = useRef<PagePagerHandle>(null);
  const sheetRef = useRef<BottomSheet>(null);
  const onSelectAyah = (k: string) => { setSelected(k); sheetRef.current?.expand(); };
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
      />
      <AyahSheet ref={sheetRef} verseKey={selected} />
    </SafeAreaView>
  );
}
