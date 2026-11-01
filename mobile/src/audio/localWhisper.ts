// On-device Whisper (Phase 6): download the ggml model once, then transcribe
// raw 16-bit PCM locally via whisper.rn — no server needed.
import { initWhisper, type WhisperContext } from "whisper.rn";
import * as FileSystem from "expo-file-system/legacy";

const MODEL_FILE = "ggml-tarteel-base-ar-quran.bin";

let ctx: WhisperContext | null = null;
let loading: Promise<WhisperContext> | null = null;

async function ensureModel(serverUrl: string): Promise<string> {
  const dir = `${FileSystem.documentDirectory}models`;
  const target = `${dir}/${MODEL_FILE}`;
  const info = await FileSystem.getInfoAsync(target);
  if (info.exists && (info.size ?? 0) > 100 * 1024 * 1024) return target;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
  const url = `${serverUrl.replace(/\/+$/, "")}/model/${MODEL_FILE}`;
  const res = await FileSystem.downloadAsync(url, target);
  if (res.status !== 200) throw new Error(`model download HTTP ${res.status}`);
  return target;
}

/** Load the on-device Whisper context (downloads the model on first use). */
export async function getWhisper(serverUrl: string): Promise<WhisperContext> {
  if (ctx) return ctx;
  if (loading) return loading;
  loading = (async () => {
    const filePath = await ensureModel(serverUrl);
    ctx = await initWhisper({ filePath, useGpu: true });
    return ctx;
  })();
  return loading;
}

export function isWhisperReady(): boolean { return ctx != null; }

/** Transcribe a mono 16 kHz signed-16-bit PCM window. Returns recognized text. */
export async function transcribePcm(pcm: ArrayBuffer): Promise<string> {
  if (!ctx) return "";
  const { promise } = ctx.transcribeData(pcm, { language: "ar", maxThreads: 4 });
  const res = await promise;
  return (res?.result ?? "").trim();
}

export async function isModelDownloaded(): Promise<boolean> {
  const target = `${FileSystem.documentDirectory}models/${MODEL_FILE}`;
  const info = await FileSystem.getInfoAsync(target);
  return info.exists && (info.size ?? 0) > 100 * 1024 * 1024;
}
