import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type {
  Torrent,
  TorrentDetails,
  TransferStats,
  SystemInfo,
  UpdateInfo,
  ServerCapabilities,
  LogEntry,
  RssFeedEntry,
  RssRuleEntry,
  RssFeedItem,
  RssMatchResult,
  RssDownloadRecord,
  SchedulerConfig,
  SchedulerActive,
  TorrentHistoryPage,
  HistoryQuery,
} from "./types";

/** Whether this is a demo build, set by VITE_DEMO at build time. */
export const DEMO = String(import.meta.env.VITE_DEMO ?? "").trim() === "true";

/** Demo data module, null until the first demo call loads it. */
let _demo: typeof import("./demo") | null = null;
/** Get the demo data module, loading it on first use. */
async function getDemo() {
  if (!_demo) _demo = await import("./demo");
  return _demo;
}

/** Tauri invoke, or a stand-in serving mock data in a demo build. */
const invoke: typeof tauriInvoke = DEMO
  ? (async (cmd: string, args?: Record<string, unknown>) => {
      const demo = await getDemo();
      switch (cmd) {
        case "is_connected": return true;
        case "list_torrents": return demo.torrents;
        case "get_transfer_stats": return demo.stats;
        case "get_speed_limits": return demo.speedLimits;
        case "get_torrent_details": return demo.torrentDetails((args as any).hash);
        case "get_capabilities": return demo.capabilities;
        case "list_profiles": return demo.profiles;
        case "get_free_diskspace": return demo.diskFree;
        case "get_activity_log": return demo.activityLog;
        case "get_initial_open": return [];
        case "get_system_info": return demo.systemInfo;
        case "rss_list_feeds": return demo.rssFeeds;
        case "rss_list_rules": return demo.rssRules;
        case "rss_get_history": return demo.rssHistory.slice(0, (args as any)?.limit ?? 100);
        case "rss_preview_feed": return demo.rssFeedItems[(args as any)?.name] ?? [];
        case "rss_test_rule": return [];
        case "rss_is_enabled": return true;
        case "scheduler_get_config": return demo.schedulerConfig;
        case "scheduler_get_active": return demo.schedulerActive;
        case "get_ratio_groups": return demo.ratioGroups;
        case "get_remote_settings": return demo.remoteSettings;
        case "history_list": return demo.historyPage((args as any).query);
        case "list_remote_directory": return demo.remoteDirectory((args as any)?.path ?? "");
        case "get_torrent_properties": return demo.torrentProperties();
        case "get_default_directory": return "/home/demo/downloads";
        // any dropped file gets a stand-in; the add dialog reads meta.files
        case "parse_torrent_meta": return demo.demoAddTorrents[0].meta;
        // null not undefined: demo writes have no store, but callers still read the result
        default: return null;
      }
    }) as any
  : tauriInvoke;

/** One connection profile as the settings form edits it, fields set per connection type. */
export interface ConnectionSettings {
  profile?: string;
  conn_type: string;
  ssh_host?: string;
  ssh_port?: number;
  ssh_user?: string;
  ssh_password?: string;
  remote_socket?: string;
  host?: string;
  port?: number;
  url?: string;
  username?: string;
  password?: string;
  socket?: string;
}


/** Save a profile and connect to it, rolling back the active profile if it fails. */
export async function saveAndConnect(
  settings: ConnectionSettings,
): Promise<void> {
  return invoke("save_and_connect", { settings });
}

/** Whether an RPC client is currently held. */
export async function isConnected(): Promise<boolean> {
  return invoke("is_connected");
}

/** Disconnect, dropping the client, tunnel, profile, capabilities and History sync together. */
export async function disconnect(): Promise<void> {
  return invoke("disconnect");
}

/** Which optional rTorrent commands this server exposes, from system.listMethods. */
export async function getCapabilities(): Promise<ServerCapabilities | null> {
  return invoke("get_capabilities");
}

/** Every torrent in the main view, syncing History; a fetching magnet takes its History name. */
export async function listTorrents(): Promise<Torrent[]> {
  return invoke("list_torrents");
}

/** Global up and down rates and totals. */
export async function getTransferStats(): Promise<TransferStats> {
  return invoke("get_transfer_stats");
}

/** Global limits as [up, down] in bytes per second. */
export async function getSpeedLimits(): Promise<[number, number]> {
  return invoke("get_speed_limits");
}

/** Add by magnet or http url, which rTorrent fetches, in the given directory or its default. */
export async function addTorrent(source: string, directory?: string): Promise<void> {
  return invoke("add_torrent", { source, directory: directory || null });
}

/** Add raw .torrent bytes, sent as a data: uri. */
export async function addTorrentFile(data: number[]): Promise<void> {
  return invoke("add_torrent_file", { data });
}

/** One file listed in a parsed .torrent. */
export interface TorrentMetaFile {
  path: string;
  size: number;
}

/** A .torrent's metadata, parsed locally before it is added. */
export interface TorrentMeta {
  info_hash: string;
  name: string;
  total_size: number;
  piece_length: number;
  piece_count: number;
  files: TorrentMetaFile[];
}

/** Parse a .torrent's file list and info hash without adding it. */
export async function parseTorrentMeta(data: number[]): Promise<TorrentMeta> {
  return invoke("parse_torrent_meta", { data });
}

/** Parse a magnet uri's btih info hash into uppercase hex, or null when it has none. */
export async function parseMagnetHash(uri: string): Promise<string | null> {
  return invoke("parse_magnet_hash", { uri });
}

/** Add with a directory and file priorities set before hashing, extra trackers if not private. */
export async function addTorrentConfigured(
  data: number[],
  infoHash: string,
  directory: string | null,
  filePriorities: [number, number][],
  extraTrackers: string[] = [],
): Promise<void> {
  return invoke("add_torrent_configured", {
    data,
    infoHash,
    directory,
    filePriorities,
    extraTrackers,
  });
}

/** Pause each torrent by stopping and closing it. */
export async function pauseTorrents(hashes: string[]): Promise<void> {
  return invoke("pause_torrents", { hashes });
}

/** Resume each torrent by opening and starting it. */
export async function resumeTorrents(hashes: string[]): Promise<void> {
  return invoke("resume_torrents", { hashes });
}

/** Remove each torrent and optionally its data, stopping at the first failure. */
export async function removeTorrents(
  hashes: string[],
  deleteData: boolean,
): Promise<void> {
  return invoke("remove_torrents", { hashes, deleteData });
}

/** Recheck each torrent with a full hash check. */
export async function recheckTorrents(hashes: string[]): Promise<void> {
  return invoke("recheck_torrents", { hashes });
}

/** Reannounce each torrent to its trackers, without forcing it. */
export async function reannounceTorrents(hashes: string[]): Promise<void> {
  return invoke("reannounce_torrents", { hashes });
}

/** Set download priority 0 to 3 on each torrent. */
export async function setTorrentsPriority(
  hashes: string[],
  priority: number,
): Promise<void> {
  return invoke("set_torrents_priority", { hashes, priority });
}

/** Set each torrent's throttle group by name, or clear it with an empty name. */
export async function setTorrentsThrottle(
  hashes: string[],
  throttleName: string,
): Promise<void> {
  return invoke("set_torrents_throttle", { hashes, throttleName });
}

/** Move each torrent's data on the remote host, restoring its stopped, paused or active state. */
export async function moveTorrents(
  hashes: string[],
  directory: string,
): Promise<void> {
  return invoke("move_torrents", { hashes, directory });
}

/** Files, peers, trackers and scalar fields in one batch. */
export async function getTorrentDetails(hash: string): Promise<TorrentDetails> {
  return invoke("get_torrent_details", { hash });
}

/** The original .torrent bytes, read back from rTorrent's session directory. */
export async function getTorrentFile(hash: string): Promise<number[]> {
  return invoke("get_torrent_file", { hash });
}

/** Per-torrent tunables edited in the properties dialog. */
export interface TorrentProperties {
  max_uploads: number;
  peers_min: number;
  peers_max: number;
  tracker_numwant: number;
  connection_seed: string;
}

/** Per-torrent tunables shown in the properties dialog. */
export async function getTorrentProperties(hash: string): Promise<TorrentProperties> {
  return invoke("get_torrent_properties", { hash });
}

/** Set the per-torrent tunables from the properties dialog. */
export async function setTorrentProperties(hash: string, props: TorrentProperties): Promise<void> {
  return invoke("set_torrent_properties", { hash, props });
}

/** Set a torrent's labels, replacing the old ones, stored url-encoded in d.custom1. */
export async function setTags(hash: string, tags: string[]): Promise<void> {
  return invoke("set_tags", { hash, tags });
}

/** Set the recorded add time, which lives in d.custom=addtime. */
export async function setDateAdded(hash: string, epoch: number): Promise<void> {
  return invoke("set_date_added", { hash, epoch });
}

/** Set one file's priority: 0 off, 1 normal, 2 high. */
export async function setFilePriority(
  hash: string,
  fileIndex: number,
  priority: number,
): Promise<void> {
  return invoke("set_file_priority", { hash, fileIndex, priority });
}

/** Set the global upload cap in KB per second, 0 for unlimited. */
export async function setUploadLimit(kb: number): Promise<void> {
  return invoke("set_upload_limit", { kb });
}

/** Set the global download cap in KB per second, 0 for unlimited. */
export async function setDownloadLimit(kb: number): Promise<void> {
  return invoke("set_download_limit", { kb });
}

/** rTorrent version, library version and hostname. */
export async function getSystemInfo(): Promise<SystemInfo> {
  return invoke("get_system_info");
}

/** rTorrent's configured download directory. */
export async function getDefaultDirectory(): Promise<string> {
  return invoke("get_default_directory");
}

/** Free bytes on the download partition, via df on the remote host. */
export async function getFreeDiskspace(): Promise<number> {
  return invoke("get_free_diskspace");
}

/** Used bytes from the seedbox quota tool, for providers that report usage, not free space. */
export async function getDiskUsed(): Promise<number> {
  return invoke("get_disk_used");
}

/** Subdirectory names under a remote path, for the directory browser. */
export async function listRemoteDirectory(path: string): Promise<string[]> {
  return invoke("list_remote_directory", { path });
}

/** rTorrent's own settings; a null field is one this server cannot report. */
export interface RemoteSettings {
  default_directory: string;
  max_uploads: number;
  max_downloads: number;
  min_peers_normal: number;
  max_peers_normal: number;
  min_peers_seed: number;
  max_peers_seed: number;
  port_range: string;
  pex: boolean;
  dht: string | null;
  encryption: string | null;
  hash_on_completion: boolean;
  scheduler_max_active: number | null;
  send_buffer_size: number | null;
  receive_buffer_size: number | null;
  dht_override_port: number | null;
  tracker_numwant: number | null;
}

/** rTorrent's own settings, batched and gated on server support. */
export async function getRemoteSettings(): Promise<RemoteSettings> {
  return invoke("get_remote_settings");
}

/** Save rTorrent's settings, leaving out any field sent as null. */
export async function saveRemoteSettings(settings: RemoteSettings): Promise<void> {
  return invoke("save_remote_settings", { settings });
}

/** One rTorrent ratio group, thresholds as plain ratios and the upload floor in GiB. */
export interface RatioGroup {
  id: number;
  enabled: boolean;
  min: number;
  max: number;
  upload_gib: number;
  action: string;
}

/** The eight ratio groups with their thresholds and actions. */
export async function getRatioGroups(): Promise<RatioGroup[]> {
  return invoke("get_ratio_groups");
}

/** Save the ratio group thresholds and actions, disabling groups switched off, and record them. */
export async function saveRatioGroups(groups: RatioGroup[]): Promise<void> {
  return invoke("save_ratio_groups", { groups });
}

/** Re-apply this server's saved ratio groups after an rTorrent restart, returning the enabled ids. */
export async function restoreRatioGroups(): Promise<number[]> {
  return invoke("restore_ratio_groups");
}

/** Set each torrent's ratio group through view membership, -1 to clear it. */
export async function setTorrentsRatioGroup(
  torrents: { hash: string; old_group: number }[],
  group: number,
): Promise<void> {
  return invoke("set_torrents_ratio_group", { torrents, group });
}

/** Toggle a single tracker on or off by index. */
export async function toggleTracker(hash: string, index: number, enabled: boolean): Promise<void> {
  return invoke("toggle_tracker", { hash, index, enabled });
}

/** Add a tracker url to a group. */
export async function addTracker(hash: string, group: number, url: string): Promise<void> {
  return invoke("add_tracker", { hash, group, url });
}

/** Force an announce to the torrent's trackers now. */
export async function forceAnnounce(hash: string): Promise<void> {
  return invoke("force_announce", { hash });
}

/** Ban a peer so rTorrent will not reconnect to it. */
export async function banPeer(hash: string, peerId: string): Promise<void> {
  return invoke("ban_peer", { hash, peerId });
}

/** Disconnect a peer, leaving it free to return. */
export async function disconnectPeer(hash: string, peerId: string): Promise<void> {
  return invoke("disconnect_peer", { hash, peerId });
}

/** Disconnect every seeder connected to the torrent. */
export async function disconnectSeeders(hash: string): Promise<void> {
  return invoke("disconnect_seeders", { hash });
}

/** Prioritize a file's first piece on or off, for previewing while it downloads. */
export async function prioritizeFirstPiece(hash: string, index: number, enable: boolean): Promise<void> {
  return invoke("prioritize_first_piece", { hash, index, enable });
}

/** Prioritize a file's last piece on or off, which some players read before playback. */
export async function prioritizeLastPiece(hash: string, index: number, enable: boolean): Promise<void> {
  return invoke("prioritize_last_piece", { hash, index, enable });
}

/** Read a local .torrent's bytes, refusing any other extension. */
export async function readFileBytes(path: string): Promise<number[]> {
  return invoke("read_file_bytes", { path });
}

/** Torrent args from before the frontend mounted; clears them and marks the frontend ready. */
export async function getInitialOpen(): Promise<string[]> {
  return invoke("get_initial_open");
}

/** Set whether the app starts hidden to tray, read at the next launch. */
export async function setStartMinimized(value: boolean): Promise<void> {
  return invoke("set_start_minimized", { value });
}

/** Set whether the app launches at login, registering it with the OS. */
export async function setAutostart(value: boolean): Promise<void> {
  return invoke("set_autostart", { value });
}

/** Show the main window and focus it. */
export async function showWindow(): Promise<void> {
  return invoke("show_window");
}

/** Check GitHub for a release newer than this build. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  return invoke("check_for_update");
}

/** Hide to tray without quitting. */
export async function hideWindow(): Promise<void> {
  return invoke("hide_window");
}

/** Quit the app, stopping the background loops and closing the tunnel first. */
export async function quitApp(): Promise<void> {
  return invoke("quit_app");
}

/** A profile's name and connection type, for the profile switcher. */
export interface ProfileInfo {
  name: string;
  conn_type: string;
}

/** Every configured profile, the connected one, and the one launch connects to. */
export interface ProfileList {
  active: string | null;
  startup: string | null;
  profiles: ProfileInfo[];
}

/** Every profile plus the connected and launch ones; rejects if config.toml is unreadable. */
export async function listProfiles(): Promise<ProfileList> {
  return invoke("list_profiles");
}

/** Settings for a named profile, or null if it is not on disk yet. */
export async function getProfileSettings(name: string): Promise<ConnectionSettings | null> {
  return invoke("get_profile_settings", { name });
}

/** A failed launch connect, as the Connection screen shows it. */
export interface LaunchStatus {
  error: string;
  /** Retries made so far. */
  attempt: number;
  /** Unix seconds of the next retry, null when it will not retry. */
  retry_at: number | null;
}

/** The failed launch connect and its retry, or null once any connect takes over. */
export async function getLaunchStatus(): Promise<LaunchStatus | null> {
  return invoke("get_launch_status");
}

/** Save a profile and its credential without connecting to it. */
export async function saveProfile(name: string, settings: ConnectionSettings): Promise<void> {
  return invoke("save_profile", { name, settings });
}

/** Delete a profile and its stored credential, disconnecting if active; unsaved is a no-op. */
export async function deleteProfile(name: string): Promise<void> {
  return invoke("delete_profile", { name });
}

/** Rename a profile, carrying its keyring credential across. */
export async function renameProfile(oldName: string, newName: string): Promise<void> {
  return invoke("rename_profile", { oldName, newName });
}

/** Switch to a different profile, connecting first and then saving it as active. */
export async function switchProfile(name: string): Promise<void> {
  return invoke("switch_profile", { name });
}

/** Recent activity entries, oldest first. */
export async function getActivityLog(): Promise<LogEntry[]> {
  return invoke("get_activity_log");
}

/** Clear the activity log in memory and in the database. */
export async function clearActivityLog(): Promise<void> {
  return invoke("clear_activity_log");
}

/** Update the tray tooltip and the speed line in the tray menu. */
export async function updateTrayInfo(tooltip: string, menuText: string): Promise<void> {
  return invoke("update_tray_info", { tooltip, menuText });
}

/** Every configured feed; rejects if rss.toml was unreadable at launch. */
export async function rssListFeeds(): Promise<RssFeedEntry[]> {
  return invoke("rss_list_feeds");
}

/** Save a feed, creating it or replacing the one with its key; renaming one refuses a taken key. */
export async function rssSaveFeed(feed: RssFeedEntry, previousKey?: string): Promise<void> {
  return invoke("rss_save_feed", { feed, previousKey: previousKey ?? null });
}

/** Delete a feed and stop polling it. */
export async function rssDeleteFeed(name: string): Promise<void> {
  return invoke("rss_delete_feed", { name });
}

/** Preview a feed's current items without matching rules or touching the poll timer. */
export async function rssPreviewFeed(name: string): Promise<RssFeedItem[]> {
  return invoke("rss_preview_feed", { name });
}

/** Every configured rule; rejects if rss.toml was unreadable at launch. */
export async function rssListRules(): Promise<RssRuleEntry[]> {
  return invoke("rss_list_rules");
}

/** Save a rule, creating or replacing it by key; refuses broken patterns or a catch-all exclude. */
export async function rssSaveRule(rule: RssRuleEntry): Promise<void> {
  return invoke("rss_save_rule", { rule });
}

/** Delete a rule, leaving its download history in place. */
export async function rssDeleteRule(name: string): Promise<void> {
  return invoke("rss_delete_rule", { name });
}

/** Test which of a feed's items a rule would match, without downloading. */
export async function rssTestRule(rule: RssRuleEntry, feed: string): Promise<RssMatchResult[]> {
  return invoke("rss_test_rule", { rule, feed });
}

/** Recent auto-downloads, newest first. */
export async function rssGetHistory(limit: number): Promise<RssDownloadRecord[]> {
  return invoke("rss_get_history", { limit });
}

/** Clear auto-download history for one rule or for all, resetting GUID and episode dedup. */
export async function rssClearHistory(rule?: string): Promise<void> {
  return invoke("rss_clear_history", { rule: rule ?? null });
}

/** Set background polling on or off, saving it to rss.toml. */
export async function rssSetEnabled(enabled: boolean): Promise<void> {
  return invoke("rss_set_enabled", { enabled });
}

/** Whether background polling is on. */
export async function rssIsEnabled(): Promise<boolean> {
  return invoke("rss_is_enabled");
}

/** Speed profiles and the 7x24 grid; rejects if scheduler.toml was unreadable at launch. */
export async function schedulerGetConfig(): Promise<SchedulerConfig> {
  return invoke("scheduler_get_config");
}

/** Save the schedule and reapply it on the next tick. */
export async function schedulerSaveConfig(config: SchedulerConfig): Promise<void> {
  return invoke("scheduler_save_config", { config });
}

/** Which profile the grid selects for the current day and hour. */
export async function schedulerGetActive(): Promise<SchedulerActive> {
  return invoke("scheduler_get_active");
}

/** One page of torrent history, with a total for paging. */
export async function historyList(query: HistoryQuery): Promise<TorrentHistoryPage> {
  return invoke("history_list", { query });
}

/** Archived .torrent bytes for a history entry, or null if none was kept. */
export async function historyGetBlob(id: number): Promise<number[] | null> {
  return invoke("history_get_blob", { id });
}

/** Delete one history entry. */
export async function historyDelete(id: number): Promise<void> {
  return invoke("history_delete", { id });
}

/** Replace characters Windows will not accept in a filename with underscores. */
function safeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "_");
}

/** Ask where to save a .torrent, then write it; false if cancelled or in demo mode. */
export async function saveTorrentAs(bytes: number[], name: string): Promise<boolean> {
  if (DEMO) return false;
  const path = await save({
    defaultPath: `${safeFileName(name)}.torrent`,
    filters: [{ name: "Torrent", extensions: ["torrent"] }],
  });
  if (!path) return false;
  await invoke("save_torrent_file", { path, data: bytes });
  return true;
}
