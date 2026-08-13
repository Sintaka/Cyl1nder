/** Preset palette + recents persistence (3.2 split). Pure-ish (localStorage). */
import { hexToRgb } from "./color-math";

export const PALETTE: string[] = [
  "#f8f9fa", "#dee2e6", "#adb5bd", "#6c757d", "#212529",
  "#f03e3e", "#e8590c", "#f59f00", "#37b24d", "#0ca678",
  "#1098ad", "#1c7ed6", "#4263eb", "#7048e8", "#ae3ec9",
  "#ff8787", "#ffa94d", "#ffd43b", "#69db7c", "#3bc9db",
];

const RECENTS_KEY = "cyl1nder.colorRecents";
const RECENTS_MAX = 8;

export function loadRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x): x is string => typeof x === "string" && hexToRgb(x) !== null)
      .slice(0, RECENTS_MAX);
  } catch {
    return [];
  }
}

export function saveRecents(recents: string[]): void {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(recents));
  } catch {
    /* storage full / private mode -> recents are best-effort */
  }
}

export function recordRecent(hex: string): string[] {
  const recents = [hex, ...loadRecents().filter((x) => x !== hex)].slice(0, RECENTS_MAX);
  saveRecents(recents);
  return recents;
}

/** P1: delete one recent swatch (right-click) and persist. */
export function removeRecent(hex: string): string[] {
  const recents = loadRecents().filter((x) => x !== hex);
  saveRecents(recents);
  return recents;
}

/** P1: empty the whole recents list. */
export function clearRecents(): void {
  saveRecents([]);
}
