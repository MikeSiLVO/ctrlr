import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import * as api from "../api";
import type { HistorySort, TorrentHistoryEntry, TorrentHistoryPage } from "../types";
import { formatSize, formatDate } from "../format";
import { loadBool, loadString, savePref } from "../prefs";
import { DialogShell } from "./ui";
import { Select } from "./Select";
import { SortLabel } from "./icons";

/** Props for the torrent history dialog. */
interface HistoryDialogProps {
  onClose: () => void;
}

/** Entries per history page. */
const PAGE_SIZE = 50;

/** Sortable History column and its direction. */
interface HistorySortState {
  field: HistorySort;
  desc: boolean;
}

/** Columns a saved sort may name. */
const SORT_FIELDS: HistorySort[] = ["name", "size", "added", "status"];

/** Load the saved History sort, newest first when none is saved or it names no column. */
function loadSort(): HistorySortState {
  const field = loadString("ctrlr:history-sort-field", "") as HistorySort;
  if (!SORT_FIELDS.includes(field)) return { field: "added", desc: true };
  return { field, desc: loadBool("ctrlr:history-sort-desc", false) };
}

/** Use the translated status filter options; the empty value means any status. */
function useStatusOptions() {
  const { t } = useTranslation();
  return [
    { value: "", label: t("history.allStatuses") },
    { value: "active", label: t("history.active") },
    { value: "removed", label: t("history.removed") },
  ];
}

/** Use the translated source filter options; the empty value means all sources. */
function useSourceOptions() {
  const { t } = useTranslation();
  return [
    { value: "", label: t("history.allSources") },
    { value: "file", label: t("history.file") },
    { value: "magnet", label: t("history.magnet") },
    { value: "rss", label: t("history.rss") },
  ];
}

/** Colored badge naming how a history entry was added. */
function SourceBadge({ source }: { source: string }) {
  const colors: Record<string, string> = {
    file: "var(--accent)",
    magnet: "#a78bfa",
    rss: "#f59e0b",
  };
  return (
    <span
      className="px-1.5 py-0.5 rounded text-[10px] font-medium uppercase"
      style={{
        background: `${colors[source] || "var(--border)"}22`,
        color: colors[source] || "var(--text-secondary)",
        border: `1px solid ${colors[source] || "var(--border)"}44`,
      }}
    >
      {source}
    </span>
  );
}

/** History dialog: paginated, searchable torrent history with export, re-add and delete. */
export function HistoryDialog({ onClose }: HistoryDialogProps) {
  const { t } = useTranslation();
  const sourceOptions = useSourceOptions();
  const statusOptions = useStatusOptions();
  const [data, setData] = useState<TorrentHistoryPage>({ entries: [], total: 0 });
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sort, setSort] = useState(loadSort);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let current = true;
    setLoading(true);
    api.historyList({
      page,
      page_size: PAGE_SIZE,
      search: search || null,
      source: sourceFilter || null,
      loaded: statusFilter ? statusFilter === "active" : null,
      sort: sort.field,
      desc: sort.desc,
    })
      .then((result) => { if (current) setData(result); })
      .catch(() => {}) // previous page stays shown
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [page, search, sourceFilter, statusFilter, sort, reload]);

  useEffect(() => {
    const unlisten = listen("history-synced", () => setReload((n) => n + 1));
    return () => { unlisten.then((f) => f()); };
  }, []);

  function handleSort(field: HistorySort) {
    const next = { field, desc: field === sort.field && !sort.desc };
    setSort(next);
    setPage(0);
    savePref("ctrlr:history-sort-field", next.field);
    savePref("ctrlr:history-sort-desc", next.desc);
  }

  const [searchInput, setSearchInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  async function handleExport(entry: TorrentHistoryEntry) {
    if (!entry.has_blob) return;
    try {
      setError(null);
      const blob = await api.historyGetBlob(entry.id);
      if (!blob) return;
      await api.saveTorrentAs(blob, entry.name);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleDelete(entry: TorrentHistoryEntry) {
    try {
      setError(null);
      await api.historyDelete(entry.id);
      setReload((n) => n + 1);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleReAdd(entry: TorrentHistoryEntry) {
    if (!entry.has_blob) return;
    try {
      setError(null);
      const blob = await api.historyGetBlob(entry.id);
      if (blob) {
        await api.addTorrentFile(blob);
      }
    } catch (e) {
      setError(String(e));
    }
  }

  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const blobCount = data.entries.filter((e) => e.has_blob).length;

  return (
    <DialogShell
      onClose={onClose}
      panelClassName="rounded-lg flex flex-col"
      panelStyle={{ width: "860px", height: "560px" }}
    >
        <div
          className="flex items-center gap-3 px-4 py-3 shrink-0"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <span
            className="text-sm font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            {t("history.title")}
          </span>
          <div className="flex-1" />
          <input
            type="text"
            placeholder={t("common.search")}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="px-2 py-1 rounded text-xs"
            style={{
              background: "var(--bg-secondary)",
              color: "var(--text-primary)",
              border: `1px solid ${searchInput ? "var(--accent)" : "var(--border)"}`,
              width: "200px",
              outline: "none",
            }}
          />
          <Select
            value={sourceFilter}
            onChange={(v) => { setSourceFilter(v); setPage(0); }}
            options={sourceOptions}
            compact
            style={{ width: "130px" }}
          />
          <Select
            value={statusFilter}
            onChange={(v) => { setStatusFilter(v); setPage(0); }}
            options={statusOptions}
            compact
            style={{ width: "130px" }}
          />
          <button
            type="button"
            onClick={onClose}
            className="px-2 py-1 rounded text-xs"
            style={{
              background: "var(--bg-tertiary)",
              color: "var(--text-primary)",
            }}
          >
            {t("common.close")}
          </button>
        </div>

        {error && (
          <div className="px-3 py-2 text-xs" style={{ color: "var(--danger)" }}>
            {error}
          </div>
        )}

        <div className="flex-1 overflow-auto min-h-0">
          <table
            className="w-full text-xs"
            style={{ borderCollapse: "collapse" }}
          >
            <thead>
              <tr
                style={{
                  background: "var(--bg-secondary)",
                  position: "sticky",
                  top: 0,
                  zIndex: 1,
                }}
              >
                <SortHeader label={t("history.name")} field="name" sort={sort} onSort={handleSort} width="40%" />
                <SortHeader label={t("history.size")} field="size" sort={sort} onSort={handleSort} width="10%" right />
                <th
                  className="text-center px-3 py-2 font-medium"
                  style={{ color: "var(--text-secondary)", width: "10%" }}
                >
                  {t("history.source")}
                </th>
                <SortHeader label={t("history.added")} field="added" sort={sort} onSort={handleSort} width="15%" />
                <SortHeader label={t("history.status")} field="status" sort={sort} onSort={handleSort} width="12%" />
                <th
                  className="text-center px-3 py-2 font-medium"
                  style={{ color: "var(--text-secondary)", width: "1%", whiteSpace: "nowrap" }}
                >
                  {t("history.actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((entry) => (
                <tr
                  key={entry.id}
                  className="hover:bg-[var(--bg-secondary)]"
                  style={{ borderBottom: "1px solid var(--border)" }}
                >
                  <td
                    className="px-3 py-1.5 truncate"
                    style={{ color: "var(--text-primary)", maxWidth: 0 }}
                    title={`${entry.name}\n${entry.info_hash}`}
                  >
                    {entry.name || entry.info_hash}
                  </td>
                  <td
                    className="px-3 py-1.5 text-right whitespace-nowrap"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {entry.total_size > 0 ? formatSize(entry.total_size) : "-"}
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    <SourceBadge source={entry.source} />
                  </td>
                  <td
                    className="px-3 py-1.5 whitespace-nowrap"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {formatDate(entry.added_at)}
                  </td>
                  <td
                    className="px-3 py-1.5 whitespace-nowrap"
                    style={{ color: entry.loaded ? "var(--accent)" : "var(--text-secondary)" }}
                  >
                    {entry.loaded ? t("history.active") : t("history.removed")}
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    <div className="flex items-center justify-center gap-1">
                      {entry.has_blob && (
                        <ActionBtn
                          label={t("history.save")}
                          title={t("history.exportTorrent")}
                          onClick={() => handleExport(entry)}
                        />
                      )}
                      {entry.has_blob && !entry.loaded && (
                        <ActionBtn
                          label={t("history.reAdd")}
                          title={t("history.addBack")}
                          onClick={() => handleReAdd(entry)}
                        />
                      )}
                      <ActionBtn
                        label={t("history.del")}
                        title={t("history.deleteEntry")}
                        onClick={() => handleDelete(entry)}
                        danger
                      />
                    </div>
                  </td>
                </tr>
              ))}
              {data.entries.length === 0 && !loading && (
                <tr>
                  <td
                    colSpan={6}
                    className="text-center py-8"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {search || sourceFilter || statusFilter ? t("history.noMatching") : t("history.noHistory")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div
          className="flex items-center gap-3 px-4 py-2 shrink-0 text-xs"
          style={{
            borderTop: "1px solid var(--border)",
            color: "var(--text-secondary)",
          }}
        >
          <span>
            {t("history.entryCount", { count: data.total })}
            {blobCount > 0 && ` \u00B7 ${blobCount} ${t("history.withTorrent")}`}
          </span>
          <div className="flex-1" />
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
            className="px-2 py-1 rounded disabled:opacity-30"
            style={{
              background: "var(--bg-tertiary)",
              color: "var(--text-primary)",
            }}
          >
            {t("common.prev")}
          </button>
          <span style={{ color: "var(--text-primary)" }}>
            {page + 1} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages - 1}
            onClick={() => setPage(page + 1)}
            className="px-2 py-1 rounded disabled:opacity-30"
            style={{
              background: "var(--bg-tertiary)",
              color: "var(--text-primary)",
            }}
          >
            {t("common.next")}
          </button>
        </div>
    </DialogShell>
  );
}

/** History column header that sorts on click, accent colored while it holds the sort. */
function SortHeader({ label, field, sort, onSort, width, right }: {
  label: string;
  field: HistorySort;
  sort: HistorySortState;
  onSort: (field: HistorySort) => void;
  width: string;
  right?: boolean;
}) {
  const sorted = sort.field === field;
  return (
    <th
      onClick={() => onSort(field)}
      className="px-3 py-2 font-medium cursor-pointer select-none"
      style={{
        color: sorted ? "var(--accent)" : "var(--text-secondary)",
        textAlign: right ? "right" : "left",
        width,
      }}
    >
      <SortLabel label={label} sorted={sorted} asc={!sort.desc} align={right ? "right" : "left"} />
    </th>
  );
}

/** Small history row action button, red when destructive. */
function ActionBtn({
  label,
  title,
  onClick,
  danger,
}: {
  label: string;
  title: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap transition-colors"
      style={{
        background: "var(--bg-tertiary)",
        color: danger ? "#ef4444" : "var(--text-primary)",
      }}
    >
      {label}
    </button>
  );
}
