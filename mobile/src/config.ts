// Shared access token for the recognition server. Baked into the build so only
// people who have the app (your testers) can reach the server — it gates casual
// and bot traffic, not a per-user secret. Must match the server's QURAN_API_TOKEN.
// Empty string = no token (local/dev server that doesn't require one).
export const API_TOKEN = "f70b1d4307d8c782e47209e6775039070d72080e28690cc5";

export function authHeaders(): Record<string, string> {
  return API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {};
}
