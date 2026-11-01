import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { newCard, review, type SrsCard } from "../memorize/srs";

export interface Bookmark { verseKey: string; addedAt: number; }
export interface Settings {
  language: "ar" | "en";
  theme: "light" | "dark";
  translationDefault: boolean;
  reciterId: number; // Quran.com recitation id; 7 = Mishary Alafasy (Murattal)
  // Recitation server for recite-to-search / follow-along. Default is the USB dev
  // tunnel (adb reverse tcp:8000); set to a Tailscale/LAN URL for off-cable use.
  serverUrl: string;
  // Run follow-along ASR on-device (Phase 6) instead of streaming to the server.
  offlineFollow: boolean;
}
interface UserState {
  lastPage: number;
  bookmarks: Bookmark[];
  settings: Settings;
  setLastPage: (p: number) => void;
  toggleBookmark: (verseKey: string) => void;
  setSettings: (s: Partial<Settings>) => void;
  pendingJump: number | null;
  requestJump: (page: number) => void;
  clearPendingJump: () => void;
  // Memorization (SM-2, keyed by Mushaf page).
  memorization: Record<number, SrsCard>;
  addMemorizePage: (page: number) => void;
  removeMemorizePage: (page: number) => void;
  gradePage: (page: number, quality: number) => void;
  memorizeSession: number | null;   // page being actively memorized (drives Mushaf mode)
  startMemorize: (page: number) => void;
  endMemorize: () => void;
}
const clampPage = (p: number) => Math.min(604, Math.max(1, Math.round(p)));

export const useUserStore = create<UserState>()(
  persist(
    (set, get) => ({
      lastPage: 1,
      bookmarks: [],
      settings: { language: "en", theme: "light", translationDefault: true, reciterId: 7,
        serverUrl: "http://localhost:8000", offlineFollow: false },
      setLastPage: (p) => set({ lastPage: clampPage(p) }),
      toggleBookmark: (verseKey) => {
        const exists = get().bookmarks.some((b) => b.verseKey === verseKey);
        set({
          bookmarks: exists
            ? get().bookmarks.filter((b) => b.verseKey !== verseKey)
            : [...get().bookmarks, { verseKey, addedAt: Date.now() }],
        });
      },
      setSettings: (s) => set({ settings: { ...get().settings, ...s } }),
      pendingJump: null,
      requestJump: (page) => { const p = clampPage(page); set({ lastPage: p, pendingJump: p }); },
      clearPendingJump: () => set({ pendingJump: null }),
      memorization: {},
      addMemorizePage: (page) => {
        const p = clampPage(page);
        if (get().memorization[p]) return;
        set({ memorization: { ...get().memorization, [p]: newCard() } });
      },
      removeMemorizePage: (page) => {
        const m = { ...get().memorization };
        delete m[clampPage(page)];
        set({ memorization: m });
      },
      gradePage: (page, quality) => {
        const p = clampPage(page);
        const card = get().memorization[p] ?? newCard();
        set({ memorization: { ...get().memorization, [p]: review(card, quality) } });
      },
      memorizeSession: null,
      startMemorize: (page) => { const p = clampPage(page); set({ memorizeSession: p, pendingJump: p, lastPage: p }); },
      endMemorize: () => set({ memorizeSession: null }),
    }),
    {
      name: "quran-user",
      storage: createJSONStorage(() => AsyncStorage),
      // Deep-merge `settings` so keys added in later versions (e.g. reciterId)
      // fall back to defaults instead of being dropped by persisted older state.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<UserState>;
        return {
          ...current, ...p,
          settings: { ...current.settings, ...(p.settings ?? {}) },
          memorizeSession: null,   // never resume a memorize session across launches
        };
      },
    },
  ),
);
