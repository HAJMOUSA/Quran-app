import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { FollowState } from "../audio/useFollowAlong";
import { t } from "../i18n";

// Top status strip shown only while follow-along is active.
export function FollowBar({ state, onStop }: { state: FollowState; onStop: () => void }) {
  if (state.status === "idle") return null;
  const tracking = state.status === "tracking";
  return (
    <View style={[styles.bar, tracking && styles.tracking]}>
      {tracking
        ? <Text style={styles.dot}>●</Text>
        : <ActivityIndicator color="#fff" size="small" />}
      <Text style={styles.label} numberOfLines={1}>
        {tracking ? `${t("follow.tracking")} · ${state.currentVerseKey ?? ""}` : t("follow.listening")}
      </Text>
      <Pressable onPress={onStop} hitSlop={8} testID="follow-stop">
        <Text style={styles.stop}>{t("follow.stop")} ■</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingVertical: 10, backgroundColor: "#8a6d1f",
  },
  tracking: { backgroundColor: "#1f6f43" },
  dot: { color: "#8dffb0", fontSize: 12 },
  label: { flex: 1, color: "#fff", fontSize: 15 },
  stop: { color: "#fff", fontSize: 15, fontWeight: "600" },
});
