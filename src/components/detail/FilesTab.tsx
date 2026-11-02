import { useState, useEffect, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { Torrent, TorrentFile, ServerCapabilities } from "../../types";
import { formatSize } from "../../format";
import * as api from "../../api";
import { Select } from "../Select";
import { ContextMenu } from "../ContextMenu";
import { ChevronIcon, SortLabel } from "../icons";
import { loadJSON, saveJSON } from "../../prefs";

/** Files tab tree node, a folder or a file. */
interface FileTreeNode {
  name: string;
  path: string;
  file?: TorrentFile;
  children: Map<string, FileTreeNode>;
  totalSize: number;
  completedSize: number;
  minIndex: number;
  maxPriority: number;
}

/** Files tab column a sort can key on. */
type FileSortKey = "index" | "name" | "size" | "done" | "priority";

/** Files tab sort column and direction. */
interface FileSort { key: FileSortKey; asc: boolean }

/** Storage key for the Files tab sort. */
const FILE_SORT_STORAGE = "ctrlr:files-sort";

/** Every Files tab sort key, for checking a stored sort. */
const FILE_SORT_KEYS: FileSortKey[] = ["index", "name", "size", "done", "priority"];

/** Files tab sort used when none is saved. */
const DEFAULT_FILE_SORT: FileSort = { key: "name", asc: true };

/** Load the saved Files tab sort, or name ascending when no valid one is stored. */
function loadFileSort(): FileSort {
  const saved = loadJSON<FileSort>(FILE_SORT_STORAGE, DEFAULT_FILE_SORT);
  return FILE_SORT_KEYS.includes(saved.key) ? { key: saved.key, asc: saved.asc !== false } : DEFAULT_FILE_SORT;
}

/** Value a node sorts by; a folder uses its totals, lowest file index and highest priority. */
function fileSortValue(node: FileTreeNode, key: FileSortKey): number {
  switch (key) {
    case "index": return node.minIndex;
    case "size": return node.totalSize;
    case "done": return node.totalSize === 0 ? 0 : node.completedSize / node.totalSize;
    case "priority": return node.maxPriority;
    case "name": return 0;
  }
}

/** Compare siblings: folders first, then by the sort key, then by name. */
function compareFileNodes(a: FileTreeNode, b: FileTreeNode, sort: FileSort): number {
  const aIsDir = !a.file && a.children.size > 0;
  const bIsDir = !b.file && b.children.size > 0;
  if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
  const byName = a.name.localeCompare(b.name, undefined, { numeric: true });
  const diff = sort.key === "name" ? byName : fileSortValue(a, sort.key) - fileSortValue(b, sort.key);
  if (diff !== 0) return sort.asc ? diff : -diff;
  return byName;
}

/** Paths of every folder below the root. */
function subfolderPaths(root: FileTreeNode): string[] {
  const paths: string[] = [];
  function walk(n: FileTreeNode) {
    for (const child of n.children.values()) {
      if (!child.file && child.children.size > 0) {
        paths.push(child.path);
        walk(child);
      }
    }
  }
  walk(root);
  return paths;
}

/** Build the file tree under a root named after the torrent, with folder totals filled in. */
function buildFileTree(files: TorrentFile[], torrentName: string): FileTreeNode {
  const wrapper: FileTreeNode = {
    name: torrentName, path: torrentName, children: new Map(),
    totalSize: 0, completedSize: 0, minIndex: 0, maxPriority: 0,
  };
  for (const f of files) {
    const parts = f.path.split("/");
    let node = wrapper;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const fullPath = torrentName + "/" + parts.slice(0, i + 1).join("/");
      if (!node.children.has(part)) {
        node.children.set(part, {
          name: part,
          path: fullPath,
          children: new Map(),
          totalSize: 0,
          completedSize: 0,
          minIndex: 0,
          maxPriority: 0,
        });
      }
      node = node.children.get(part)!;
    }
    node.file = f;
  }
  function aggregate(node: FileTreeNode): void {
    if (node.file) {
      node.totalSize = node.file.size_bytes;
      const pct = node.file.size_chunks === 0 ? 0 : node.file.completed_chunks / node.file.size_chunks;
      node.completedSize = Math.round(node.file.size_bytes * pct);
      node.minIndex = node.file.index;
      node.maxPriority = node.file.priority;
      return;
    }
    node.totalSize = 0;
    node.completedSize = 0;
    node.minIndex = Infinity;
    node.maxPriority = 0;
    for (const child of node.children.values()) {
      aggregate(child);
      node.totalSize += child.totalSize;
      node.completedSize += child.completedSize;
      node.minIndex = Math.min(node.minIndex, child.minIndex);
      node.maxPriority = Math.max(node.maxPriority, child.maxPriority);
    }
  }
  aggregate(wrapper);
  return wrapper;
}

/** Tree indent per folder level, in pixels. */
const INDENT = 16;

/** Name-cell style that indents a row and draws one guide line per ancestor folder. */
function treeIndentStyle(depth: number): React.CSSProperties {
  return {
    paddingLeft: `${depth * INDENT + 4}px`,
    backgroundImage: `repeating-linear-gradient(to right, var(--border) 0 1px, transparent 1px ${INDENT}px)`,
    backgroundSize: `${depth * INDENT}px 100%`,
    backgroundPosition: `${INDENT / 2 + 4}px 0`,
    backgroundRepeat: "no-repeat",
  };
}

/** Filled folder glyph for folder rows. */
function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M1.5 3.5A1.5 1.5 0 0 1 3 2h3.2l1.6 1.6H13a1.5 1.5 0 0 1 1.5 1.5v7.4A1.5 1.5 0 0 1 13 14H3a1.5 1.5 0 0 1-1.5-1.5z" />
    </svg>
  );
}

/** Outline page glyph for file rows. */
function FileIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
      <path d="M4 1.5h5l3.5 3.5v9.5H4z M9 1.5V5h3.5" strokeLinejoin="round" />
    </svg>
  );
}

/** Files tab columns in display order; the one without a width takes the rest. */
const fileColumns: { key: FileSortKey; label: string; align: string; width?: string }[] = [
  { key: "index", label: "detail.files.number", align: "text-left", width: "2rem" },
  { key: "name", label: "detail.files.name", align: "text-left" },
  { key: "size", label: "detail.files.size", align: "text-right", width: "5rem" },
  { key: "done", label: "detail.files.done", align: "text-right", width: "9rem" },
  { key: "priority", label: "detail.files.priority", align: "text-left", width: "5.5rem" },
];

/** Files tab: sortable folder tree with per-file and per-folder priority. */
export function FilesTab({
  files,
  torrent,
  loading,
  capabilities,
}: {
  files: TorrentFile[];
  torrent: Torrent;
  loading: boolean;
  capabilities: ServerCapabilities | null;
}) {
  const { t } = useTranslation();
  const [ctxFile, setCtxFile] = useState<{ x: number; y: number; file: TorrentFile } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [sort, setSort] = useState<FileSort>(loadFileSort);
  // hold the picked priority until polling catches up, else the dropdown snaps back
  const [pending, setPending] = useState<Map<number, number>>(() => new Map());

  const merged = useMemo(
    () => (pending.size === 0 ? files : files.map(f => (pending.has(f.index) ? { ...f, priority: pending.get(f.index)! } : f))),
    [files, pending],
  );

  useEffect(() => {
    if (pending.size === 0) return;
    const stale = files.filter(f => pending.get(f.index) === f.priority).map(f => f.index);
    if (stale.length === 0) return;
    setPending(prev => {
      const next = new Map(prev);
      for (const i of stale) next.delete(i);
      return next;
    });
  }, [files, pending]);

  const tree = useMemo(() => buildFileTree(merged, torrent.name), [merged, torrent.name]);
  const subfolders = useMemo(() => subfolderPaths(tree), [tree]);

  function toggleSort(key: FileSortKey) {
    const next = { key, asc: sort.key === key ? !sort.asc : true };
    setSort(next);
    saveJSON(FILE_SORT_STORAGE, next);
  }

  const toggleCollapse = useCallback((path: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  function markPending(indices: number[], priority: number) {
    setPending(prev => {
      const next = new Map(prev);
      for (const i of indices) next.set(i, priority);
      return next;
    });
  }

  function clearPending(indices: number[]) {
    setPending(prev => {
      const next = new Map(prev);
      for (const i of indices) next.delete(i);
      return next;
    });
  }

  async function handlePriorityChange(fileIndex: number, priority: number) {
    markPending([fileIndex], priority);
    try {
      await api.setFilePriority(torrent.hash, fileIndex, priority);
    } catch {
      clearPending([fileIndex]);
    }
  }

  async function handleFolderPriorityChange(node: FileTreeNode, priority: number) {
    const indices: number[] = [];
    function collect(n: FileTreeNode) {
      if (n.file) indices.push(n.file.index);
      for (const child of n.children.values()) collect(child);
    }
    collect(node);
    markPending(indices, priority);
    const results = await Promise.all(
      indices.map(i => api.setFilePriority(torrent.hash, i, priority).then(() => null, () => i)),
    );
    const failed = results.filter((i): i is number => i !== null);
    if (failed.length > 0) clearPending(failed);
  }

  function folderPriority(node: FileTreeNode): number | null {
    const priorities = new Set<number>();
    function collect(n: FileTreeNode) {
      if (n.file) priorities.add(n.file.priority);
      for (const child of n.children.values()) collect(child);
    }
    collect(node);
    return priorities.size === 1 ? priorities.values().next().value! : null;
  }

  if (files.length === 0) {
    return (
      <div style={{ color: "var(--text-secondary)" }}>
        {loading ? t("detail.files.loading") : t("detail.files.noFiles")}
      </div>
    );
  }

  const singleFile = files.length === 1;
  // no real folder when the torrent name is the lone file's path
  const noFolder = singleFile && torrent.name === files[0].path;

  const hasFileCtx = capabilities?.has_file_prioritize_first || capabilities?.has_file_prioritize_last;

  function renderNode(node: FileTreeNode, depth: number, isRoot = false): React.ReactNode[] {
    const isDir = !node.file && node.children.size > 0;
    const isCollapsed = collapsed.has(node.path);
    const pct = node.totalSize === 0 ? 0 : (node.completedSize / node.totalSize) * 100;
    const rows: React.ReactNode[] = [];
    const hideRow = isRoot && noFolder;

    if (isDir) {
      const hideFields = isRoot && singleFile;
      const fp = folderPriority(node);
      if (!hideRow) {
        rows.push(
          <tr key={`dir-${node.path}`} style={{ background: "color-mix(in srgb, var(--bg-tertiary) 35%, transparent)" }}>
            <td className="px-1 py-0.5" style={{ color: "var(--text-secondary)" }} />
            <td
              className="px-1 py-0.5 truncate cursor-pointer select-none"
              style={treeIndentStyle(depth)}
              onClick={() => toggleCollapse(node.path)}
            >
              <div className="flex items-center min-w-0">
                <span className="flex justify-center w-4 shrink-0" style={{ color: "var(--text-secondary)" }}>
                  <ChevronIcon direction={isCollapsed ? "right" : "down"} />
                </span>
                <span className="flex mr-1.5 shrink-0" style={{ color: "var(--accent)" }}><FolderIcon /></span>
                <span className="truncate font-medium" style={{ color: "var(--text-primary)" }}>{node.name}</span>
              </div>
            </td>
            {hideFields ? (
              <><td /><td /><td /></>
            ) : (
              <>
                <td className="px-1 py-0.5 text-right whitespace-nowrap">
                  {formatSize(node.totalSize)}
                </td>
                <td className="px-1 py-0.5 text-right whitespace-nowrap">
                  {pct.toFixed(1)}%
                </td>
                <td className="px-1 py-0.5">
                  <Select
                    value={fp !== null ? String(fp) : ""}
                    onChange={(v) => handleFolderPriorityChange(node, Number(v))}
                    placeholder={t("priority.mixed")}
                    options={[
                      { value: "0", label: t("priority.off") },
                      { value: "1", label: t("priority.normal") },
                      { value: "2", label: t("priority.high") },
                    ]}
                    compact
                    className="text-xs"
                  />
                </td>
              </>
            )}
          </tr>
        );
      }
      if (!isCollapsed || hideRow) {
        const sorted = [...node.children.values()].sort((a, b) => compareFileNodes(a, b, sort));
        const childDepth = hideRow ? depth : depth + 1;
        for (const child of sorted) {
          rows.push(...renderNode(child, childDepth));
        }
      }
    } else if (node.file) {
      const f = node.file;
      rows.push(
        <tr
          key={f.index}
          onContextMenu={hasFileCtx ? (e) => { e.preventDefault(); setCtxFile({ x: e.clientX, y: e.clientY, file: f }); } : undefined}
        >
          <td className="px-1 py-0.5" style={{ color: "var(--text-secondary)" }}>
            {f.index + 1}
          </td>
          <td className="px-1 py-0.5 truncate" style={treeIndentStyle(depth)}>
            <div className="flex items-center min-w-0">
              <span className="w-4 shrink-0" />
              <span className="flex mr-1.5 shrink-0" style={{ color: "var(--text-secondary)" }}><FileIcon /></span>
              <span className="truncate">{node.name}</span>
            </div>
          </td>
          <td className="px-1 py-0.5 text-right whitespace-nowrap">
            {formatSize(f.size_bytes)}
          </td>
          <td className="px-1 py-0.5 text-right whitespace-nowrap">
            {formatSize(node.completedSize)} ({pct.toFixed(1)}%)
          </td>
          <td className="px-1 py-0.5">
            <Select
              value={String(f.priority)}
              onChange={(v) => handlePriorityChange(f.index, Number(v))}
              options={[
                { value: "0", label: t("priority.off") },
                { value: "1", label: t("priority.normal") },
                { value: "2", label: t("priority.high") },
              ]}
              compact
              className="text-xs"
            />
          </td>
        </tr>
      );
    }
    return rows;
  }

  return (
    <>
      {subfolders.length > 0 && (
        <div className="flex gap-3 px-1 pb-1 text-xs">
          <button className="hover:underline" style={{ color: "var(--text-secondary)" }} onClick={() => setCollapsed(new Set())}>
            {t("detail.files.expandAll")}
          </button>
          <button className="hover:underline" style={{ color: "var(--text-secondary)" }} onClick={() => setCollapsed(new Set(subfolders))}>
            {t("detail.files.collapseAll")}
          </button>
        </div>
      )}
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {fileColumns.map((col) => (
              <th
                key={col.key}
                className={`${col.align} px-1 py-0.5 cursor-pointer select-none whitespace-nowrap`}
                style={{ color: "var(--text-secondary)", width: col.width }}
                onClick={() => toggleSort(col.key)}
              >
                <SortLabel label={t(col.label)} sorted={sort.key === col.key} asc={sort.asc} align={col.align === "text-right" ? "right" : "left"} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {renderNode(tree, 0, true)}
        </tbody>
      </table>
      {ctxFile && (
        <ContextMenu
          x={ctxFile.x}
          y={ctxFile.y}
          items={[
            ...(capabilities?.has_file_prioritize_first
              ? [{
                  label: t("detail.files.prioritizeFirst"),
                  onClick: () => { api.prioritizeFirstPiece(torrent.hash, ctxFile.file.index, true).catch(() => {}); },
                }]
              : []),
            ...(capabilities?.has_file_prioritize_last
              ? [{
                  label: t("detail.files.prioritizeLast"),
                  onClick: () => { api.prioritizeLastPiece(torrent.hash, ctxFile.file.index, true).catch(() => {}); },
                }]
              : []),
          ]}
          onClose={() => setCtxFile(null)}
        />
      )}
    </>
  );
}
