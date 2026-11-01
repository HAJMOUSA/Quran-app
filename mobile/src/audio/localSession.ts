// On-device streaming session: PCM16 in → rolling-window Whisper → TS Tracker.
// The offline twin of server/quran_server/session.py; emits the same events the
// follow-along UI already consumes.
import { Tracker, type TrackerEvent } from "../match/tracker";
import type { QuranIndex } from "../match/quranIndex";
import { normalizeWords } from "../match/normalize";
import { transcribePcm } from "./localWhisper";

const SR = 16000;
const HOP = SR;              // recognize after ~1s of new audio
const WINDOW = 8 * SR;       // recognize at most the trailing 8s
const VAD_DBFS = -45;        // quieter windows are treated as silence
const SILENCE_RESET = 2 * SR;

function rmsDbfs(s: Int16Array): number {
  if (s.length === 0) return -120;
  let sum = 0;
  for (let i = 0; i < s.length; i++) { const v = s[i] / 32768; sum += v * v; }
  const rms = Math.sqrt(sum / s.length);
  return 20 * Math.log10(Math.max(rms, 1e-6));
}

export class LocalSession {
  tracker: Tracker;
  private samples = new Int16Array(0);  // trailing window
  private pending = 0;
  busy = false;

  constructor(index: QuranIndex, startGidx: number | null = null) {
    this.tracker = new Tracker(index, startGidx);
  }

  addAudio(chunk: Int16Array): void {
    const merged = new Int16Array(Math.min(this.samples.length + chunk.length, WINDOW));
    const keep = merged.length - chunk.length;
    if (keep > 0) merged.set(this.samples.subarray(this.samples.length - keep), 0);
    merged.set(chunk.subarray(Math.max(0, chunk.length - merged.length)), Math.max(0, keep));
    this.samples = merged;
    this.pending += chunk.length;
  }

  ready(): boolean { return this.pending >= HOP; }

  /** Recognize the trailing window if enough new audio arrived. Blocking (async). */
  async step(): Promise<TrackerEvent[]> {
    if (!this.ready() || this.busy) return [];
    this.busy = true;
    this.pending = 0;
    try {
      const tail = this.samples.subarray(Math.max(0, this.samples.length - SILENCE_RESET));
      if (tail.length >= SILENCE_RESET && rmsDbfs(tail) < VAD_DBFS) {
        this.samples = new Int16Array(0);   // reciter paused: drop stale audio
        return [];
      }
      if (this.samples.length < SR / 2 || rmsDbfs(this.samples) < VAD_DBFS) return [];
      // Pass a tightly-sized copy so .buffer is exactly the PCM bytes.
      const pcm = new Int16Array(this.samples);
      const text = await transcribePcm(pcm.buffer);
      const words = normalizeWords(text);
      return [this.tracker.update(words)];
    } finally {
      this.busy = false;
    }
  }

  lockEvent(gidx: number): TrackerEvent {
    this.tracker.lock(gidx);
    return this.tracker.update([]);  // emits a track event at the new position
  }

  reset(): void { this.tracker.reset(); this.samples = new Int16Array(0); this.pending = 0; }
}
