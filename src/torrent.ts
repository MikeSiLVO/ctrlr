import type { StatusFilter, Torrent } from "./types";

/** Total chunks in the wanted files, done or not; null when closed or unsupported. */
function wantedTotal(t: Torrent): number | null {
  if (t.wanted_chunks === null || !t.is_open) return null;
  return t.completed_chunks + t.wanted_chunks;
}

/** Whether every wanted chunk is downloaded, falling back to d.complete when that is unknown. */
export function isEffectivelyComplete(t: Torrent): boolean {
  if (t.wanted_chunks !== null && t.is_open) return t.wanted_chunks === 0;
  return t.complete;
}

/** Whether a torrent belongs in a status bucket. */
export function matchesFilter(t: Torrent, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  switch (filter) {
    case "downloading":
      return t.hashing === 0 && t.is_open && t.is_active && !isEffectivelyComplete(t);
    case "seeding":
      return t.hashing === 0 && t.is_open && t.is_active && isEffectivelyComplete(t);
    case "stopped":
      return t.hashing === 0 && (!t.is_open || !t.is_active);
    case "active":
      return t.is_active && (t.up_rate > 0 || t.down_rate > 0);
    case "hashing":
      return t.hashing > 0;
    default:
      return true;
  }
}

/** Status label key: hashing, stopped, paused, fetching metadata, seeding or downloading. */
export function torrentStatus(t: Torrent): string {
  if (t.hashing > 0) return "status.hashing";
  if (!t.is_open) return "status.stopped";
  if (!t.is_active) return "status.paused";
  if (t.fetching_metadata) return "status.metadata";
  return isEffectivelyComplete(t) ? "status.seeding" : "status.downloading";
}

/** Whether any of the torrents is stopped or paused. */
export function isAnyPaused(torrents: Torrent[]): boolean {
  return torrents.some((t) => {
    const s = torrentStatus(t);
    return s === "status.stopped" || s === "status.paused";
  });
}

/** Share ratio as a plain number; rTorrent reports it times 1000. */
export function torrentRatio(t: Torrent): number {
  return t.ratio_millis / 1000;
}

/** Percent done of the wanted files, or of the whole torrent when that is unknown. */
export function torrentProgress(t: Torrent): number {
  const total = wantedTotal(t);
  if (total !== null && total > 0) return (t.completed_chunks / total) * 100;
  if (t.size_bytes === 0) return 0;
  return (t.bytes_done / t.size_bytes) * 100;
}

/** Seconds left on the wanted files or whole torrent, -1 when complete, -2 when not downloading. */
export function torrentEta(t: Torrent): number {
  if (isEffectivelyComplete(t)) return -1;
  if (t.down_rate <= 0) return -2;
  const chunkBytes = t.size_chunks > 0 ? t.size_bytes / t.size_chunks : 0;
  const remaining = wantedTotal(t) !== null
    ? t.wanted_chunks! * chunkBytes
    : t.size_bytes - t.bytes_done;
  if (remaining <= 0) return 0;
  return Math.ceil(remaining / t.down_rate);
}

/** Label key for a torrent priority 0 to 3, "?" for anything else. */
export function torrentPriorityName(p: number): string {
  switch (p) {
    case 0:
      return "priority.off";
    case 1:
      return "priority.low";
    case 2:
      return "priority.normal";
    case 3:
      return "priority.high";
    default:
      return "?";
  }
}
