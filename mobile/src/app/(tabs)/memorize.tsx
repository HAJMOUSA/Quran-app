import { useMemo } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useUserStore } from "../../store/userStore";
import { cardStage, isDue } from "../../memorize/srs";
import { t } from "../../i18n";

export default function MemorizeScreen() {
  const memorization = useUserStore((s) => s.memorization);
  const lastPage = useUserStore((s) => s.lastPage);
  const addMemorizePage = useUserStore((s) => s.addMemorizePage);
  const startMemorize = useUserStore((s) => s.startMemorize);

  const now = Date.now();
  const pages = useMemo(
    () => Object.keys(memorization).map(Number)
      .sort((a, b) => memorization[a].dueAt - memorization[b].dueAt),
    [memorization],
  );
  const due = pages.filter((p) => isDue(memorization[p], now));

  const begin = (page: number) => { startMemorize(page); router.navigate("/(tabs)"); };

  return (
    <SafeAreaView style={styles.root}>
      <Text style={styles.h1}>{t("memorize.title")}</Text>

      <Pressable style={styles.addBtn} onPress={() => { addMemorizePage(lastPage); begin(lastPage); }}>
        <Text style={styles.addText}>＋ {t("memorize.addCurrent")} ({t("memorize.page")} {lastPage})</Text>
      </Pressable>

      {pages.length === 0
        ? <Text style={styles.empty}>{t("memorize.empty")}</Text>
        : (
          <>
            <Text style={styles.section}>{t("memorize.due")} · {due.length}</Text>
            <FlatList
              data={pages}
              keyExtractor={(p) => String(p)}
              renderItem={({ item: page }) => {
                const card = memorization[page];
                const stage = cardStage(card, now);
                const dueNow = isDue(card, now);
                return (
                  <Pressable style={styles.row} onPress={() => begin(page)}>
                    <View>
                      <Text style={styles.rowTitle}>{t("memorize.page")} {page}</Text>
                      <Text style={styles.rowSub}>{t(`memorize.stage.${stage}`)}
                        {card.lastGrade != null ? ` · ${Math.round((card.lastGrade / 5) * 100)}%` : ""}</Text>
                    </View>
                    <Text style={[styles.cta, dueNow && styles.ctaDue]}>
                      {dueNow ? t("memorize.review") : t("memorize.start")} ›
                    </Text>
                  </Pressable>
                );
              }}
            />
          </>
        )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 16 },
  h1: { fontSize: 22, fontWeight: "700", marginBottom: 12 },
  addBtn: { backgroundColor: "#1f6f43", borderRadius: 10, paddingVertical: 14, alignItems: "center", marginBottom: 16 },
  addText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  empty: { color: "#888", fontSize: 15, marginTop: 20, textAlign: "center" },
  section: { fontSize: 13, color: "#888", textTransform: "uppercase", marginBottom: 6 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 14, borderBottomWidth: 1, borderColor: "#eee" },
  rowTitle: { fontSize: 17 },
  rowSub: { fontSize: 13, color: "#888", marginTop: 2 },
  cta: { fontSize: 15, color: "#007aff", fontWeight: "600" },
  ctaDue: { color: "#1f6f43" },
});
