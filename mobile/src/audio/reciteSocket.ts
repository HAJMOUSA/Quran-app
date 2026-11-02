// WebSocket client for live follow-along (/ws/recite). Streams PCM16 mic frames
// to the server and surfaces the tracker's events (transcript, search, track).
// Protocol is defined in server/quran_server/app.py.

export interface TrackWord { gidx: number; word_id: number; status: "correct" | "wrong" | "missed"; }
export interface TrackCurrent { gidx: number; word_id: number; verse_key: string; page: number; line: number; position: number; }
export interface SearchCandidate { start: number; end: number; score: number; verse_keys: string[]; page: number; }

export type ReciteEvent =
  | { type: "ready"; model: string; device: string }
  | { type: "transcript"; text: string; latency: number; t: number }
  | { type: "search"; candidates: SearchCandidate[] }
  | { type: "track"; position: number | null; current: TrackCurrent | null; changed: TrackWord[]; locked?: boolean }
  | { type: "silence"; t?: number }
  | { type: "error"; message: string };

export interface ReciteSocketHandlers {
  onEvent: (ev: ReciteEvent) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (e: unknown) => void;
}

import { authHeaders } from "../config";

export function wsUrlFrom(serverUrl: string): string {
  const base = serverUrl.replace(/\/+$/, "");
  return base.replace(/^http/i, "ws") + "/ws/recite";
}

export class ReciteSocket {
  private ws: WebSocket | null = null;
  private ready = false;
  private queue: ArrayBuffer[] = []; // frames captured before "ready"
  private sampleRate = 16000;
  private startGidx: number | null = null;

  constructor(private serverUrl: string, private handlers: ReciteSocketHandlers) {}

  connect(sampleRate: number, startGidx: number | null = null): void {
    this.sampleRate = sampleRate;
    this.startGidx = startGidx;
    // RN's WebSocket takes an options arg (headers) that the DOM type omits.
    const ws: WebSocket = new (WebSocket as any)(wsUrlFrom(this.serverUrl), undefined, { headers: authHeaders() });
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "start", sample_rate: this.sampleRate, start_gidx: this.startGidx }));
      this.handlers.onOpen?.();
    };
    ws.onmessage = (e) => {
      let ev: ReciteEvent;
      try { ev = JSON.parse(e.data as string); } catch { return; }
      if (ev.type === "ready") {
        this.ready = true;
        for (const f of this.queue) ws.send(f);
        this.queue = [];
      }
      this.handlers.onEvent(ev);
    };
    ws.onerror = (e) => this.handlers.onError?.(e);
    ws.onclose = () => { this.ready = false; this.handlers.onClose?.(); };
  }

  /** Send one PCM16 mono frame. Frames before "ready" are queued (bounded). */
  sendFrame(data: ArrayBuffer): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (this.ready) { ws.send(data); return; }
    if (this.queue.length < 50) this.queue.push(data); // ~a few seconds; drop older if slow
  }

  lock(gidx: number): void { this.send({ type: "lock", gidx }); }
  reset(): void { this.send({ type: "reset" }); }

  close(): void {
    const ws = this.ws;
    this.ws = null;
    this.ready = false;
    this.queue = [];
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: "stop" })); } catch {}
    }
    ws?.close();
  }

  private send(msg: object): void {
    const ws = this.ws;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }
}
