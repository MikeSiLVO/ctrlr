import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { usePoll } from "./hooks/usePoll";
import { useWindowHidden } from "./hooks/useWindowHidden";
import * as api from "./api";
import type { Torrent, StatusFilter, SortField, ServerCapabilities } from "./types";
import { torrentStatus, torrentEta, torrentProgress, matchesFilter, isAnyPaused, isEffectivelyComplete } from "./torrent";
import { formatRate } from "./format";
import { loadBool, loadString, savePref } from "./prefs";
import { Toolbar } from "./components/Toolbar";
import { Sidebar } from "./components/Sidebar";
import { TorrentTable } from "./components/TorrentTable";
import { DetailPanel } from "./components/detail/DetailPanel";
import { LogPanel } from "./components/LogPanel";
import { StatusBar } from "./components/StatusBar";
import { AddDialog } from "./components/AddDialog";
import { SettingsDialog } from "./components/settings/SettingsDialog";
import { RssDialog } from "./components/rss/RssDialog";
import { HistoryDialog } from "./components/HistoryDialog";
import { ContextMenu } from "./components/ContextMenu";
import { buildContextMenuItems } from "./torrentMenu";
import { loadRatioGroupNames } from "./components/settings/RatioTab";
import { DirectoryBrowser } from "./components/DirectoryBrowser";
import { PropertiesDialog } from "./components/PropertiesDialog";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { usePreferences } from "./hooks/usePreferences";
import { useUpdateCheck } from "./hooks/useUpdateCheck";
import { useResizeHandle } from "./hooks/useResizeHandle";
import { useDialog } from "./components/AppDialog";
import { overlayOpen } from "./components/ui";

/** Filter torrents to one status bucket. */
function filterTorrents(torrents: Torrent[], filter: StatusFilter): Torrent[] {
  if (filter === "all") return torrents;
  return torrents.filter((t) => matchesFilter(t, filter));
}

/** Sort a copy of the list by one column, torrents without an ETA last when ascending. */
function sortTorrents(
  torrents: Torrent[],
  field: SortField,
  asc: boolean,
): Torrent[] {
  const sorted = [...torrents].sort((a, b) => {
    let cmp = 0;
    switch (field) {
      case "name":
        cmp = a.name.localeCompare(b.name, undefined, {
          sensitivity: "base",
        });
        break;
      case "size":
        cmp = a.size_bytes - b.size_bytes;
        break;
      case "progress":
        cmp = torrentProgress(a) - torrentProgress(b);
        break;
      case "down":
        cmp = a.down_rate - b.down_rate;
        break;
      case "up":
        cmp = a.up_rate - b.up_rate;
        break;
      case "ratio":
        cmp = a.ratio_millis - b.ratio_millis;
        break;
      case "status":
        cmp = torrentStatus(a).localeCompare(torrentStatus(b));
        break;
      case "seeds":
        cmp = a.seeds_connected - b.seeds_connected;
        break;
      case "peers":
        cmp = a.peers_connected - b.peers_connected;
        break;
      case "swarm":
        cmp = (a.seeds_connected + a.peers_connected) - (b.seeds_connected + b.peers_connected);
        break;
      case "label":
        cmp = (a.tags[0] ?? "").localeCompare(b.tags[0] ?? "");
        break;
      case "added":
        cmp = a.date_added - b.date_added;
        break;
      case "eta": {
        const etaA = torrentEta(a);
        const etaB = torrentEta(b);
        cmp = (etaA < 0 ? Infinity : etaA) - (etaB < 0 ? Infinity : etaB);
        break;
      }
      case "priority":
        cmp = a.priority - b.priority;
        break;
      case "uploaded":
        cmp = a.up_total - b.up_total;
        break;
      case "downloaded":
        cmp = a.down_total - b.down_total;
        break;
      case "created":
        cmp = a.date_created - b.date_created;
        break;
    }
    return asc ? cmp : -cmp;
  });
  return sorted;
}

/** Read a local .torrent into the bytes and file name the add dialog takes. */
async function readTorrentFile(path: string): Promise<{ data: number[]; name: string }> {
  const data = await api.readFileBytes(path);
  return { data, name: path.split(/[/\\]/).pop() ?? "file.torrent" };
}

/** Open torrent context menu: where it shows and the rows it acts on. */
interface ContextMenuState {
  x: number;
  y: number;
  hashes: string[];
}

/** Main window, owning the polling, selection, notifications and every dialog. */
export default function App() {
  const { t } = useTranslation();
  const dialog = useDialog();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedHashes, setSelectedHashes] = useState<Set<string>>(new Set());
  const [lastSelectedHash, setLastSelectedHash] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [labelFilter, setLabelFilter] = useState<string | null>(null);
  const [throttleFilter, setThrottleFilter] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>(() =>
    loadString("ctrlr:sort-field", "name") as SortField,
  );
  const [sortAsc, setSortAsc] = useState(() => loadBool("ctrlr:sort-asc", true));
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addInitialSources, setAddInitialSources] = useState<string[]>([]);
  const [addInitialFiles, setAddInitialFiles] = useState<Array<{ data: number[]; name: string }>>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const [moveHashes, setMoveHashes] = useState<string[] | null>(null);
  const [propsHash, setPropsHash] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [profiles, setProfiles] = useState<api.ProfileInfo[]>([]);
  const [activeProfile, setActiveProfile] = useState<string | null>(null);
  const {
    closeToTray, pollInterval, confirmRemove, checkUpdates, notifyComplete, notifyRatio,
    ratioTarget, showSpeedInTitle, showSearchBar, showSidebar, diskProvider,
    diskQuotaGB, defaultTrackers, settingsProps,
  } = usePreferences();
  const { update, dismiss: dismissUpdate } = useUpdateCheck(checkUpdates);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    loadBool("ctrlr:sidebar-collapsed", false),
  );
  const { height: detailHeight, lineRef: detailLineRef, onMouseDown: onDetailMouseDown, onMouseEnter: onDetailMouseEnter, onMouseLeave: onDetailMouseLeave } = useResizeHandle({
    storageKey: "ctrlr:detail-height", defaultHeight: 280,
  });
  const [capabilities, setCapabilities] = useState<ServerCapabilities | null>(null);

  const [searchText, setSearchText] = useState("");
  const [showLog, setShowLog] = useState(false);
  const [showRss, setShowRss] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [settingsContext, setSettingsContext] = useState<{
    initialTab?: "connection";
    initialProfile?: string;
    initialAddMode?: boolean;
  } | null>(null);

  useEffect(() => {
    api.isConnected().then((c) => {
      setConnected(c);
      if (c) api.getCapabilities().then(setCapabilities).catch((e) => console.error("Failed to fetch capabilities:", e));
    });
    refreshProfiles();
  }, []);

  useEffect(() => {
    const unlisten = listen("close-requested", () => {
      if (closeToTray) {
        api.hideWindow();
      } else {
        api.quitApp();
      }
    });
    return () => { unlisten.then((f) => f()); };
  }, [closeToTray]);

  const [openListenerReady, setOpenListenerReady] = useState(false);

  useEffect(() => {
    const unlisten = listen<string>("open-torrent", async (event) => {
      const arg = event.payload;
      if (arg.startsWith("magnet:")) {
        setAddInitialSources((prev) => [...prev, arg]);
        setShowAddDialog(true);
        api.showWindow();
      } else if (arg.endsWith(".torrent")) {
        try {
          const file = await readTorrentFile(arg);
          setAddInitialFiles((prev) => [...prev, file]);
          setShowAddDialog(true);
          api.showWindow();
        } catch (e) {
          setActionError(String(e));
        }
      }
    });
    unlisten.then(() => setOpenListenerReady(true));
    return () => { unlisten.then((f) => f()); };
  }, []);

  // getInitialOpen marks the frontend ready; the listener above must exist first
  useEffect(() => {
    if (!openListenerReady) return;
    api.getInitialOpen().then(async (args) => {
      if (args.length === 0) return;
      const sources: string[] = [];
      const files: Array<{ data: number[]; name: string }> = [];
      for (const arg of args) {
        if (arg.startsWith("magnet:")) {
          sources.push(arg);
        } else if (arg.endsWith(".torrent")) {
          try {
            files.push(await readTorrentFile(arg));
          } catch (e) {
            setActionError(String(e));
          }
        }
      }
      // append: a live open-torrent event can seed the dialog while this resolves
      if (sources.length > 0) setAddInitialSources((prev) => [...prev, ...sources]);
      if (files.length > 0) setAddInitialFiles((prev) => [...prev, ...files]);
      if (sources.length > 0 || files.length > 0) {
        setShowAddDialog(true);
        api.showWindow();
      }
    });
  }, [openListenerReady]);

  // native drag-drop, HTML5 drag events don't fire on Windows in Tauri
  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent(async (event) => {
      if (event.payload.type === "enter") {
        const hasTorrent = event.payload.paths?.some((p: string) => p.endsWith(".torrent"));
        if (hasTorrent) setDragging(true);
      } else if (event.payload.type === "leave") {
        setDragging(false);
      } else if (event.payload.type === "drop") {
        setDragging(false);
        const torrentPaths = event.payload.paths?.filter((p: string) => p.endsWith(".torrent")) ?? [];
        if (torrentPaths.length === 0) return;
        try {
          const files: Array<{ data: number[]; name: string }> = [];
          for (const p of torrentPaths) {
            files.push(await readTorrentFile(p));
          }
          // append, never replace: the dialog consumes these by running count
          setAddInitialFiles((prev) => [...prev, ...files]);
          setShowAddDialog(true);
        } catch (e) {
          setActionError(String(e));
        }
      }
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  useEffect(() => {
    savePref("ctrlr:sidebar-collapsed", sidebarCollapsed);
  }, [sidebarCollapsed]);

  useEffect(() => {
    isPermissionGranted().then((granted) => {
      if (!granted) requestPermission();
    });
  }, []);

  useEffect(() => {
    if (connected !== true || !activeProfile) return;
    api.restoreRatioGroups().then((ids) => {
      if (!ids?.length) return;
      const names = loadRatioGroupNames();
      sendNotification({ title: t("notification.ratioRestored"), body: ids.map((i) => names[i]).join(", ") });
    }).catch(() => {});
  }, [connected, activeProfile]);

  // while hidden, list feeds notifications and stats feed the tray; other polls pause
  const windowHidden = useWindowHidden();
  const visible = connected && !windowHidden;
  const { data: torrents, error: torrentError, reset: resetTorrents } = usePoll(
    api.listTorrents,
    connected ? pollInterval : 0,
  );
  const { data: stats } = usePoll(api.getTransferStats, connected ? pollInterval : 0);
  const { data: limits, refresh: refreshLimits } = usePoll(api.getSpeedLimits, visible ? pollInterval * 2 : 0);
  const diskFetcher = diskProvider === "whatbox" ? api.getDiskUsed : api.getFreeDiskspace;
  const { data: rawDiskValue } = usePoll(diskFetcher, visible && capabilities?.has_execute_capture ? 30000 : 0);
  // whatbox reports bytes used against the quota, df reports bytes free
  const freeDiskspace = diskProvider === "whatbox" && diskQuotaGB > 0 && rawDiskValue != null
    ? diskQuotaGB * 1_000_000_000 - rawDiskValue
    : diskProvider === "auto" ? rawDiskValue : null;

  useEffect(() => {
    const title = showSpeedInTitle && stats
      ? `\u2193 ${formatRate(stats.down_rate) || "0 B/s"}  \u2191 ${formatRate(stats.up_rate) || "0 B/s"}`
      : "Ctrl+R";
    getCurrentWindow().setTitle(title);

    if (stats) {
      const dl = formatRate(stats.down_rate) || "0 B/s";
      const ul = formatRate(stats.up_rate) || "0 B/s";
      api.updateTrayInfo(`Ctrl+R\n\u2193 ${dl}  \u2191 ${ul}`, `\u2193 ${dl}  \u2191 ${ul}`);
    }
  }, [showSpeedInTitle, stats]);

  const detailsFetcher = useCallback(
    () => api.getTorrentDetails(lastSelectedHash!),
    [lastSelectedHash],
  );
  const { data: details, reset: resetDetails } = usePoll(
    detailsFetcher,
    visible && lastSelectedHash ? pollInterval : 0,
  );
  useEffect(() => { if (!connected) resetDetails(); }, [connected, resetDetails]);

  const prevTorrentsRef = useRef<Map<string, Torrent> | null>(null);
  useEffect(() => {
    if (!torrents) return;
    const prev = prevTorrentsRef.current;
    const curr = new Map(torrents.map((t) => [t.hash, t]));

    if (prev) {
      for (const [hash, tor] of curr) {
        const p = prev.get(hash);
        if (!p) continue;

        // completion is only knowable while open, and a closed sample reads as incomplete
        if (notifyComplete && p.is_open && !isEffectivelyComplete(p) && isEffectivelyComplete(tor)) {
          sendNotification({ title: t("notification.downloadComplete"), body: tor.name });
        }
        const target = ratioTarget * 1000;
        if (notifyRatio && p.ratio_millis < target && tor.ratio_millis >= target) {
          sendNotification({ title: t("notification.ratioReached"), body: `${tor.name} (${(tor.ratio_millis / 1000).toFixed(2)})` });
        }
      }
    }

    prevTorrentsRef.current = curr;
  }, [torrents, notifyComplete, notifyRatio, ratioTarget]);

  const displayed = useMemo(() => {
    if (!torrents) return [];
    let list: Torrent[] = torrents;
    if (labelFilter) list = list.filter((t) => t.tags.includes(labelFilter));
    if (throttleFilter) list = list.filter((t) => t.throttle_name === throttleFilter);
    if (searchText) {
      const q = searchText.toLowerCase();
      list = list.filter((t) => t.name.toLowerCase().includes(q));
    }
    return sortTorrents(filterTorrents(list, filter), sortField, sortAsc);
  }, [torrents, labelFilter, throttleFilter, searchText, filter, sortField, sortAsc]);

  const selected = displayed.find((t) => t.hash === lastSelectedHash) ?? null;

  useEffect(() => {
    const displayedHashSet = new Set(displayed.map((t) => t.hash));
    setSelectedHashes((prev) => {
      const visible = new Set([...prev].filter((h) => displayedHashSet.has(h)));
      if (visible.size !== prev.size) {
        if (visible.size === 0 && displayed.length > 0) {
          setLastSelectedHash(displayed[0].hash);
          return new Set([displayed[0].hash]);
        }
        setLastSelectedHash((prevLast) =>
          prevLast && !visible.has(prevLast) && visible.size > 0 ? [...visible][0] : prevLast
        );
        return visible;
      }
      if (prev.size === 0 && displayed.length > 0) {
        setLastSelectedHash(displayed[0].hash);
        return new Set([displayed[0].hash]);
      }
      return prev;
    });
  }, [displayed]);

  const selectedTorrents = displayed.filter((t) => selectedHashes.has(t.hash));
  const selectedHashArray = selectedTorrents.map((t) => t.hash);

  const handleSelect = useCallback((hash: string, e: React.MouseEvent) => {
    setShowLog(false);
    if (e.shiftKey && lastSelectedHash) {
      const anchorIdx = displayed.findIndex((t) => t.hash === lastSelectedHash);
      const clickIdx = displayed.findIndex((t) => t.hash === hash);
      if (anchorIdx >= 0 && clickIdx >= 0) {
        const start = Math.min(anchorIdx, clickIdx);
        const end = Math.max(anchorIdx, clickIdx);
        const range = displayed.slice(start, end + 1).map((t) => t.hash);
        setSelectedHashes(new Set(range));
        // anchor stays put on shift-click
      }
    } else if (e.ctrlKey || e.metaKey) {
      setSelectedHashes((prev) => {
        const next = new Set(prev);
        if (next.has(hash)) {
          next.delete(hash);
        } else {
          next.add(hash);
        }
        return next;
      });
      setLastSelectedHash(hash);
    } else {
      setSelectedHashes(new Set([hash]));
      setLastSelectedHash(hash);
    }
  }, [displayed, lastSelectedHash]);

  const existingHashes = useMemo(() =>
    new Set(torrents?.map((t) => t.hash.toUpperCase()) ?? []),
    [torrents],
  );

  const allLabels = useMemo(() =>
    torrents
      ? [...new Set(torrents.flatMap((t) => t.tags))].filter(Boolean).sort()
      : [],
    [torrents],
  );

  const allThrottles = useMemo(() =>
    torrents
      ? [...new Set(torrents.map((t) => t.throttle_name))].filter(Boolean).sort()
      : [],
    [torrents],
  );

  const handleSort = useCallback(
    (field: SortField) => {
      if (field === sortField) {
        const next = !sortAsc;
        setSortAsc(next);
        savePref("ctrlr:sort-asc", next);
      } else {
        setSortField(field);
        setSortAsc(true);
        savePref("ctrlr:sort-field", field);
        savePref("ctrlr:sort-asc", true);
      }
    },
    [sortField, sortAsc],
  );

  const handleFilterChange = useCallback((f: StatusFilter) => {
    setFilter(f);
    setLabelFilter(null);
    setThrottleFilter(null);
  }, []);

  const handleLabelFilter = useCallback((label: string | null) => {
    setLabelFilter(label);
    setThrottleFilter(null);
    setFilter("all");
  }, []);

  const handleThrottleFilter = useCallback((throttle: string | null) => {
    setThrottleFilter(throttle);
    setLabelFilter(null);
    setFilter("all");
  }, []);

  function refreshProfiles() {
    api.listProfiles().then((result) => {
      setProfiles(result.profiles);
      setActiveProfile(result.active);
    }).catch((e) => console.error("Failed to list profiles:", e));
  }

  function handleConnected() {
    setConnected(true);
    setShowSettings(false);
    refreshProfiles();
    api.getCapabilities().then(setCapabilities).catch((e) => console.error("Failed to fetch capabilities:", e));
  }

  useEffect(() => {
    const unlisten = listen("launch-connected", handleConnected);
    return () => { unlisten.then((f) => f()); };
  }, []);

  async function handleSwitchProfile(name: string) {
    try {
      setActionError(null);
      await api.switchProfile(name);
      // old server's rows and notification baseline must not mix with the new server's
      resetTorrents();
      prevTorrentsRef.current = null;
      setSelectedHashes(new Set());
      setLastSelectedHash(null);
      resetDetails();
      setActiveProfile(name);
      setConnected(true);
      try {
        setCapabilities(await api.getCapabilities());
      } catch (e) {
        console.error("Failed to fetch capabilities after profile switch:", e);
        setCapabilities(null);
      }
    } catch (e) {
      setActionError(String(e));
    }
  }

  async function handleDisconnect() {
    try {
      setActionError(null);
      await api.disconnect();
      setConnected(false);
      setActiveProfile(null);
      refreshProfiles();
    } catch (e) {
      setActionError(String(e));
    }
  }

  function handleEditProfile(name: string) {
    setSettingsContext({ initialTab: "connection", initialProfile: name });
    setShowSettings(true);
  }

  function handleAddProfile() {
    setSettingsContext({ initialTab: "connection", initialAddMode: true });
    setShowSettings(true);
  }

  async function handleAction(action: () => Promise<void>) {
    try {
      setActionError(null);
      await action();
    } catch (e) {
      setActionError(String(e));
    }
  }

  const handlePause = useCallback(() => {
    if (selectedHashArray.length > 0)
      handleAction(() => api.pauseTorrents(selectedHashArray));
  }, [selectedHashArray]);

  const handleResume = useCallback(() => {
    if (selectedHashArray.length > 0)
      handleAction(() => api.resumeTorrents(selectedHashArray));
  }, [selectedHashArray]);

  const handleRemove = useCallback(async () => {
    if (selectedHashArray.length === 0) return;
    const msg = selectedTorrents.length === 1
      ? t("dialog.removeOne", { name: selectedTorrents[0].name })
      : t("dialog.removeMultiple", { count: selectedTorrents.length });
    if (confirmRemove && !(await dialog.confirm(msg))) return;
    handleAction(() => api.removeTorrents(selectedHashArray, false));
  }, [selectedHashArray, selectedTorrents, confirmRemove, dialog]);

  const handleRecheck = useCallback(() => {
    if (selectedHashArray.length > 0)
      handleAction(() => api.recheckTorrents(selectedHashArray));
  }, [selectedHashArray]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      // a dialog or open dropdown owns the keyboard
      if (overlayOpen()) return;

      if ((e.ctrlKey || e.metaKey) && e.key === "n") {
        e.preventDefault();
        setAddInitialSources([]);
        setAddInitialFiles([]);
        setShowAddDialog(true);
      } else if ((e.ctrlKey || e.metaKey) && e.key === "a") {
        e.preventDefault();
        if (displayed.length > 0) {
          setSelectedHashes(new Set(displayed.map((t) => t.hash)));
        }
      } else if (e.key === "Delete") {
        if (selectedHashArray.length > 0) handleRemove();
      } else if (e.key === "p" || e.key === "P") {
        if (selectedTorrents.length === 0) return;
        if (isAnyPaused(selectedTorrents)) handleResume();
        else handlePause();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (displayed.length === 0) return;
        const curIdx = lastSelectedHash ? displayed.findIndex((t) => t.hash === lastSelectedHash) : -1;
        const nextIdx = e.key === "ArrowDown"
          ? Math.min(curIdx + 1, displayed.length - 1)
          : Math.max(curIdx - 1, 0);
        const next = displayed[nextIdx];
        if (next) {
          setSelectedHashes(new Set([next.hash]));
          setLastSelectedHash(next.hash);
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        if (showSearchBar) {
          const el = document.querySelector<HTMLInputElement>('input[data-search-filter]');
          el?.focus();
        }
      } else if (e.key === "Escape") {
        setSearchText("");
        setCtxMenu(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [displayed, lastSelectedHash, selectedHashArray, selectedTorrents, handleRemove, handlePause, handleResume, showSearchBar]);

  const ctxMenuDeps = {
    displayed, allThrottles, allLabels, capabilities, confirmRemove, t, handleAction, dialog, setMoveHashes, setPropsHash,
  };

  const settingsPropsWithCaps = { ...settingsProps, capabilities };

  if (connected === false && !showSettings) {
    return (
      <SettingsDialog
        required
        onConnected={handleConnected}
        {...settingsPropsWithCaps}
      />
    );
  }

  if (connected === null) {
    return (
      <div
        className="flex items-center justify-center h-screen"
        style={{ color: "var(--text-secondary)" }}
      >
        {t("app.connecting")}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen">
      {dragging && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none"
          style={{ background: "rgba(0,0,0,0.5)" }}
        >
          <div
            className="text-lg font-semibold px-8 py-4 rounded-lg"
            style={{ background: "var(--bg-primary)", color: "var(--accent)", border: "2px dashed var(--accent)" }}
          >
            {t("app.dropTorrent")}
          </div>
        </div>
      )}

      <Toolbar
        hasSelection={selectedHashArray.length > 0}
        isPaused={isAnyPaused(selectedTorrents)}
        showLog={showLog}
        showSearchBar={showSearchBar}
        searchText={searchText}
        onSearchChange={setSearchText}
        onAdd={() => { setAddInitialSources([]); setAddInitialFiles([]); setShowAddDialog(true); }}
        onRemove={handleRemove}
        onTogglePause={() => {
          if (selectedTorrents.length === 0) return;
          if (isAnyPaused(selectedTorrents)) handleResume();
          else handlePause();
        }}
        onRecheck={handleRecheck}
        onToggleLog={() => setShowLog(!showLog)}
        onRss={() => setShowRss(true)}
        onHistory={() => setShowHistory(true)}
        onSettings={() => { setSettingsContext(null); setShowSettings(true); }}
        activeProfile={activeProfile}
        profiles={profiles}
        isConnected={connected === true}
        onSwitchProfile={handleSwitchProfile}
        onDisconnect={handleDisconnect}
        onEditProfile={handleEditProfile}
        onAddProfile={handleAddProfile}
      />

      {(torrentError || actionError) && (
        <div className="px-3 py-1 text-xs" style={{ color: "var(--danger)" }}>
          {torrentError || actionError}
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        {showSidebar && (
          <Sidebar
            filter={filter}
            labelFilter={labelFilter}
            throttleFilter={throttleFilter}
            labels={allLabels}
            throttles={allThrottles}
            torrents={torrents ?? []}
            collapsed={sidebarCollapsed}
            onFilterChange={handleFilterChange}
            onLabelFilter={handleLabelFilter}
            onThrottleFilter={handleThrottleFilter}
            onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
          />
        )}

        <div className="flex flex-col flex-1 min-w-0">
          <div className="flex-1 min-h-0" style={{ overflow: "overlay" as any }}>
            <TorrentTable
              torrents={displayed}
              selectedHashes={selectedHashes}
              sortField={sortField}
              sortAsc={sortAsc}
              onSelect={handleSelect}
              onSort={handleSort}
              onContextMenu={(e, _t, hashes) =>
                setCtxMenu({ x: e.clientX, y: e.clientY, hashes })
              }
            />
          </div>

          <div
            className="shrink-0 relative"
            style={{ height: "12px", cursor: "ns-resize" }}
            onMouseEnter={onDetailMouseEnter}
            onMouseLeave={onDetailMouseLeave}
            onMouseDown={onDetailMouseDown}
          >
            <div
              ref={detailLineRef}
              className="absolute left-0 right-0 pointer-events-none"
              style={{ height: "2px", top: "5px", background: "var(--border)" }}
            />
          </div>
          <div
            className="overflow-auto"
            style={{ height: `${detailHeight}px` }}
          >
            {showLog ? (
              <LogPanel />
            ) : (
              <DetailPanel
                torrent={selected}
                details={details}
                capabilities={capabilities}
              />
            )}
          </div>
        </div>
      </div>

      <StatusBar
        stats={stats ?? null}
        limits={limits ?? null}
        onLimitsChanged={refreshLimits}
        freeDiskspace={freeDiskspace ?? null}
        totalSize={torrents ? torrents.reduce((sum, t) => sum + t.bytes_done, 0) : null}
        decimalSize={diskProvider === "whatbox"}
        update={update}
        onDismissUpdate={dismissUpdate}
      />

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={buildContextMenuItems(ctxMenu.hashes, ctxMenuDeps)}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {moveHashes && (
        <DirectoryBrowser
          onSelect={(dir) => {
            handleAction(() => api.moveTorrents(moveHashes, dir));
            setMoveHashes(null);
          }}
          onCancel={() => setMoveHashes(null)}
        />
      )}

      {propsHash && (
        <PropertiesDialog hash={propsHash} onClose={() => setPropsHash(null)} />
      )}

      {showAddDialog && (
        <AddDialog
          initialSources={addInitialSources.length > 0 ? addInitialSources : undefined}
          initialFiles={addInitialFiles.length > 0 ? addInitialFiles : undefined}
          existingHashes={existingHashes}
          defaultTrackers={defaultTrackers ? defaultTrackers.split("\n").filter((s) => s.trim()) : undefined}
          onClose={() => { setShowAddDialog(false); setAddInitialSources([]); setAddInitialFiles([]); }}
        />
      )}

      {showRss && (
        <RssDialog onClose={() => setShowRss(false)} />
      )}

      {showHistory && (
        <HistoryDialog onClose={() => setShowHistory(false)} />
      )}

      {showSettings && (
        <SettingsDialog
          onConnected={handleConnected}
          onDisconnected={() => {
            setConnected(false);
            setShowSettings(false);
            refreshProfiles();
          }}
          onClose={() => { setShowSettings(false); setSettingsContext(null); refreshProfiles(); }}
          isConnected={connected === true}
          {...(settingsContext ?? {})}
          {...settingsPropsWithCaps}
        />
      )}
    </div>
  );
}
