import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { Torrent, TorrentTracker, ServerCapabilities } from "../../types";
import { formatEta } from "../../format";
import * as api from "../../api";
import { INPUT_STYLE } from "../ui";

/** Trackers tab: trackers with enable toggles, force announce and an add form. */
export function TrackersTab({ trackers, torrent, loading, capabilities }: { trackers: TorrentTracker[]; torrent: Torrent; loading: boolean; capabilities: ServerCapabilities | null }) {
  const { t } = useTranslation();
  const [addUrl, setAddUrl] = useState("");
  const [addGroup, setAddGroup] = useState(0);
  // optimistic toggles keyed by tracker URL, cleared when the server's list changes
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [announced, setAnnounced] = useState(false);
  const announceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (announceTimer.current) clearTimeout(announceTimer.current); }, []);

  const trackerKey = trackers.map((tk) => `${tk.url}:${tk.is_enabled}`).join("|");
  useEffect(() => {
    setOverrides({});
  }, [trackerKey]);

  // no early return when empty; the add form is the only way back for a trackerless torrent
  const empty = trackers.length === 0;

  function handleToggle(index: number, url: string, newEnabled: boolean) {
    setOverrides((prev) => ({ ...prev, [url]: newEnabled }));
    api.toggleTracker(torrent.hash, index, newEnabled).catch(() => {
      setOverrides((prev) => { const next = { ...prev }; delete next[url]; return next; });
    });
  }

  function handleForceAnnounce() {
    setAnnounced(true);
    api.forceAnnounce(torrent.hash).catch(() => {});
    if (announceTimer.current) clearTimeout(announceTimer.current);
    announceTimer.current = setTimeout(() => setAnnounced(false), 1500);
  }

  async function handleAddTracker() {
    if (!addUrl.trim()) return;
    try {
      await api.addTracker(torrent.hash, addGroup, addUrl.trim());
      setAddUrl("");
    } catch { /* next poll */ }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2 items-center">
        <button
          onClick={handleForceAnnounce}
          className="px-2 py-0.5 rounded text-xs transition-colors"
          style={{
            background: announced ? "var(--accent-dim)" : "var(--bg-tertiary)",
            color: announced ? "white" : "var(--text-primary)",
            border: `1px solid ${announced ? "var(--accent)" : "var(--border)"}`,
          }}
        >
          {announced ? t("detail.trackers.announced") : t("detail.trackers.forceAnnounce")}
        </button>
      </div>
      {empty && (
        <div style={{ color: "var(--text-secondary)" }}>
          {loading ? t("detail.trackers.loading") : t("detail.trackers.noTrackers")}
        </div>
      )}
      <div className="flex flex-col gap-1">
        {trackers.map((tr, i) => {
          const enabled = overrides[tr.url] ?? tr.is_enabled;
          const scrapeAge = tr.scrape_time_last
            ? t("detail.general.ago", { time: formatEta(Math.round(Date.now() / 1000 - tr.scrape_time_last)) })
            : null;
          const interval = tr.normal_interval ? formatEta(tr.normal_interval) : null;
          const trackerType = tr.tracker_type === 1 ? "HTTP" : tr.tracker_type === 2 ? "UDP" : "DHT";
          return (
            <div
              key={tr.url}
              className="rounded px-2 py-1 flex items-center gap-2"
              style={{ background: "var(--bg-secondary)" }}
            >
              <div className="flex-1 min-w-0">
                <div className="truncate text-xs" title={tr.url}>{tr.url}</div>
                <div className="flex gap-3 mt-0.5 text-[11px]" style={{ color: "var(--text-secondary)" }}>
                  <span>{trackerType}</span>
                  {tr.scrape_complete > 0 && <span>{t("detail.trackers.seeds")}: {tr.scrape_complete}</span>}
                  {tr.scrape_incomplete > 0 && <span>{t("detail.trackers.peers")}: {tr.scrape_incomplete}</span>}
                  {tr.scrape_downloaded > 0 && <span>{t("detail.trackers.downloaded")}: {tr.scrape_downloaded}</span>}
                  {scrapeAge && <span>{t("detail.trackers.scraped")}: {scrapeAge}</span>}
                  {interval && <span>{t("detail.trackers.interval")}: {interval}</span>}
                </div>
              </div>
              <button
                onClick={() => handleToggle(i, tr.url, !enabled)}
                className="w-8 h-4 rounded-full relative transition-colors shrink-0"
                style={{
                  background: enabled ? "var(--accent)" : "var(--bg-tertiary)",
                  border: `1px solid ${enabled ? "var(--accent)" : "var(--border)"}`,
                }}
                title={enabled ? t("common.enabled") : ""}
              >
                <div
                  className="absolute top-0.5 w-2.5 h-2.5 rounded-full transition-all"
                  style={{
                    background: enabled ? "white" : "var(--text-secondary)",
                    left: enabled ? "calc(100% - 14px)" : "2px",
                  }}
                />
              </button>
            </div>
          );
        })}
      </div>
      {capabilities?.has_tracker_insert && (
        <div className="flex gap-1 items-center mt-1">
          <input
            type="text"
            value={addUrl}
            onChange={(e) => setAddUrl(e.target.value)}
            placeholder={t("detail.trackers.trackerUrl")}
            className="flex-1 px-2 py-0.5 rounded text-xs outline-none"
            style={INPUT_STYLE}
            onKeyDown={(e) => { if (e.key === "Enter") handleAddTracker(); }}
          />
          <input
            type="number"
            value={addGroup}
            onChange={(e) => setAddGroup(Number(e.target.value) || 0)}
            className="w-12 px-1 py-0.5 rounded text-xs outline-none text-center"
            style={INPUT_STYLE}
            title={t("detail.trackers.group")}
          />
          <button
            onClick={handleAddTracker}
            className="px-2 py-0.5 rounded text-xs"
            style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
          >
            {t("common.add")}
          </button>
        </div>
      )}
    </div>
  );
}
