import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { loadJSON, saveJSON } from "../prefs";
import { SortLabel } from "./icons";
import { useEscapeClose, useKeepInViewport } from "./ui";
import type { Torrent, SortField } from "../types";
import { torrentStatus, torrentRatio, torrentProgress, torrentEta, torrentPriorityName } from "../torrent";
import { formatSize, formatRate, formatEta, formatDate } from "../format";

/** Props for the torrent list table. */
interface TorrentTableProps {
  torrents: Torrent[];
  selectedHashes: Set<string>;
  sortField: SortField;
  sortAsc: boolean;
  onSelect: (hash: string, e: React.MouseEvent) => void;
  onSort: (field: SortField) => void;
  onContextMenu: (e: React.MouseEvent, torrent: Torrent, hashes: string[]) => void;
}

/** Torrent table column: label key, sort field, alignment and width limits. */
interface ColumnDef {
  key: string;
  field: SortField;
  align?: "right";
  defaultWidth: number;
  minWidth: number;
  defaultHidden?: boolean;
}

/** Every torrent table column, in default order. */
const COLUMNS: ColumnDef[] = [
  { key: "table.name", field: "name", defaultWidth: 300, minWidth: 100 },
  { key: "table.size", field: "size", align: "right", defaultWidth: 90, minWidth: 50 },
  { key: "table.done", field: "progress", defaultWidth: 140, minWidth: 80 },
  { key: "table.eta", field: "eta", align: "right", defaultWidth: 75, minWidth: 40 },
  { key: "table.down", field: "down", align: "right", defaultWidth: 100, minWidth: 50 },
  { key: "table.up", field: "up", align: "right", defaultWidth: 100, minWidth: 50 },
  { key: "table.ratio", field: "ratio", align: "right", defaultWidth: 65, minWidth: 40 },
  { key: "table.seeds", field: "seeds", align: "right", defaultWidth: 58, minWidth: 35 },
  { key: "table.peers", field: "peers", align: "right", defaultWidth: 58, minWidth: 35 },
  { key: "table.seedsPeers", field: "swarm", align: "right", defaultWidth: 80, minWidth: 45, defaultHidden: true },
  { key: "table.status", field: "status", defaultWidth: 100, minWidth: 50 },
  { key: "table.priority", field: "priority", defaultWidth: 68, minWidth: 40, defaultHidden: true },
  { key: "table.label", field: "label", defaultWidth: 100, minWidth: 50, defaultHidden: true },
  { key: "table.added", field: "added", defaultWidth: 140, minWidth: 60, defaultHidden: true },
  { key: "table.uploaded", field: "uploaded", align: "right", defaultWidth: 90, minWidth: 50, defaultHidden: true },
  { key: "table.downloaded", field: "downloaded", align: "right", defaultWidth: 90, minWidth: 50, defaultHidden: true },
  { key: "table.created", field: "created", defaultWidth: 140, minWidth: 60, defaultHidden: true },
];

/** Columns keyed by sort field. */
const COL = Object.fromEntries(COLUMNS.map((c) => [c.field, c])) as Record<SortField, ColumnDef>;

/** Header menu entries in groups, null for a divider, fixed whatever order the columns are in. */
const COLUMN_MENU: (ColumnDef | null)[] = [
  COL.name, COL.status, COL.priority, COL.label,
  null,
  COL.size, COL.progress, COL.eta, COL.down, COL.up, COL.ratio,
  null,
  COL.uploaded, COL.downloaded,
  null,
  COL.seeds, COL.peers, COL.swarm,
  null,
  COL.added, COL.created,
];

/** Columns shown when no visibility is saved. */
const DEFAULT_VISIBLE = new Set(
  COLUMNS.filter((c) => !c.defaultHidden).map((c) => c.field),
);

/** Storage key for the column widths. */
const STORAGE_KEY_WIDTHS = "ctrlr:col-widths";
/** Storage key for the visible columns. */
const STORAGE_KEY_VISIBLE = "ctrlr:col-visible";
/** Storage key for the column order. */
const STORAGE_KEY_ORDER = "ctrlr:col-order";

/** Column order used when none is saved, and the set a saved order is checked against. */
const DEFAULT_ORDER = COLUMNS.map((c) => c.field);

/** Persisted column widths, keyed by field. */
function loadWidths(): Record<string, number> {
  return loadJSON<Record<string, number>>(STORAGE_KEY_WIDTHS, {});
}

/** Persisted set of visible columns. */
function loadVisible(): Set<string> {
  return new Set(loadJSON<string[]>(STORAGE_KEY_VISIBLE, [...DEFAULT_VISIBLE]));
}

/** Persisted column order, reconciled against the columns that exist now. */
function loadOrder(): SortField[] {
  const parsed = loadJSON<SortField[]>(STORAGE_KEY_ORDER, DEFAULT_ORDER);
  const known = new Set(DEFAULT_ORDER);
  const saved = parsed.filter((f) => known.has(f));
  const missing = DEFAULT_ORDER.filter((f) => !saved.includes(f));
  return [...saved, ...missing];
}

/** Progress bar fill color for a status key. */
function progressColor(status: string): string {
  switch (status) {
    case "status.downloading":
      return "var(--accent-dim)";
    case "status.seeding":
      return "var(--success)";
    case "status.hashing":
      return "var(--warning)";
    default:
      return "var(--border)";
  }
}

/** Status text color for a status key. */
function statusColor(status: string): string {
  switch (status) {
    case "status.downloading":
      return "var(--accent)";
    case "status.seeding":
      return "var(--success)";
    case "status.stopped":
    case "status.paused":
      return "var(--text-secondary)";
    case "status.hashing":
    case "status.metadata":
      return "var(--warning)";
    default:
      return "var(--text-primary)";
  }
}

/** Render one torrent's cell content for a column. */
function renderCell(tor: Torrent, field: SortField, status: string, t: (key: string) => string) {
  switch (field) {
    case "name":
      return <span className="truncate block">{tor.name}</span>;
    case "size":
      return <span className="whitespace-nowrap">{formatSize(tor.size_bytes)}</span>;
    case "progress":
      return (
        <div className="flex items-center gap-1.5">
          <div
            className="flex-1 h-[10px] rounded-sm overflow-hidden"
            style={{ background: "var(--bg-secondary)", minWidth: "40px" }}
          >
            <div
              className="h-full rounded-sm"
              style={{
                width: `${Math.min(torrentProgress(tor), 100)}%`,
                background: progressColor(status),
                opacity: 0.8,
              }}
            />
          </div>
          <span className="text-right w-[38px] shrink-0">
            {torrentProgress(tor).toFixed(1)}%
          </span>
        </div>
      );
    case "eta":
      return <span className="whitespace-nowrap">{formatEta(torrentEta(tor))}</span>;
    case "down":
      return <span className="whitespace-nowrap">{formatRate(tor.down_rate)}</span>;
    case "up":
      return <span className="whitespace-nowrap">{formatRate(tor.up_rate)}</span>;
    case "ratio":
      return <span>{torrentRatio(tor).toFixed(2)}</span>;
    case "seeds":
      return <span>{tor.seeds_connected}</span>;
    case "peers":
      return <span>{tor.peers_connected}</span>;
    case "status":
      return (
        <span className="whitespace-nowrap" style={{ color: statusColor(status) }}>
          {t(status)}
        </span>
      );
    case "priority":
      return <span>{t(torrentPriorityName(tor.priority))}</span>;
    case "label":
      return (
        <span className="truncate block" style={{ color: "var(--text-secondary)" }}>
          {tor.tags.join(", ") || "-"}
        </span>
      );
    case "added":
      return <span className="whitespace-nowrap">{formatDate(tor.date_added)}</span>;
    case "uploaded":
      return <span className="whitespace-nowrap">{formatSize(tor.up_total)}</span>;
    case "downloaded":
      return <span className="whitespace-nowrap">{formatSize(tor.down_total)}</span>;
    case "created":
      return <span className="whitespace-nowrap">{formatDate(tor.date_created)}</span>;
    case "swarm":
      return <span className="whitespace-nowrap">{tor.seeds_connected} / {tor.peers_connected}</span>;
  }
}

/** Header right-click menu of column checkboxes, closed by Escape and kept in the viewport. */
function ColumnMenu({
  x,
  y,
  visibleCols,
  onToggle,
  onClose,
}: {
  x: number;
  y: number;
  visibleCols: Set<string>;
  onToggle: (field: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  useEscapeClose(onClose);
  useKeepInViewport(ref, x, y);

  return (
    <div
      ref={ref}
      className="fixed z-50 py-1 rounded shadow-lg text-xs"
      style={{
        left: x,
        top: y,
        background: "var(--bg-secondary)",
        border: "1px solid var(--border)",
        minWidth: "140px",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {COLUMN_MENU.map((item, i) =>
        item === null ? (
          <div key={i} className="my-1" style={{ borderTop: "1px solid var(--border)" }} />
        ) : (
          <label
            key={item.field}
            className="flex items-center gap-2 px-3 py-1 cursor-pointer hover:brightness-125"
          >
            <input
              type="checkbox"
              checked={visibleCols.has(item.field)}
              onChange={() => onToggle(item.field)}
              className="accent-sky-500"
            />
            {t(item.key)}
          </label>
        ),
      )}
    </div>
  );
}

/** Torrent list; headers sort on click and reorder on drag, and column layout persists locally. */
export function TorrentTable({
  torrents,
  selectedHashes,
  sortField,
  sortAsc,
  onSelect,
  onSort,
  onContextMenu,
}: TorrentTableProps) {
  const { t } = useTranslation();
  const [colWidths, setColWidths] = useState<Record<string, number>>(loadWidths);
  const [visibleCols, setVisibleCols] = useState<Set<string>>(loadVisible);
  const [colOrder, setColOrder] = useState<SortField[]>(loadOrder);
  const [headerMenu, setHeaderMenu] = useState<{ x: number; y: number } | null>(null);
  const colWidthsRef = useRef(colWidths);
  colWidthsRef.current = colWidths;
  const resizeRef = useRef<{
    field: string;
    startX: number;
    startWidth: number;
  } | null>(null);
  const colDragRef = useRef<{ field: SortField; startX: number; dragging: boolean } | null>(null);
  const [draggingField, setDraggingField] = useState<SortField | null>(null);
  const [dropTarget, setDropTarget] = useState<{ field: SortField; side: "left" | "right" } | null>(null);
  const theadRef = useRef<HTMLTableSectionElement>(null);

  useEffect(() => {
    saveJSON(STORAGE_KEY_VISIBLE, [...visibleCols]);
  }, [visibleCols]);

  useEffect(() => {
    saveJSON(STORAGE_KEY_ORDER, colOrder);
  }, [colOrder]);

  useEffect(() => {
    if (!headerMenu) return;
    const handler = () => setHeaderMenu(null);
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [headerMenu]);

  const onResizeStart = useCallback(
    (e: React.MouseEvent, field: string, minWidth: number) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;

      // measured, since the stored width can be missing or differ from the laid-out one
      const th = theadRef.current?.querySelector(`th[data-field="${field}"]`);
      const startWidth = th ? th.getBoundingClientRect().width : (colWidthsRef.current[field] ?? 80);

      resizeRef.current = { field, startX, startWidth };

      const onMove = (ev: MouseEvent) => {
        if (!resizeRef.current) return;
        const { field: resField, startX: resStartX, startWidth: resStartWidth } = resizeRef.current;
        const delta = ev.clientX - resStartX;
        const newWidth = Math.max(minWidth, resStartWidth + delta);
        setColWidths((prev) => ({ ...prev, [resField]: newWidth }));
      };

      document.body.style.cursor = "ew-resize";

      const onUp = () => {
        resizeRef.current = null;
        document.body.style.cursor = "";
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        saveJSON(STORAGE_KEY_WIDTHS, colWidthsRef.current);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [],
  );

  const onColDragStart = useCallback(
    (e: React.MouseEvent, field: SortField) => {
      if (e.button !== 0 || resizeRef.current) return;
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      colDragRef.current = { field, startX, dragging: false };
      let ghost: HTMLElement | null = null;

      const THRESHOLD = 5;

      const createGhost = (sourceEl: Element) => {
        ghost = document.createElement("div");
        ghost.textContent = sourceEl.textContent;
        Object.assign(ghost.style, {
          position: "fixed",
          top: `${startY - 12}px`,
          left: `${startX}px`,
          padding: "2px 8px",
          fontSize: "11px",
          fontWeight: "500",
          color: "var(--accent)",
          background: "var(--bg-tertiary)",
          border: "1px solid var(--accent)",
          borderRadius: "3px",
          pointerEvents: "none",
          zIndex: "9999",
          opacity: "0.9",
          whiteSpace: "nowrap",
        });
        document.body.appendChild(ghost);
      };

      const findDropTarget = (clientX: number): { field: SortField; side: "left" | "right" } | null => {
        const thead = theadRef.current;
        if (!thead) return null;
        const ths = thead.querySelectorAll<HTMLElement>("th[data-field]");
        for (const th of ths) {
          const f = th.dataset.field as SortField;
          if (f === field) continue;
          const rect = th.getBoundingClientRect();
          if (clientX >= rect.left && clientX <= rect.right) {
            const midX = rect.left + rect.width / 2;
            return { field: f, side: clientX < midX ? "left" : "right" };
          }
        }
        return null;
      };

      const onMove = (ev: MouseEvent) => {
        const drag = colDragRef.current;
        if (!drag) return;
        if (!drag.dragging && Math.abs(ev.clientX - drag.startX) >= THRESHOLD) {
          drag.dragging = true;
          document.body.style.cursor = "grabbing";
          setDraggingField(drag.field);
          const th = theadRef.current?.querySelector(`th[data-field="${field}"]`);
          if (th) createGhost(th);
        }
        if (drag.dragging) {
          if (ghost) {
            ghost.style.left = `${ev.clientX}px`;
            ghost.style.top = `${ev.clientY - 12}px`;
          }
          setDropTarget(findDropTarget(ev.clientX));
        }
      };

      const onUp = (ev: MouseEvent) => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        const drag = colDragRef.current;
        colDragRef.current = null;
        document.body.style.cursor = "";
        setDraggingField(null);
        if (ghost) { ghost.remove(); ghost = null; }

        if (!drag?.dragging) {
          onSort(field);
          return;
        }

        const target = findDropTarget(ev.clientX);
        setDropTarget(null);
        if (!target) return;

        setColOrder((prev) => {
          const next = prev.filter((f) => f !== field);
          let toIdx = next.indexOf(target.field);
          if (target.side === "right") toIdx += 1;
          next.splice(toIdx, 0, field);
          return next;
        });
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [onSort],
  );

  const toggleColumn = useCallback((field: string) => {
    setVisibleCols((prev) => {
      const next = new Set(prev);
      if (next.has(field)) {
        if (next.size <= 1) return prev;
        next.delete(field);
      } else {
        next.add(field);
      }
      return next;
    });
    setColOrder((prev) =>
      prev.includes(field as SortField) ? prev : [...prev, field as SortField],
    );
  }, []);

  const colMap = useMemo(() => new Map(COLUMNS.map((c) => [c.field, c])), []);
  const visible = colOrder
    .filter((f) => visibleCols.has(f) && colMap.has(f))
    .map((f) => colMap.get(f)!);

  if (torrents.length === 0) {
    return (
      <div
        className="flex items-center justify-center h-full text-sm"
        style={{ color: "var(--text-secondary)" }}
      >
        {t("table.noTorrents")}
      </div>
    );
  }

  return (
    <>
      <table
        className="border-collapse text-xs"
        style={{
          tableLayout: "fixed",
          width: "100%",
          minWidth: `${32 + visible.reduce((sum, c) => sum + (colWidths[c.field] ?? c.defaultWidth), 0)}px`,
        }}
      >
        <colgroup>
          <col style={{ width: "32px" }} />
          {visible.map((col) => {
            const w = colWidths[col.field];
            // name column takes the leftover width unless the user resized it
            if (col.field === "name") {
              return w != null
                ? <col key={col.field} style={{ width: `${w}px` }} />
                : <col key={col.field} />;
            }
            return <col key={col.field} style={{ width: `${w ?? col.defaultWidth}px` }} />;
          })}
        </colgroup>
        <thead ref={theadRef}>
          <tr
            style={{ background: "var(--bg-secondary)" }}
            onContextMenu={(e) => {
              e.preventDefault();
              setHeaderMenu({ x: e.clientX, y: e.clientY });
            }}
          >
            <th className="px-2 py-1 text-left font-medium">#</th>
            {visible.map((col) => (
              <th
                key={col.field}
                data-field={col.field}
                onMouseDown={(e) => onColDragStart(e, col.field)}
                className="relative px-2 py-1 font-medium cursor-pointer select-none whitespace-nowrap"
                style={{
                  textAlign: col.align ?? "left",
                  opacity: draggingField === col.field ? 0.15 : 1,
                  color:
                    sortField === col.field
                      ? "var(--accent)"
                      : "var(--text-secondary)",
                }}
              >
                {dropTarget?.field === col.field && (
                  <div
                    className="absolute top-0 h-full pointer-events-none"
                    style={{
                      width: "3px",
                      background: "var(--accent)",
                      [dropTarget.side === "left" ? "left" : "right"]: "-1px",
                    }}
                  />
                )}
                <SortLabel label={t(col.key)} sorted={sortField === col.field} asc={sortAsc} align={col.align === "right" ? "right" : "left"} />
                {/* handle stays inside the th; past the last column it adds a phantom scrollbar */}
                <div
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    onResizeStart(e, col.field, col.minWidth);
                  }}
                  onMouseEnter={() => {
                    const el = document.getElementById(`resize-${col.field}`);
                    if (el) el.style.background = "var(--accent)";
                  }}
                  onMouseLeave={() => {
                    const el = document.getElementById(`resize-${col.field}`);
                    if (el) el.style.background = "var(--border)";
                  }}
                  className="absolute top-0 h-full"
                  style={{ width: "7px", right: "0", cursor: "ew-resize", zIndex: 1 }}
                >
                  <div
                    id={`resize-${col.field}`}
                    className="absolute top-0 h-full pointer-events-none"
                    style={{
                      width: "2px",
                      right: "0",
                      background: "var(--border)",
                    }}
                  />
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {torrents.map((tor, i) => {
            const status = torrentStatus(tor);
            const isSelected = selectedHashes.has(tor.hash);
            return (
              <tr
                key={tor.hash}
                onClick={(e) => onSelect(tor.hash, e)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  // read selection now; the update from onSelect never reaches this closure
                  const hashes = selectedHashes.has(tor.hash)
                    ? [...selectedHashes]
                    : [tor.hash];
                  if (!selectedHashes.has(tor.hash)) {
                    onSelect(tor.hash, e);
                  }
                  onContextMenu(e, tor, hashes);
                }}
                className="cursor-pointer"
                style={{
                  background: isSelected
                    ? "var(--bg-tertiary)"
                    : i % 2 === 0
                      ? "var(--bg-primary)"
                      : "var(--bg-secondary)",
                }}
              >
                <td
                  className="px-2 py-1"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {i + 1}
                </td>
                {visible.map((col) => (
                  <td
                    key={col.field}
                    className="px-2 py-1 overflow-hidden whitespace-nowrap text-ellipsis"
                    style={{ textAlign: col.align ?? "left" }}
                  >
                    {renderCell(tor, col.field, status, t)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>

      {headerMenu && (
        <ColumnMenu
          x={headerMenu.x}
          y={headerMenu.y}
          visibleCols={visibleCols}
          onToggle={toggleColumn}
          onClose={() => setHeaderMenu(null)}
        />
      )}
    </>
  );
}
