// Live follow-along: stream the mic to the server and track the reciter's position
// word-by-word. Highlights the current word, marks wrong/missed words, and reports
// page changes for auto page-turn. ASR + tracking happen server-side (/ws/recite).
import { useCallback, useRef, useState } from "react";
import { useAudioStream, AudioModule, setAudioModeAsync } from "expo-audio";
import { ReciteSocket, type ReciteEvent, type SearchCandidate } from "./reciteSocket";

export type FollowStatus = "idle" | "listening" | "tracking";
export type WordStatus = "correct" | "wrong" | "missed";

export interface FollowState {
  status: FollowStatus;
  currentWordId: number | null;       // word being recited now (highlight)
  currentVerseKey: string | null;
  page: number | null;
  wordStatuses: Record<number, WordStatus>;  // by word_id
  candidates: SearchCandidate[];       // shown while still finding the place
}

const IDLE: FollowState = {
  status: "idle", currentWordId: null, currentVerseKey: null, page: null,
  wordStatuses: {}, candidates: [],
};

export function useFollowAlong(serverUrl: string, onPage?: (page: number) => void) {
  const [state, setState] = useState<FollowState>(IDLE);
  const socket = useRef<ReciteSocket | null>(null);
  const statuses = useRef<Record<number, WordStatus>>({});
  const lastPage = useRef<number | null>(null);

  // Native mic stream. onBuffer must be stable; it forwards PCM16 to the socket.
  const onBuffer = useCallback((buf: { data: ArrayBuffer }) => {
    socket.current?.sendFrame(buf.data);
  }, []);
  const { stream } = useAudioStream({ sampleRate: 16000, channels: 1, encoding: "int16", onBuffer });

  const handleEvent = useCallback((ev: ReciteEvent) => {
    if (ev.type === "search") {
      setState((s) => ({ ...s, status: "listening", candidates: ev.candidates }));
    } else if (ev.type === "track" && ev.position != null) {
      for (const c of ev.changed) statuses.current[c.word_id] = c.status;
      const cur = ev.current;
      setState((s) => ({
        ...s,
        status: "tracking",
        candidates: [],
        currentWordId: cur?.word_id ?? s.currentWordId,
        currentVerseKey: cur?.verse_key ?? s.currentVerseKey,
        page: cur?.page ?? s.page,
        wordStatuses: { ...statuses.current },
      }));
      if (cur && cur.page !== lastPage.current) {
        lastPage.current = cur.page;
        onPage?.(cur.page);
      }
    }
  }, [onPage]);

  const start = useCallback(async (startGidx: number | null = null) => {
    const perm = await AudioModule.requestRecordingPermissionsAsync();
    if (!perm.granted) return;
    statuses.current = {};
    lastPage.current = null;
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await stream.start();
      const rate = stream.sampleRate || 16000;
      const sock = new ReciteSocket(serverUrl, { onEvent: handleEvent });
      sock.connect(rate, startGidx);
      socket.current = sock;
      setState({ ...IDLE, status: "listening" });
    } catch (e) {
      console.warn("follow-along start failed", e);
      try { stream.stop(); } catch {}
      setState(IDLE);
    }
  }, [stream, serverUrl, handleEvent]);

  const stop = useCallback(() => {
    try { stream.stop(); } catch {}
    socket.current?.close();
    socket.current = null;
    setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    lastPage.current = null;
    setState(IDLE);
  }, [stream]);

  return { state, start, stop, active: state.status !== "idle" };
}
