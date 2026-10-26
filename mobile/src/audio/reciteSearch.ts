// Recite-to-search client: upload a short recording to the server, which runs
// Quran ASR + index search and returns the matching ayat.
import * as FileSystem from "expo-file-system/legacy";

export interface AudioCandidate {
  start: number;
  end: number;
  score: number;
  verse_keys: string[];
  page: number;
  start_word_id: number;
  end_word_id: number;
}

export interface AudioSearchResult {
  text: string;
  latency: number;
  candidates: AudioCandidate[];
}

export async function searchByAudio(
  serverUrl: string,
  fileUri: string,
  topK = 5,
): Promise<AudioSearchResult> {
  const base = serverUrl.replace(/\/+$/, "");
  // The server reads the raw request body (not multipart), so upload the file as
  // the binary body with the recording's content type.
  const res = await FileSystem.uploadAsync(`${base}/api/search/audio?top_k=${topK}`, fileUri, {
    httpMethod: "POST",
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: { "Content-Type": "audio/mp4" },
  });
  if (res.status !== 200) {
    throw new Error(`search failed (HTTP ${res.status}) ${res.body?.slice(0, 200) ?? ""}`);
  }
  return JSON.parse(res.body) as AudioSearchResult;
}
