import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../api";
import { formatSize } from "../format";
import { DirectoryBrowser } from "./DirectoryBrowser";
import { Select } from "./Select";
import { DialogShell } from "./ui";

/** Props for the add torrent dialog. */
interface AddDialogProps {
  onClose: () => void;
  /** Pre-loaded .torrent file bytes from drag-and-drop or file association. */
  initialFiles?: Array<{ data: number[]; name: string }>;
  /** Pre-filled magnet/URL from deep link or file association. */
  initialSources?: string[];
  /** Current torrent hashes for duplicate detection. */
  existingHashes?: Set<string>;
  /** Default tracker URLs to append to new torrents. */
  defaultTrackers?: string[];
}

/** File of a queued torrent with its chosen priority. */
interface FileEntry {
  index: number;
  path: string;
  size: number;
  priority: number; // 0=off, 1=normal, 2=high
}

/** Torrent queued in the add dialog, from a .torrent file or a URL. */
interface PendingTorrent {
  id: string;
  source: "file" | "url";
  fileData?: number[];
  fileName?: string;
  meta?: api.TorrentMeta;
  files: FileEntry[];
  url?: string;
  directory: string;
  isDuplicate: boolean;
  error?: string;
}

/** Add dialog file tree node, a folder or a file. */
interface TreeNode {
  name: string;
  fullPath: string;
  file?: FileEntry;
  children: TreeNode[];
}

/** Build the file tree from the file paths, with no wrapping root folder. */
function buildFileTree(files: FileEntry[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const file of files) {
    const parts = file.path.split("/");
    let current = root;
    let pathSoFar = "";

    for (let i = 0; i < parts.length; i++) {
      pathSoFar = pathSoFar ? `${pathSoFar}/${parts[i]}` : parts[i];
      const isLeaf = i === parts.length - 1;

      let node = current.find((n) => n.name === parts[i]);
      if (!node) {
        node = {
          name: parts[i],
          fullPath: pathSoFar,
          children: [],
          file: isLeaf ? file : undefined,
        };
        current.push(node);
      }

      if (isLeaf) {
        node.file = file;
      }
      current = node.children;
    }
  }

  return root;
}

/** File tree row with its children; a folder checkbox sets every file below it. */
function FileTreeRow({
  node,
  depth,
  onToggle,
  onPriority,
}: {
  node: TreeNode;
  depth: number;
  onToggle: (index: number) => void;
  onPriority: (index: number, priority: number) => void;
}) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const isDir = node.children.length > 0 && !node.file;
  const file = node.file;

  const allDescendantFiles = useMemo(() => {
    const files: FileEntry[] = [];
    function collect(n: TreeNode) {
      if (n.file) files.push(n.file);
      n.children.forEach(collect);
    }
    collect(node);
    return files;
  }, [node]);

  const dirEnabled = isDir
    ? allDescendantFiles.some((f) => f.priority > 0)
    : undefined;
  const dirSize = isDir
    ? allDescendantFiles.reduce((sum, f) => sum + f.size, 0)
    : 0;

  return (
    <>
      <tr
        className="hover:brightness-110"
        style={{ background: "var(--bg-secondary)" }}
      >
        <td className="py-0.5 pr-1" style={{ paddingLeft: `${depth * 16 + 4}px` }}>
          <div className="flex items-center gap-1">
            {isDir ? (
              <button
                type="button"
                onClick={() => setCollapsed(!collapsed)}
                className="w-4 text-center text-[10px] opacity-60"
              >
                {collapsed ? "\u25b6" : "\u25bc"}
              </button>
            ) : (
              <span className="w-4" />
            )}
            <input
              type="checkbox"
              checked={file ? file.priority > 0 : dirEnabled}
              onChange={() => {
                if (file) {
                  onToggle(file.index);
                } else {
                  const newPri = dirEnabled ? 0 : 1;
                  allDescendantFiles.forEach((f) => onPriority(f.index, newPri));
                }
              }}
              className="accent-sky-500"
            />
            <span
              className="truncate text-xs"
              style={{
                color: (file ? file.priority > 0 : dirEnabled)
                  ? "var(--text-primary)"
                  : "var(--text-secondary)",
                maxWidth: "300px",
              }}
            >
              {isDir ? `${node.name}/` : node.name}
            </span>
          </div>
        </td>
        <td
          className="py-0.5 px-2 text-right whitespace-nowrap text-xs"
          style={{ color: "var(--text-secondary)" }}
        >
          {formatSize(file ? file.size : dirSize)}
        </td>
        <td className="py-0.5 px-2">
          {file && (
            <Select
              value={String(file.priority)}
              onChange={(v) => onPriority(file.index, Number(v))}
              options={[
                { value: "0", label: t("priority.skip") },
                { value: "1", label: t("priority.normal") },
                { value: "2", label: t("priority.high") },
              ]}
              compact
              className="text-xs"
            />
          )}
        </td>
      </tr>
      {!collapsed &&
        node.children.map((child) => (
          <FileTreeRow
            key={child.fullPath}
            node={child}
            depth={depth + 1}
            onToggle={onToggle}
            onPriority={onPriority}
          />
        ))}
    </>
  );
}

/** Add dialog: queued torrents, each with its own directory and file priorities. */
export function AddDialog({ onClose, initialFiles, initialSources, existingHashes, defaultTrackers }: AddDialogProps) {
  const { t } = useTranslation();
  const [torrents, setTorrents] = useState<PendingTorrent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDirBrowser, setShowDirBrowser] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlValue, setUrlValue] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // the parent appends to these while open; take only the entries not seen yet
  const processedRef = useRef({ sources: 0, files: 0 });
  useEffect(() => {
    const newSources = (initialSources ?? []).slice(processedRef.current.sources);
    const newFiles = (initialFiles ?? []).slice(processedRef.current.files);
    processedRef.current = {
      sources: (initialSources ?? []).length,
      files: (initialFiles ?? []).length,
    };

    if (newSources.length === 0 && newFiles.length === 0) {
      if (torrents.length === 0) setShowUrlInput(true);
      return;
    }

    const added: PendingTorrent[] = [];
    for (const src of newSources) {
      if (torrents.some((t) => t.url === src) || added.some((t) => t.url === src)) continue;
      added.push(urlTorrent(src));
    }
    for (const f of newFiles) {
      added.push({
        id: crypto.randomUUID(),
        source: "file",
        fileData: f.data,
        fileName: f.name,
        files: [],
        directory: "",
        isDuplicate: false,
      });
    }

    setTorrents((prev) => [...prev, ...added]);
    for (const t of added) {
      if (t.source === "file" && t.fileData) {
        parseTorrent(t.id, t.fileData);
      } else if (t.url) {
        parseMagnet(t.id, t.url);
      }
    }
  }, [initialSources, initialFiles]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!api.DEMO) return;
    import("../demo").then(({ demoAddTorrents }) => {
      const seeded: PendingTorrent[] = demoAddTorrents.map((d) => ({
        id: crypto.randomUUID(),
        source: "file" as const,
        fileName: d.fileName,
        meta: d.meta,
        files: d.meta.files.map((f, i) => ({ index: i, path: f.path, size: f.size, priority: 1 })),
        directory: "",
        isDuplicate: false,
      }));
      setTorrents(seeded);
      setShowUrlInput(false);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function parseTorrent(id: string, data: number[]) {
    api.parseTorrentMeta(data).then((m) => {
      setTorrents((prev) => prev.map((t) => {
        if (t.id !== id) return t;
        return {
          ...t,
          meta: m,
          files: m.files.map((f, i) => ({ index: i, path: f.path, size: f.size, priority: 1 })),
          isDuplicate: existingHashes?.has(m.info_hash.toUpperCase()) ?? false,
        };
      }));
    }).catch((e) => {
      setTorrents((prev) => prev.map((t) =>
        t.id === id ? { ...t, error: String(e) } : t,
      ));
    });
  }

  function addFiles(fileList: FileList) {
    const reads = Array.from(fileList).map(
      (file) => new Promise<PendingTorrent>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const bytes = Array.from(new Uint8Array(reader.result as ArrayBuffer));
          resolve({
            id: crypto.randomUUID(),
            source: "file",
            fileData: bytes,
            fileName: file.name,
            files: [],
            directory: "",
            isDuplicate: false,
          });
        };
        reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
        reader.readAsArrayBuffer(file);
      })
    );
    Promise.all(reads).then((newTorrents) => {
      setTorrents((prev) => [...prev, ...newTorrents]);
      for (const nt of newTorrents) {
        if (nt.fileData) parseTorrent(nt.id, nt.fileData);
      }
    }).catch((e) => {
      console.error("Failed to read torrent files:", e);
    });
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    addFiles(files);
    if (fileRef.current) fileRef.current.value = "";
  }

  /** Queue entry for a magnet or URL, not yet checked for a duplicate. */
  function urlTorrent(url: string): PendingTorrent {
    return {
      id: crypto.randomUUID(),
      source: "url",
      url,
      files: [],
      directory: "",
      isDuplicate: false,
    };
  }

  function parseMagnet(id: string, url: string) {
    api.parseMagnetHash(url).then((hash) => {
      if (hash === null || !existingHashes?.has(hash)) return;
      setTorrents((prev) => prev.map((t) => (t.id === id ? { ...t, isDuplicate: true } : t)));
    }).catch(() => {});
  }

  function addUrl(url: string) {
    const trimmed = url.trim();
    if (!trimmed) return;
    const listed = torrents.find((t) => t.url === trimmed);
    if (listed) {
      setSelectedId(listed.id);
    } else {
      const entry = urlTorrent(trimmed);
      setTorrents((prev) => [...prev, entry]);
      parseMagnet(entry.id, trimmed);
    }
    setUrlValue("");
    setShowUrlInput(false);
  }

  function removeTorrent(id: string) {
    setTorrents((prev) => prev.filter((t) => t.id !== id));
  }

  const selected = torrents.find((t) => t.id === selectedId) ?? torrents[0] ?? null;
  const shownId = selected?.id;

  const updateSelected = useCallback((updater: (t: PendingTorrent) => PendingTorrent) => {
    if (!shownId) return;
    setTorrents((prev) => prev.map((t) => t.id === shownId ? updater(t) : t));
  }, [shownId]);

  function toggleFile(index: number) {
    updateSelected((t) => ({
      ...t,
      files: t.files.map((f) =>
        f.index === index ? { ...f, priority: f.priority > 0 ? 0 : 1 } : f,
      ),
    }));
  }

  function setFilePriority(index: number, priority: number) {
    updateSelected((t) => ({
      ...t,
      files: t.files.map((f) => (f.index === index ? { ...f, priority } : f)),
    }));
  }

  const tree = useMemo(() =>
    selected?.files ? buildFileTree(selected.files) : [],
  [selected?.files]);

  const selectedSize = selected?.files
    .filter((f) => f.priority > 0)
    .reduce((sum, f) => sum + f.size, 0) ?? 0;

  const allFilesSelected = selected?.files.every((f) => f.priority > 0) ?? false;
  const noFilesSelected = selected?.files.every((f) => f.priority === 0) ?? false;

  const checkedTorrents = torrents.filter((t) => !t.isDuplicate && !t.error);
  const canSubmit = checkedTorrents.length > 0 && !checkedTorrents.some((t) =>
    t.source === "file" && t.files.length > 0 && t.files.every((f) => f.priority === 0),
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setLoading(true);
    setError(null);
    try {
      for (const t of checkedTorrents) {
        if (t.source === "url" && t.url) {
          await api.addTorrent(t.url, t.directory.trim());
        } else if (t.fileData && t.meta) {
          const nonDefault = t.files
            .filter((f) => f.priority !== 1)
            .map((f): [number, number] => [f.index, f.priority]);
          await api.addTorrentConfigured(
            t.fileData,
            t.meta.info_hash,
            t.directory.trim() || null,
            nonDefault,
            defaultTrackers ?? [],
          );
        } else if (t.fileData) {
          await api.addTorrentFile(t.fileData);
        }
      }
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  function torrentDisplayName(pt: PendingTorrent): string {
    if (pt.meta) return pt.meta.name;
    if (pt.fileName) return pt.fileName;
    if (pt.url) {
      if (pt.url.startsWith("magnet:")) {
        const dn = new URLSearchParams(pt.url.split("?")[1]).get("dn");
        return dn || t("add.magnetLink");
      }
      return pt.url;
    }
    return t("add.unknown");
  }

  function torrentIcon(pt: PendingTorrent): string {
    if (pt.source === "url") return "\u{1F517}";
    if (pt.meta && pt.meta.files.length > 1) return "\u{1F4C1}";
    return "\u{1F4C4}";
  }

  function torrentSize(pt: PendingTorrent): number | null {
    if (pt.meta) return pt.meta.total_size;
    return null;
  }

  const hasTorrents = torrents.length > 0;
  const hasFileTree = selected?.meta && selected.files.length > 0;

  return (
    <DialogShell
      onClose={onClose}
      backdropOpacity={0.6}
      panelClassName="rounded-lg p-4 flex flex-col"
      panelStyle={{ width: "680px", height: "85vh" }}
    >
        <h2 className="text-sm font-semibold mb-3">
          {torrents.length > 1 ? t("add.titleMultiple") : t("add.title")}
        </h2>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3 min-h-0 flex-1">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="px-3 py-1.5 rounded text-xs"
              style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)" }}
            >
              {t("add.browseTorrent")}
            </button>
            <button
              type="button"
              onClick={() => setShowUrlInput(!showUrlInput)}
              className="px-3 py-1.5 rounded text-xs"
              style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)" }}
            >
              {t("add.addUrlMagnet")}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".torrent"
              multiple
              className="hidden"
              onChange={handleFileSelect}
            />
          </div>

          {showUrlInput && (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={urlValue}
                onChange={(e) => setUrlValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); addUrl(urlValue); }
                  // Escape here closes the URL field, not the dialog behind it
                  if (e.key === "Escape") { e.stopPropagation(); setShowUrlInput(false); }
                }}
                placeholder={t("add.magnetOrUrl")}
                autoFocus
                className="flex-1 px-3 py-1.5 rounded text-xs outline-none"
                style={{
                  background: "var(--bg-secondary)",
                  border: "1px solid var(--border)",
                  color: "var(--text-primary)",
                }}
              />
              <button
                type="button"
                onClick={() => addUrl(urlValue)}
                disabled={!urlValue.trim()}
                className="px-3 py-1.5 rounded text-xs font-medium disabled:opacity-40"
                style={{ background: "var(--accent-dim)", color: "white" }}
              >
                {t("common.add")}
              </button>
            </div>
          )}

          {hasTorrents && (
            <div
              className="shrink-0"
              style={{
                maxHeight: `${Math.min(torrents.length, 8) * 33}px`,
                border: "1px solid var(--border)",
                borderRadius: "4px",
                overflow: "auto",
              }}
            >
              {torrents.map((pt) => (
                <div
                  key={pt.id}
                  className="flex items-center gap-2 px-2 py-1 cursor-pointer"
                  style={{
                    background: pt.id === shownId ? "var(--bg-tertiary)" : "var(--bg-secondary)",
                    borderBottom: "1px solid var(--border)",
                  }}
                  onClick={() => setSelectedId(pt.id)}
                >
                  <span className="shrink-0 text-[11px]" style={{ opacity: 0.7 }}>
                    {torrentIcon(pt)}
                  </span>
                  <span
                    className="text-xs truncate flex-1"
                    style={{
                      color: pt.isDuplicate || pt.error
                        ? "var(--text-secondary)"
                        : "var(--text-primary)",
                    }}
                  >
                    {torrentDisplayName(pt)}
                  </span>
                  {pt.isDuplicate && (
                    <span className="text-[10px] px-1 rounded shrink-0"
                      style={{ color: "var(--warning, #f59e0b)" }}>
                      {t("add.duplicate")}
                    </span>
                  )}
                  {pt.error && (
                    <span className="text-[10px] px-1 rounded shrink-0"
                      style={{ color: "var(--danger)" }}>
                      {t("add.error")}
                    </span>
                  )}
                  {torrentSize(pt) != null && (
                    <span className="text-xs shrink-0" style={{ color: "var(--text-secondary)" }}>
                      {formatSize(torrentSize(pt)!)}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); removeTorrent(pt.id); }}
                    className="text-xs opacity-40 hover:opacity-100 shrink-0 px-1"
                    title={t("common.remove")}
                  >
                    {"\u00d7"}
                  </button>
                </div>
              ))}
            </div>
          )}

          {selected && hasFileTree && !selected.isDuplicate && !selected.error && (
            <>
              <div
                className="flex items-center justify-between text-xs py-1.5 px-1"
                style={{
                  color: "var(--text-secondary)",
                }}
              >
                <div className="flex items-center gap-3">
                  <span className="font-medium" style={{ color: "var(--text-primary)" }}>
                    {selected.meta!.name}
                  </span>
                  <span>
                    {t("add.fileCount", { selected: selected.files.filter((f) => f.priority > 0).length, total: selected.files.length })}
                  </span>
                  <span>{formatSize(selectedSize)}</span>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => updateSelected((pt) => ({
                      ...pt,
                      files: pt.files.map((f) => ({ ...f, priority: 1 })),
                    }))}
                    className="underline"
                    disabled={allFilesSelected}
                  >
                    {t("common.all")}
                  </button>
                  <button
                    type="button"
                    onClick={() => updateSelected((pt) => ({
                      ...pt,
                      files: pt.files.map((f) => ({ ...f, priority: 0 })),
                    }))}
                    className="underline"
                    disabled={noFilesSelected}
                  >
                    {t("common.none")}
                  </button>
                </div>
              </div>

              <div
                className="overflow-auto min-h-0 flex-1"
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: "4px",
                }}
              >
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr style={{ background: "var(--bg-tertiary)" }}>
                      <th className="py-1 px-1 text-left font-medium">{t("add.file")}</th>
                      <th className="py-1 px-2 text-right font-medium w-20">{t("add.size")}</th>
                      <th className="py-1 px-2 text-left font-medium w-20">{t("add.priority")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tree.map((node) => (
                      <FileTreeRow
                        key={node.fullPath}
                        node={node}
                        depth={0}
                        onToggle={toggleFile}
                        onPriority={setFilePriority}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {selected?.error && (
            <div className="text-xs" style={{ color: "var(--danger)" }}>
              {selected.error}
            </div>
          )}

          {selected?.isDuplicate && (
            <div
              className="flex items-center gap-2 px-3 py-2 rounded text-xs"
              style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border)" }}
            >
              <span style={{ color: "var(--warning, #f59e0b)" }}>
                {t("add.duplicateWarning")}
              </span>
            </div>
          )}

          {selected && !selected.isDuplicate && !selected.error && (
            <div className="flex items-center gap-2">
              <label
                className="text-xs whitespace-nowrap"
                style={{ color: "var(--text-secondary)" }}
              >
                {t("add.saveTo")}
              </label>
              <input
                type="text"
                value={selected.directory}
                onChange={(e) => updateSelected((t) => ({ ...t, directory: e.target.value }))}
                placeholder={t("add.defaultDirectory")}
                className="flex-1 px-2 py-1 rounded text-xs outline-none"
                style={{
                  background: "var(--bg-secondary)",
                  border: "1px solid var(--border)",
                  color: "var(--text-primary)",
                }}
              />
              {hasFileTree && (
                <button
                  type="button"
                  onClick={() => setShowDirBrowser(true)}
                  className="px-2 py-1 rounded text-xs shrink-0"
                  style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)" }}
                >
                  {t("common.browse")}
                </button>
              )}
            </div>
          )}

          {error && (
            <div className="text-xs" style={{ color: "var(--danger)" }}>
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 mt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded text-xs"
              style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)" }}
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={loading || !canSubmit}
              className="px-3 py-1.5 rounded text-xs font-medium disabled:opacity-40"
              style={{ background: "var(--accent-dim)", color: "white" }}
            >
              {loading ? t("add.adding") : checkedTorrents.length > 1 ? t("add.addCount", { count: checkedTorrents.length }) : t("common.add")}
            </button>
          </div>
        </form>

        {showDirBrowser && (
          <DirectoryBrowser
            initialPath={selected?.directory || undefined}
            onSelect={(path) => {
              updateSelected((t) => ({ ...t, directory: path }));
              setShowDirBrowser(false);
            }}
            onCancel={() => setShowDirBrowser(false)}
          />
        )}
    </DialogShell>
  );
}
