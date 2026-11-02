import { useTranslation } from "react-i18next";
import type { Torrent, TorrentDetails, TorrentFile } from "../../types";
import {
  torrentStatus,
  torrentRatio,
  torrentProgress,
  torrentPriorityName,
  isEffectivelyComplete,
} from "../../torrent";
import { formatSize, formatRate, formatEta } from "../../format";
import { InfoRow } from "./InfoRow";

/** Completion bar with one segment per file, sized by its chunk count. */
function PieceBar({ files }: { files: TorrentFile[] }) {
  const totalChunks = files.reduce((sum, f) => sum + f.size_chunks, 0);
  if (totalChunks === 0) return null;

  return (
    <div
      className="flex w-full rounded overflow-hidden mb-2"
      style={{ height: "12px", background: "var(--bg-tertiary)", gap: "1px" }}
    >
      {files.map((f) => {
        const widthPct = (f.size_chunks / totalChunks) * 100;
        const donePct =
          f.size_chunks === 0 ? 100 : (f.completed_chunks / f.size_chunks) * 100;
        return (
          <div
            key={f.index}
            style={{
              width: `${widthPct}%`,
              background:
                donePct >= 100
                  ? "var(--accent)"
                  : donePct > 0
                    ? `linear-gradient(to right, var(--accent) ${donePct}%, transparent ${donePct}%)`
                    : undefined,
            }}
          />
        );
      })}
    </div>
  );
}

/** General tab: piece bar and summary cards of status, size, transfer, swarm and ratio. */
export function GeneralTab({ torrent: tor, details, files, loading }: { torrent: Torrent; details: TorrentDetails | null; files: TorrentFile[]; loading: boolean }) {
  const { t } = useTranslation();
  const remaining = details ? details.wanted_chunks * details.chunk_size : 0;
  const eta = remaining > 0 && tor.down_rate > 0
    ? formatEta(Math.round(remaining / tor.down_rate))
    : remaining > 0 ? "\u221e" : null;
  const elapsed = details && details.state_changed > 0
    ? formatEta(Math.round(Date.now() / 1000 - details.state_changed))
    : null;
  return (
    <div className="flex flex-col gap-2">
      {!loading && <PieceBar files={files} />}
      <div className="truncate" title={tor.name}>{tor.name}</div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded px-2.5 py-1.5" style={{ background: "var(--bg-secondary)" }}>
          <InfoRow label={t("detail.general.status")} value={t(torrentStatus(tor))} />
          <InfoRow
            label={t("detail.general.size")}
            value={isEffectivelyComplete(tor)
              ? formatSize(tor.size_bytes)
              : t("detail.general.sizeProgress", { done: formatSize(tor.bytes_done), total: formatSize(tor.size_bytes), pct: torrentProgress(tor).toFixed(1) })}
          />
          {details && remaining > 0 && (
            <InfoRow label={t("detail.general.remaining")} value={`${formatSize(remaining)}${eta ? ` (${t("detail.general.etaSuffix", { eta })})` : ""}`} />
          )}
          {elapsed && <InfoRow label={t("detail.general.elapsed")} value={elapsed} />}
          <InfoRow
            label={t("detail.general.transfer")}
            value={tor.up_rate > 0 || tor.down_rate > 0
              ? `↑ ${formatRate(tor.up_rate) || "0 B/s"} (${formatSize(tor.up_total)})  ↓ ${formatRate(tor.down_rate) || "0 B/s"} (${formatSize(tor.down_total)})`
              : `↑ ${formatSize(tor.up_total)}  ↓ ${formatSize(tor.down_total)}`}
          />
        </div>
        <div className="rounded px-2.5 py-1.5" style={{ background: "var(--bg-secondary)" }}>
          <InfoRow
            label={t("detail.general.seedsPeers")}
            value={details && (details.peers_connected > 0 || details.peers_not_connected > 0)
              ? `${tor.seeds_connected} / ${details.peers_connected} of ${details.peers_connected + details.peers_not_connected}`
              : `${tor.seeds_connected} / ${tor.peers_connected}`}
          />
          <InfoRow label={t("detail.general.priority")} value={t(torrentPriorityName(tor.priority))} />
          <InfoRow label={t("detail.general.ratio")} value={torrentRatio(tor).toFixed(3)} />
          {tor.throttle_name && <InfoRow label={t("detail.general.throttle")} value={tor.throttle_name} />}
          {details && details.chunk_size > 0 && (
            <InfoRow
              label={t("detail.general.pieces")}
              value={details.skip_total > 0
                ? `${formatSize(details.chunk_size)} (${t("detail.general.wasted", { size: formatSize(details.skip_total) })})`
                : formatSize(details.chunk_size)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
