/** Default speed limit presets in KB per second, 0 for unlimited. */
export const DEFAULT_SPEED_PRESETS = [0, 128, 256, 512, 1024, 2048, 4096, 8192, 10240];
/** Storage key for the speed limit presets. */
export const STORAGE_KEY_PRESETS = "ctrlr:speed-presets";

/** Whether a value is the same kind as a reference: array, plain object, or same primitive type. */
function sameKind(a: unknown, b: unknown): boolean {
  if (Array.isArray(b)) return Array.isArray(a);
  if (b !== null && typeof b === "object") {
    return a !== null && typeof a === "object" && !Array.isArray(a);
  }
  return typeof a === typeof b;
}

/** Read a stored value, null when absent or when storage is blocked. */
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Load a string from localStorage, falling back when absent or empty. */
export function loadString(key: string, fallback: string): string {
  return read(key) || fallback;
}

/** Load a boolean from localStorage, falling back when absent or neither true nor false. */
export function loadBool(key: string, fallback: boolean): boolean {
  const stored = read(key);
  if (stored === "true") return true;
  if (stored === "false") return false;
  return fallback;
}

/** Load a number from localStorage, falling back when absent, zero, or not a number. */
export function loadNumber(key: string, fallback: number): number {
  return Number(read(key)) || fallback;
}

/** Load JSON from localStorage, falling back when absent, corrupt, or the wrong kind. */
export function loadJSON<T>(key: string, fallback: T): T {
  const raw = read(key);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return sameKind(parsed, fallback) ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Save a string, number or boolean to localStorage, skipped when storage is full or blocked. */
export function savePref(key: string, value: string | number | boolean) {
  try {
    localStorage.setItem(key, String(value));
  } catch { /* value still applies this session */ }
}

/** Save a value to localStorage as JSON, skipped when storage is full or blocked. */
export function saveJSON(key: string, value: unknown) {
  savePref(key, JSON.stringify(value));
}

/** Load the speed presets offered in the limit editor's context menu. */
export function loadPresets(): number[] {
  return loadJSON(STORAGE_KEY_PRESETS, DEFAULT_SPEED_PRESETS);
}
