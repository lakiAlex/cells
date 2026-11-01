/** Accent colors: Neutral (white in dark mode, black in light mode) and the
 * macOS system colors. The values live in styles.css; `color` is the menu dot. */
export const ACCENTS = [
  { id: "neutral", label: "Neutral", color: "linear-gradient(135deg, #ffffff 50%, #000000 50%)" },
  { id: "blue", label: "Blue", color: "#007aff" },
  { id: "purple", label: "Purple", color: "#af52de" },
  { id: "pink", label: "Pink", color: "#ff2d55" },
  { id: "red", label: "Red", color: "#ff3b30" },
  { id: "orange", label: "Orange", color: "#ff9500" },
  { id: "yellow", label: "Yellow", color: "#ffcc00" },
  { id: "green", label: "Green", color: "#34c759" },
  { id: "graphite", label: "Graphite", color: "#8e8e93" },
] as const;

export type AccentId = (typeof ACCENTS)[number]["id"];

export const ACCENT_KEY = "cells.accent";

export function savedAccent(): AccentId {
  const saved = localStorage.getItem(ACCENT_KEY);
  return ACCENTS.some((a) => a.id === saved) ? (saved as AccentId) : "neutral";
}
