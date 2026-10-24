import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export interface Bookmark { verseKey: string; addedAt: number; }
export interface Settings { language: "ar" | "en"; theme: "light" | "dark"; translationDefault: boolean; }
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
}
const clampPage = (p: number) => Math.min(604, Math.max(1, Math.round(p)));

export const useUserStore = create<UserState>()(
  persist(
    (set, get) => ({
      lastPage: 1,
      bookmarks: [],
      settings: { language: "en", theme: "light", translationDefault: true },
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
    }),
    { name: "quran-user", storage: createJSONStorage(() => AsyncStorage) },
  ),
);
