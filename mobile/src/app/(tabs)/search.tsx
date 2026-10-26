import { useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useAudioRecorder, AudioModule, RecordingPresets, setAudioModeAsync } from "expo-audio";
import { search } from "../../db/quranDb";
import { searchByAudio, type AudioCandidate } from "../../audio/reciteSearch";
import { useUserStore } from "../../store/userStore";
import { t } from "../../i18n";
import type { SearchHit } from "../../db/schema";

type ReciteState = "idle" | "recording" | "searching";

export default function SearchScreen() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const requestJump = useUserStore((s) => s.requestJump);
  const serverUrl = useUserStore((s) => s.settings.serverUrl);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recite, setRecite] = useState<ReciteState>("idle");
  const [heard, setHeard] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<AudioCandidate[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run = async (text: string) => {
    setQ(text);
    if (!text.trim()) { setHits([]); return; }
    try { setHits(await search(text)); } catch (e) { console.warn("search failed", e); setHits([]); }
  };

  const startRecite = async () => {
    setNotice(null); setHeard(null); setCandidates(null);
    const perm = await AudioModule.requestRecordingPermissionsAsync();
    if (!perm.granted) { setNotice(t("recite.denied")); return; }
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecite("recording");
    } catch (e) {
      console.warn("record start failed", e);
      setNotice(t("recite.error"));
      setRecite("idle");
    }
  };

  const stopRecite = async () => {
    setRecite("searching");
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error("no recording uri");
      const res = await searchByAudio(serverUrl, uri);
      setHeard(res.text);
      setCandidates(res.candidates);
      if (res.candidates.length === 0) setNotice(t("recite.nomatch"));
    } catch (e) {
      console.warn("recite search failed", e);
      setNotice(t("recite.error"));
    } finally {
      setRecite("idle");
      setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    }
  };

  const onMic = () => { if (recite === "recording") stopRecite(); else if (recite === "idle") startRecite(); };

  return (
    <SafeAreaView style={{ flex: 1, padding: 12 }}>
      <TextInput
        value={q}
        onChangeText={run}
        placeholder={t("search.placeholder")}
        style={styles.input}
      />

      <Pressable
        onPress={onMic}
        style={[styles.mic, recite === "recording" && styles.micRecording]}
        testID="recite-mic"
      >
        {recite === "searching"
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.micText}>
              {recite === "recording" ? `⏹  ${t("recite.listening")}` : `🎙  ${t("recite.tap")}`}
            </Text>}
      </Pressable>

      {notice && <Text style={styles.notice}>{notice}</Text>}
      {heard && <Text style={styles.heard}>{t("recite.heard")}: {heard}</Text>}

      {candidates
        ? <FlatList
            data={candidates}
            keyExtractor={(c) => `${c.start}-${c.end}`}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable
                onPress={() => { requestJump(item.page); router.navigate("/(tabs)"); }}
                style={styles.row}
              >
                <Text style={{ color: "#888" }}>
                  {item.verse_keys.join(", ")} · p.{item.page} · {(item.score * 100).toFixed(0)}%
                </Text>
              </Pressable>
            )}
          />
        : <FlatList
            data={hits}
            keyExtractor={(h) => h.verse_key}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable
                onPress={() => { requestJump(item.page); router.navigate("/(tabs)"); }}
                style={styles.row}
              >
                <Text style={{ color: "#888" }}>{item.verse_key} · p.{item.page}</Text>
                <Text numberOfLines={2}>{item.translation_en}</Text>
              </Pressable>
            )}
          />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 12, textAlign: "right", fontSize: 16 },
  mic: { marginTop: 12, backgroundColor: "#1f6f43", borderRadius: 10, paddingVertical: 14, alignItems: "center" },
  micRecording: { backgroundColor: "#b3261e" },
  micText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  notice: { marginTop: 12, color: "#b3261e", textAlign: "center" },
  heard: { marginTop: 12, fontSize: 18, textAlign: "right", color: "#111" },
  row: { paddingVertical: 12, borderBottomWidth: 1, borderColor: "#eee" },
});
