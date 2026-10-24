import { useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { PagePager } from "../components/PagePager";
import { useUserStore } from "../store/userStore";

export default function MushafScreen() {
  const lastPage = useUserStore((s) => s.lastPage);
  const setLastPage = useUserStore((s) => s.setLastPage);
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
      <PagePager
        initialPage={lastPage}
        selectedVerseKey={selected}
        onSelectAyah={setSelected}
        onPageChange={setLastPage}
      />
    </SafeAreaView>
  );
}
