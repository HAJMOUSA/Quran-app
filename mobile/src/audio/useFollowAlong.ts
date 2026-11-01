// Live follow-along. Online: stream mic → server /ws/recite. Offline (Phase 6):
// stream mic → on-device Whisper (whisper.rn) → the ported TS tracker. Both emit
// the same events, so the UI (word highlight, mistakes, page turn) is identical.
import { useCallback, useRef, useState } from "react";
import { useAudioStream, AudioModule, setAudioModeAsync } from "expo-audio";
import { ReciteSocket, type ReciteEvent, type SearchCandidate } from "./reciteSocket";
import { LocalSession } from "./localSession";
import { getWhisper } from "./localWhisper";
import { loadQuranIndex } from "../match/loadIndex";
import { t } from "../i18n";
import type { TrackerEvent } from "../match/tracker";

export type FollowStatus = "idle" | "preparing" | "listening" | "tracking" | "error";
export type WordStatus = "correct" | "wrong" | "missed";

// If we never hear anything back (dead server, silent/blocked mic) within this
// window, surface an error instead of spinning on "Finding your place…" forever.
// Any pipeline event (transcript/search/silence) re-arms it, so a connected but
// quiet session keeps waiting.
const LISTEN_TIMEOUT_MS = 25000;

export interface FollowState {
  status: FollowStatus;
  currentWordId: number | null;
  currentVerseKey: string | null;
  page: number | null;
  wordStatuses: Record<number, WordStatus>;
  candidates: SearchCandidate[];
  offline: boolean;
  error: string | null;
}

const IDLE: FollowState = {
  status: "idle", currentWordId: null, currentVerseKey: null, page: null,
  wordStatuses: {}, candidates: [], offline: false, error: null,
};

export function useFollowAlong(serverUrl: string, onPage?: (page: number) => void) {
  const [state, setState] = useState<FollowState>(IDLE);
  const socket = useRef<ReciteSocket | null>(null);
  const session = useRef<LocalSession | null>(null);
  const offlineRef = useRef(false);
  const statuses = useRef<Record<number, WordStatus>>({});
  const lastPage = useRef<number | null>(null);
  const stopping = useRef(false);       // set while we tear down, so onClose doesn't error
  const trackingStarted = useRef(false); // once true, stop arming the no-audio watchdog
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failRef = useRef<(msg: string) => void>(() => {});

  const clearWatchdog = useCallback(() => {
    if (watchdog.current) { clearTimeout(watchdog.current); watchdog.current = null; }
  }, []);
  const armWatchdog = useCallback(() => {
    clearWatchdog();
    watchdog.current = setTimeout(() => failRef.current(t("follow.errorNoAudio")), LISTEN_TIMEOUT_MS);
  }, [clearWatchdog]);
  const armWatchdogRef = useRef(armWatchdog);
  armWatchdogRef.current = armWatchdog;

  const handleEvent = useCallback((ev: ReciteEvent | TrackerEvent) => {
    if (ev.type === "track" && ev.position != null) {
      trackingStarted.current = true;
      clearWatchdog();
      for (const c of ev.changed) statuses.current[c.word_id] = c.status;
      const cur = ev.current;
      setState((s) => ({
        ...s,
        status: "tracking",
        error: null,
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
      return;
    }
    // Server-reported error: surface it directly.
    if (ev.type === "error") { failRef.current(ev.message || t("follow.errorConnect")); return; }
    // Any other event means the pipeline is alive; keep waiting (re-arm watchdog).
    if (!trackingStarted.current) armWatchdog();
    if (ev.type === "search") {
      setState((s) => ({ ...s, status: "listening", candidates: ev.candidates as SearchCandidate[] }));
    }
  }, [onPage, armWatchdog, clearWatchdog]);
  const handleEventRef = useRef(handleEvent);
  handleEventRef.current = handleEvent;

  // Stable: reads refs so useAudioStream keeps one callback for the stream's life.
  const onBuffer = useCallback((buf: { data: ArrayBuffer }) => {
    if (offlineRef.current) {
      const s = session.current;
      if (!s) return;
      // Offline emits no events during silence, so incoming mic frames are the
      // "pipeline alive" signal that keeps the no-audio watchdog from falsely
      // firing while the reciter is quiet or on-device inference is slow.
      if (!trackingStarted.current) armWatchdogRef.current();
      s.addAudio(new Int16Array(buf.data));
      if (s.ready() && !s.busy) {
        s.step().then((evs) => evs.forEach((e) => handleEventRef.current(e))).catch((e) => console.warn("local step", e));
      }
    } else {
      socket.current?.sendFrame(buf.data);
    }
  }, []);
  const { stream } = useAudioStream({ sampleRate: 16000, channels: 1, encoding: "int16", onBuffer });

  // Tear down everything and surface an error (used by socket failures + watchdog).
  const fail = useCallback((msg: string) => {
    clearWatchdog();
    stopping.current = true;
    try { stream.stop(); } catch {}
    socket.current?.close();
    socket.current = null;
    session.current = null;
    offlineRef.current = false;
    setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    lastPage.current = null;
    // Only the first failure wins; ignore once we're idle or already showing an error.
    setState((s) => (s.status === "idle" || s.status === "error" ? s : { ...IDLE, status: "error", error: msg }));
  }, [stream, clearWatchdog]);
  failRef.current = fail;

  const start = useCallback(async (startGidx: number | null = null, offline = false) => {
    const perm = await AudioModule.requestRecordingPermissionsAsync();
    if (!perm.granted) { fail(t("follow.errorNoAudio")); return; }
    statuses.current = {};
    lastPage.current = null;
    stopping.current = false;
    trackingStarted.current = false;
    offlineRef.current = offline;
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      if (offline) {
        setState({ ...IDLE, status: "preparing", offline: true });  // may download the model
        const [, index] = await Promise.all([getWhisper(serverUrl), loadQuranIndex()]);
        session.current = new LocalSession(index, startGidx);
        await stream.start();
        setState({ ...IDLE, status: "listening", offline: true });
      } else {
        await stream.start();
        const sock = new ReciteSocket(serverUrl, {
          onEvent: handleEvent,
          onError: () => failRef.current(t("follow.errorConnect")),
          onClose: () => { if (!stopping.current) failRef.current(t("follow.errorConnect")); },
        });
        sock.connect(stream.sampleRate || 16000, startGidx);
        socket.current = sock;
        setState({ ...IDLE, status: "listening" });
      }
      armWatchdog();
    } catch (e) {
      console.warn("follow-along start failed", e);
      fail(offline ? t("follow.errorModel") : t("follow.errorConnect"));
    }
  }, [stream, serverUrl, handleEvent, fail, armWatchdog]);

  const stop = useCallback(() => {
    clearWatchdog();
    stopping.current = true;
    try { stream.stop(); } catch {}
    socket.current?.close();
    socket.current = null;
    session.current = null;
    offlineRef.current = false;
    setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    lastPage.current = null;
    setState(IDLE);
  }, [stream, clearWatchdog]);

  return { state, start, stop, active: state.status !== "idle" && state.status !== "error" };
}
