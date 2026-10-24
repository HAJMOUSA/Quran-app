import { useEffect, useRef, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { PagePager, type PagePagerHandle } from "../../components/PagePager";
import { useUserStore } from "../../store/userStore";

export default function MushafScreen() {
  const lastPage = useUserStore((s) => s.lastPage);
  const setLastPage = useUserStore((s) => s.setLastPage);
  const pendingJump = useUserStore((s) => s.pendingJump);
  const clearPendingJump = useUserStore((s) => s.clearPendingJump);
  const [selected, setSelected] = useState<string | null>(null);
  const pagerRef = useRef<PagePagerHandle>(null);
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
        onSelectAyah={setSelected}
        onPageChange={setLastPage}
      />
    </SafeAreaView>
  );
}
