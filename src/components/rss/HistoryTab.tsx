import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api";
import type { RssDownloadRecord } from "../../types";
import { formatDate, formatEpisode } from "../../format";
import { useDialog } from "../AppDialog";
import { SmallButton } from "./SmallButton";

/** History tab: filterable RSS download history with clear. */
export function HistoryTab() {
  const { t } = useTranslation();
  const dialog = useDialog();
  const [records, setRecords] = useState<RssDownloadRecord[]>([]);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api
      .rssGetHistory(500)
      .then(setRecords)
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const filtered = filter
    ? records.filter((r) =>
        r.title.toLowerCase().includes(filter.toLowerCase()),
      )
    : records;

  async function handleClear() {
    if (!(await dialog.confirm(t("dialog.clearHistory")))) return;
    try {
      setError(null);
      await api.rssClearHistory();
      refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex items-center gap-2">
        <span
          className="text-sm font-medium"
          style={{ color: "var(--text-primary)" }}
        >
          {t("rss.history.title")}
        </span>
        <div className="flex-1" />
        <input
          type="text"
          placeholder={t("common.filter")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="px-2 rounded text-xs"
          style={{
            background: "var(--bg-tertiary)",
            color: "var(--text-primary)",
            border: `1px solid ${filter ? "var(--accent)" : "var(--border)"}`,
            width: "160px",
            height: "24px",
            outline: "none",
          }}
        />
        <SmallButton label={t("common.clear")} onClick={handleClear} variant="danger" />
      </div>

      {error && (
        <div className="text-xs" style={{ color: "var(--danger)" }}>
          {error}
        </div>
      )}

      <div
        className="flex-1 min-h-0 overflow-auto rounded text-xs"
        style={{ border: "1px solid var(--border)" }}
      >
        <table className="w-full">
          <thead>
            <tr
              style={{
                background: "var(--bg-secondary)",
                color: "var(--text-secondary)",
                position: "sticky",
                top: 0,
              }}
            >
              <th className="text-left px-2 py-1 font-medium w-[130px]">
                {t("rss.history.time")}
              </th>
              <th className="text-left px-2 py-1 font-medium w-[80px]">
                {t("rss.history.feed")}
              </th>
              <th className="text-left px-2 py-1 font-medium w-[80px]">
                {t("rss.history.rule")}
              </th>
              <th className="text-left px-2 py-1 font-medium">{t("rss.history.titleCol")}</th>
              <th className="text-left px-2 py-1 font-medium w-[60px]">{t("rss.history.ep")}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr
                key={i}
                style={{
                  borderTop: "1px solid var(--border)",
                  color: "var(--text-primary)",
                }}
              >
                <td className="px-2 py-1 whitespace-nowrap">
                  {formatDate(r.timestamp)}
                </td>
                <td className="px-2 py-1 truncate">{r.feed}</td>
                <td className="px-2 py-1 truncate">{r.rule}</td>
                <td className="px-2 py-1 truncate max-w-0">{r.title}</td>
                <td className="px-2 py-1 whitespace-nowrap">
                  {r.season > 0 ? formatEpisode(r.season, r.episode) : "-"}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-2 py-4 text-center"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {records.length === 0 ? t("rss.history.noHistory") : t("rss.history.noMatches")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
