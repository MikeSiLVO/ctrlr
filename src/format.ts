/** Format a byte count B through PB, in 1024s to one place or 1000s to two like seedbox quotas. */
export function formatSize(bytes: number, decimal = false): string {
  const base = decimal ? 1000 : 1024;
  const places = decimal ? 2 : 1;
  if (bytes < base) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = bytes / base;
  for (const unit of units) {
    if (size < base) return `${size.toFixed(places)} ${unit}`;
    size /= base;
  }
  return `${size.toFixed(places)} PB`;
}

/** Format a byte rate per second, empty for zero. */
export function formatRate(bytesPerSec: number): string {
  if (bytesPerSec === 0) return "";
  return `${formatSize(bytesPerSec)}/s`;
}

/** Format a nonzero speed limit given in KB/s, in MB/s from 1024 up. */
export function formatLimit(kb: number): string {
  return kb >= 1024 ? `${kb / 1024} MB/s` : `${kb} KB/s`;
}

/** Format an ETA as a short duration, infinity for -2 and empty for other negatives. */
export function formatEta(seconds: number): string {
  if (seconds === -1) return "";
  if (seconds === -2) return "\u221e";
  if (seconds < 0) return "";
  if (seconds === 0) return "0s";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Format a season and episode as S01E02. */
export function formatEpisode(season: number, episode: number): string {
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

/** Format epoch seconds as a local date and time, a dash for zero. */
export function formatDate(epoch: number): string {
  if (!epoch) return "-";
  const d = new Date(epoch * 1000);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
