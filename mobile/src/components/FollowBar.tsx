import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { FollowState } from "../audio/useFollowAlong";
import { t } from "../i18n";

// Top status strip shown only while follow-along is active (or after it failed).
export function FollowBar({ state, onStop, onRetry }: { state: FollowState; onStop: () => void; onRetry?: () => void }) {
  if (state.status === "idle") return null;
  if (state.status === "error") {
    return (
      <View style={[styles.bar, styles.error]}>
        <Text style={styles.dot}>⚠</Text>
        <Text style={styles.label} numberOfLines={2}>{state.error ?? t("follow.errorConnect")}</Text>
        {onRetry && (
          <Pressable onPress={onRetry} hitSlop={8} testID="follow-retry">
            <Text style={styles.stop}>{t("follow.retry")}</Text>
          </Pressable>
        )}
        <Pressable onPress={onStop} hitSlop={8} testID="follow-dismiss">
          <Text style={styles.stop}>✕</Text>
        </Pressable>
      </View>
    );
  }
  const tracking = state.status === "tracking";
  const label = tracking ? `${t("follow.tracking")} · ${state.currentVerseKey ?? ""}`
    : state.status === "preparing" ? t("follow.preparing") : t("follow.listening");
  return (
    <View style={[styles.bar, tracking && styles.tracking]}>
      {tracking
        ? <Text style={styles.dot}>●</Text>
        : <ActivityIndicator color="#fff" size="small" />}
      <Text style={styles.label} numberOfLines={1}>{label}</Text>
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
  error: { backgroundColor: "#8a2f1f" },
  dot: { color: "#8dffb0", fontSize: 12 },
  label: { flex: 1, color: "#fff", fontSize: 15 },
  stop: { color: "#fff", fontSize: 15, fontWeight: "600" },
});
