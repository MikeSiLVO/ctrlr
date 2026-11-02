import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { Torrent, TorrentDetails, ServerCapabilities } from "../../types";
import { DetailsTab } from "./DetailsTab";
import { FilesTab } from "./FilesTab";
import { GeneralTab } from "./GeneralTab";
import { PeersTab } from "./PeersTab";
import { type SpeedPoint, SpeedTab } from "./SpeedTab";
import { TrackersTab } from "./TrackersTab";

/** Tabs of the detail panel. */
type Tab = "general" | "details" | "files" | "peers" | "trackers" | "speed";

/** Props for the detail panel; with no torrent it asks for a selection. */
interface DetailPanelProps {
  torrent: Torrent | null;
  details: TorrentDetails | null;
  capabilities: ServerCapabilities | null;
}

/** Tabbed panel for the selected torrent, sampling its speed for the graph whatever the tab. */
export function DetailPanel({ torrent, details, capabilities }: DetailPanelProps) {
  const { t } = useTranslation();
  const files = details?.files ?? [];
  const peers = details?.peers ?? [];
  const trackers = details?.trackers ?? [];
  const detailsLoading = torrent !== null && details === null;
  const [tab, setTab] = useState<Tab>("general");
  const speedBuffer = useRef<SpeedPoint[]>([]);
  const speedHashRef = useRef<string | null>(null);
  const lastPushRef = useRef(0);

  // sampled in the parent; SpeedTab unmounts while another tab is shown
  useEffect(() => {
    if (!torrent) return;
    if (torrent.hash !== speedHashRef.current) {
      const now = Date.now();
      const pt = { dl: torrent.down_rate, ul: torrent.up_rate, ts: now };
      // two seed points; the chart needs two to draw a line
      speedBuffer.current = [{ ...pt, ts: now - 2000 }, pt];
      speedHashRef.current = torrent.hash;
      lastPushRef.current = now;
    } else {
      const now = Date.now();
      if (now - lastPushRef.current >= 1500) {
        lastPushRef.current = now;
        speedBuffer.current.push({ dl: torrent.down_rate, ul: torrent.up_rate, ts: now });
        if (speedBuffer.current.length > 60) speedBuffer.current.shift();
      }
    }
  }, [torrent?.hash, torrent?.down_rate, torrent?.up_rate]);

  if (!torrent) {
    return (
      <div
        className="flex items-center justify-center h-full text-sm"
        style={{ color: "var(--text-secondary)" }}
      >
        {t("detail.selectTorrent")}
      </div>
    );
  }

  const tabs: { label: string; value: Tab }[] = [
    { label: t("detail.general"), value: "general" },
    { label: t("detail.details"), value: "details" },
    { label: t("detail.files"), value: "files" },
    { label: t("detail.peers"), value: "peers" },
    { label: t("detail.trackers"), value: "trackers" },
    { label: t("detail.speed"), value: "speed" },
  ];

  return (
    <div className="flex flex-col h-full">
      <div
        className="flex gap-0 shrink-0"
        style={{
          background: "var(--bg-secondary)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        {tabs.map(({ label, value }) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className="px-4 py-1.5 text-xs font-medium"
            style={{
              color:
                tab === value ? "var(--accent)" : "var(--text-secondary)",
              borderBottom:
                tab === value ? "2px solid var(--accent)" : "2px solid transparent",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-3 text-xs">
        {tab === "general" && <GeneralTab torrent={torrent} details={details} files={files} loading={detailsLoading} />}
        {tab === "details" && <DetailsTab torrent={torrent} details={details} />}
        {/* keyed per torrent; pending priorities and collapsed folders belong to one torrent */}
        {tab === "files" && <FilesTab key={torrent.hash} files={files} torrent={torrent} loading={detailsLoading} capabilities={capabilities} />}
        {tab === "peers" && <PeersTab peers={peers} torrent={torrent} loading={detailsLoading} capabilities={capabilities} />}
        {tab === "trackers" && <TrackersTab trackers={trackers} torrent={torrent} loading={detailsLoading} capabilities={capabilities} />}
        {tab === "speed" && <SpeedTab torrent={torrent} buffer={speedBuffer.current} />}
      </div>
    </div>
  );
}
