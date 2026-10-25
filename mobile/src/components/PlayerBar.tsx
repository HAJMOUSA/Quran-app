import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { PlaybackState } from "../audio/usePlayback";
import { t } from "../i18n";

interface Props {
  state: PlaybackState;
  onToggle: () => void;
  onStop: () => void;
  onToggleRepeat: () => void;
}

// A compact transport bar shown only while a surah is loaded/playing.
export function PlayerBar({ state, onToggle, onStop, onToggleRepeat }: Props) {
  if (!state.surah && !state.loading) return null;
  return (
    <View style={styles.bar}>
      <Pressable onPress={onToggle} hitSlop={8} style={styles.btn} testID="player-toggle">
        {state.loading
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.icon}>{state.playing ? "⏸" : "▶"}</Text>}
      </Pressable>
      <Text style={styles.label} numberOfLines={1}>
        {state.loading ? t("player.loading") : state.activeVerseKey ?? ""}
      </Text>
      <Pressable onPress={onToggleRepeat} hitSlop={8} style={styles.btn} testID="player-repeat">
        <Text style={[styles.icon, state.repeatAyah && styles.on]}>🔁</Text>
      </Pressable>
      <Pressable onPress={onStop} hitSlop={8} style={styles.btn} testID="player-stop">
        <Text style={styles.icon}>■</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row", alignItems: "center", gap: 14,
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: "#1f6f43",
  },
  btn: { minWidth: 32, alignItems: "center" },
  icon: { color: "#fff", fontSize: 20 },
  on: { opacity: 1, textShadowColor: "#ffe08a", textShadowRadius: 8 },
  label: { flex: 1, color: "#eafff0", fontSize: 15 },
});
