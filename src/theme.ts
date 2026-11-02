import { loadString, savePref } from "./prefs";

/** Storage key for the chosen theme. */
const STORAGE_KEY = "ctrlr:theme";

/** Built-in themes offered in the settings picker. */
export const THEMES = [
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
  { id: "midnight", label: "Midnight" },
  { id: "nord", label: "Nord" },
  { id: "dracula", label: "Dracula" },
] as const;

/** Id of one of the built-in themes. */
export type ThemeId = (typeof THEMES)[number]["id"];

/** Get the stored theme, or dark when none or an unknown one is stored. */
export function getTheme(): ThemeId {
  const stored = loadString(STORAGE_KEY, "");
  if (THEMES.some((t) => t.id === stored)) return stored as ThemeId;
  return "dark";
}

/** Apply a theme to the document and store it in localStorage. */
export function applyTheme(id: ThemeId) {
  document.documentElement.setAttribute("data-theme", id);
  savePref(STORAGE_KEY, id);
}
