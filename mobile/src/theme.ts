export const THEMES = {
  light: { bg: "#ffffff", text: "#111111", muted: "#888888", accent: "#007aff" },
  dark: { bg: "#111418", text: "#f2f2f2", muted: "#9aa0a6", accent: "#4f9dff" },
} as const;
export type ThemeName = keyof typeof THEMES;
