/** One torrent row from the main view multicall. */
export interface Torrent {
  hash: string;
  name: string;
  size_bytes: number;
  bytes_done: number;
  up_rate: number;
  down_rate: number;
  up_total: number;
  down_total: number;
  ratio_millis: number;
  state: number;
  complete: boolean;
  is_active: boolean;
  is_open: boolean;
  hashing: number;
  is_private: boolean;
  priority: number;
  directory: string;
  message: string;
  date_added: number;
  date_created: number;
  date_finished: number;
  peers_connected: number;
  seeds_connected: number;
  tags: string[];
  comment: string;
  connection_seed: string;
  throttle_name: string;
  ratio_group: number;
  size_chunks: number;
  completed_chunks: number;
  /** Chunks still wanted, null when the server lacks d.wanted_chunks. */
  wanted_chunks: number | null;
  /** A magnet still fetching its metadata from peers. */
  fetching_metadata: boolean;
}

/** One file inside a torrent, from the details batch. */
export interface TorrentFile {
  index: number;
  path: string;
  size_bytes: number;
  size_chunks: number;
  completed_chunks: number;
  priority: number;
}

/** One connected peer of a torrent, from the details batch. */
export interface TorrentPeer {
  address: string;
  client_version: string;
  completed_percent: number;
  up_rate: number;
  down_rate: number;
  up_total: number;
  down_total: number;
  peer_rate: number;
  is_encrypted: boolean;
  is_incoming: boolean;
  is_obfuscated: boolean;
  is_snubbed: boolean;
  id_html: string;
}

/** One tracker of a torrent, from the details batch. */
export interface TorrentTracker {
  url: string;
  tracker_type: number;
  is_enabled: boolean;
  scrape_complete: number;
  scrape_incomplete: number;
  scrape_downloaded: number;
  group: number;
  scrape_time_last: number;
  normal_interval: number;
}

/** Detail panel data for one torrent, fetched in one batch. */
export interface TorrentDetails {
  files: TorrentFile[];
  peers: TorrentPeer[];
  trackers: TorrentTracker[];
  chunk_size: number;
  wanted_chunks: number;
  load_date: number;
  is_private: boolean;
  state_changed: number;
  /** Wasted bytes, incoming data rTorrent discarded, not a chunk count. */
  skip_total: number;
  peers_connected: number;
  peers_not_connected: number;
}

/** Global up and down rates and totals. */
export interface TransferStats {
  up_rate: number;
  up_total: number;
  down_rate: number;
  down_total: number;
}

/** A Ctrl+R release newer than the running build. */
export interface UpdateInfo {
  version: string;
  url: string;
}

/** rTorrent version, library version and hostname. */
export interface SystemInfo {
  client_version: string;
  library_version: string;
  hostname: string;
}

/** Which optional rTorrent commands this server exposes, from system.listMethods. */
export interface ServerCapabilities {
  has_dht_mode: boolean;
  has_scheduler_max_active: boolean;
  has_send_buffer_size: boolean;
  has_receive_buffer_size: boolean;
  has_tracker_scrape: boolean;
  has_peer_banned: boolean;
  has_peer_disconnect: boolean;
  has_peer_obfuscated: boolean;
  has_peer_snubbed: boolean;
  has_disconnect_seeders: boolean;
  has_file_prioritize_first: boolean;
  has_file_prioritize_last: boolean;
  has_tracker_insert: boolean;
  has_d_chunk_size: boolean;
  has_d_wanted_chunks: boolean;
  has_d_load_date: boolean;
  has_d_state_changed: boolean;
  has_d_skip_total: boolean;
  has_d_peers_connected: boolean;
  has_d_peers_not_connected: boolean;
  has_d_uploads_max: boolean;
  has_d_tracker_numwant: boolean;
  has_dht_override_port: boolean;
  has_tracker_numwant: boolean;
  has_ratio_groups: boolean;
  has_session_path: boolean;
  has_execute_capture: boolean;
  has_p_up_total: boolean;
  has_p_down_total: boolean;
  has_p_peer_rate: boolean;
  has_t_scrape_time_last: boolean;
  has_t_normal_interval: boolean;
  methods: string[];
}

/** One entry in the app's own activity log, not rTorrent's. */
export interface LogEntry {
  timestamp: number;
  level: string;
  category: string;
  message: string;
}

/** One configured RSS feed, keyed by its name. */
export interface RssFeedEntry {
  key: string;
  url: string;
  poll_secs: number;
  enabled: boolean;
  cookie: string;
}

/** One RSS auto-download rule and the feeds it watches. */
export interface RssRuleEntry {
  key: string;
  name: string;
  pattern: string;
  exclude: string;
  feeds: string[];
  directory: string;
  label: string;
  throttle: string;
  smart_episode: boolean;
  quality: string[];
  start_season: number;
  start_episode: number;
  enabled: boolean;
}

/** One item fetched from a feed. */
export interface RssFeedItem {
  title: string;
  guid: string;
  link: string;
  published: number | null;
}

/** Season, episode and quality parsed from a matched title. */
export interface RssMatchEpisodeInfo {
  season: number;
  episode: number;
  quality: string | null;
}

/** One feed item a rule matches, and why it would be skipped if it would. */
export interface RssMatchResult {
  title: string;
  rule_name: string;
  guid: string;
  episode_info: RssMatchEpisodeInfo | null;
  skipped: boolean;
  skip_reason: string | null;
}

/** One past auto-download, the record episode dedup checks against. */
export interface RssDownloadRecord {
  timestamp: number;
  feed: string;
  rule: string;
  guid: string;
  title: string;
  hash: string;
  season: number;
  episode: number;
}

/** A named pair of speed limits in KB per second, 0 for unlimited. */
export interface SchedulerProfile {
  name: string;
  down_kb: number;
  up_kb: number;
}

/** Profile index for each hour of each weekday, 24 per day; 0 is unlimited, profiles start at 1. */
export interface SchedulerGrid {
  mon: number[];
  tue: number[];
  wed: number[];
  thu: number[];
  fri: number[];
  sat: number[];
  sun: number[];
}

/** Bandwidth schedule: speed profiles, the weekly grid and whether it runs. */
export interface SchedulerConfig {
  enabled: boolean;
  profiles: SchedulerProfile[];
  grid: SchedulerGrid;
}

/** The profile the grid selects now, with the day (0 is Monday) and hour it read. */
export interface SchedulerActive {
  profile_index: number;
  day: number;
  hour: number;
}

/** One torrent the app has added, kept in local history after removal. */
export interface TorrentHistoryEntry {
  id: number;
  info_hash: string;
  name: string;
  total_size: number;
  directory: string;
  labels: string[];
  trackers: string[];
  source: string;
  is_private: boolean;
  added_at: number;
  removed_at: number | null;
  has_blob: boolean;
  /** Loaded on the connected server, or not yet removed while disconnected. */
  loaded: boolean;
}

/** Columns History can sort by. */
export type HistorySort = "name" | "size" | "added" | "status";

/** Filters, sort order and page for one History listing. */
export interface HistoryQuery {
  page: number;
  page_size: number;
  search: string | null;
  source: string | null;
  /** Only loaded entries, or only removed ones. */
  loaded: boolean | null;
  sort: HistorySort;
  desc: boolean;
}

/** One page of torrent history and the count of entries matching the filters. */
export interface TorrentHistoryPage {
  entries: TorrentHistoryEntry[];
  total: number;
}

/** Status buckets offered in the sidebar. */
export type StatusFilter =
  | "all"
  | "downloading"
  | "seeding"
  | "stopped"
  | "active"
  | "hashing";

/** Columns the torrent table can sort by. */
export type SortField =
  | "name"
  | "size"
  | "progress"
  | "down"
  | "up"
  | "ratio"
  | "status"
  | "seeds"
  | "peers"
  | "label"
  | "added"
  | "eta"
  | "priority"
  | "uploaded"
  | "downloaded"
  | "created"
  | "swarm";
