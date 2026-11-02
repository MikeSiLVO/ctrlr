import type {
  Torrent,
  TorrentDetails,
  TorrentFile,
  TorrentPeer,
  TorrentTracker,
  TransferStats,
  ServerCapabilities,
  LogEntry,
  RssFeedEntry,
  RssRuleEntry,
  RssDownloadRecord,
  RssFeedItem,
  SchedulerConfig,
  SchedulerActive,
  TorrentHistoryEntry,
  TorrentHistoryPage,
  HistoryQuery,
  HistorySort,
  SystemInfo,
} from "./types";
import type { ProfileList, RemoteSettings, RatioGroup, TorrentMeta } from "./api";

/** Bytes in a gibibyte. */
const GB = 1024 ** 3;
/** Bytes in a mebibyte. */
const MB = 1024 ** 2;
/** Bytes in a kibibyte. */
const KB = 1024;

/** Load time in Unix seconds, the base of every mock date. */
const now = Math.floor(Date.now() / 1000);
/** Seconds in an hour. */
const hour = 3600;
/** Seconds in a day. */
const day = 86400;

/** Fake 40-character info hash, the index in hex padded with zeros. */
function hash(i: number): string {
  return i.toString(16).padStart(40, "0");
}

/** Chunk size of every mock torrent, in bytes. */
const chunkSize = 4 * MB;

/** Mock torrent as written by hand, before withChunks fills in the derived fields. */
type MockTorrent = Omit<Torrent, "size_chunks" | "completed_chunks" | "wanted_chunks" | "fetching_metadata">;

/** Fill in chunk counts from the byte sizes, every file wanted and the metadata already fetched. */
function withChunks(t: MockTorrent): Torrent {
  const size_chunks = Math.ceil(t.size_bytes / chunkSize);
  const completed_chunks = Math.min(Math.ceil(t.bytes_done / chunkSize), size_chunks);
  return {
    ...t, size_chunks, completed_chunks, wanted_chunks: size_chunks - completed_chunks,
    fetching_metadata: false,
  };
}

/** Mock torrents for the table, chunk counts filled in from their sizes. */
export const torrents: Torrent[] = ([
  {
    hash: hash(1), name: "ubuntu-24.04.1-desktop-amd64.iso",
    size_bytes: 5.8 * GB, bytes_done: 5.8 * GB,
    up_rate: 2.4 * MB, down_rate: 0, up_total: 48.2 * GB, down_total: 5.8 * GB,
    ratio_millis: 8310, state: 1, complete: true, is_active: true, is_open: true,
    hashing: 0, is_private: false, priority: 2, directory: "/data/torrents/linux",
    message: "", date_added: now - 14 * day, date_created: now - 30 * day,
    date_finished: now - 14 * day + 900, peers_connected: 12, seeds_connected: 3,
    tags: ["linux"], comment: "Ubuntu CD releases.ubuntu.com", connection_seed: "seed_prefer",
    throttle_name: "", ratio_group: 0,
  },
  {
    hash: hash(2), name: "archlinux-2025.01.01-x86_64.iso",
    size_bytes: 1.1 * GB, bytes_done: 1.1 * GB,
    up_rate: 850 * KB, down_rate: 0, up_total: 22.6 * GB, down_total: 1.1 * GB,
    ratio_millis: 20545, state: 1, complete: true, is_active: true, is_open: true,
    hashing: 0, is_private: false, priority: 2, directory: "/data/torrents/linux",
    message: "", date_added: now - 21 * day, date_created: now - 40 * day,
    date_finished: now - 21 * day + 300, peers_connected: 6, seeds_connected: 8,
    tags: ["linux"], comment: "", connection_seed: "seed_prefer",
    throttle_name: "", ratio_group: 0,
  },
  {
    hash: hash(3), name: "debian-12.8.0-amd64-DVD-1.iso",
    size_bytes: 3.7 * GB, bytes_done: 3.7 * GB,
    up_rate: 1.6 * MB, down_rate: 0, up_total: 31.4 * GB, down_total: 3.7 * GB,
    ratio_millis: 8486, state: 1, complete: true, is_active: true, is_open: true,
    hashing: 0, is_private: false, priority: 2, directory: "/data/torrents/linux",
    message: "", date_added: now - 10 * day, date_created: now - 20 * day,
    date_finished: now - 10 * day + 600, peers_connected: 9, seeds_connected: 5,
    tags: ["linux"], comment: "", connection_seed: "seed_prefer",
    throttle_name: "", ratio_group: 0,
  },
  {
    hash: hash(4), name: "Big.Buck.Bunny.2008.4K.60fps.x265.mkv",
    size_bytes: 6.2 * GB, bytes_done: 6.2 * GB,
    up_rate: 380 * KB, down_rate: 0, up_total: 18.9 * GB, down_total: 6.2 * GB,
    ratio_millis: 3048, state: 1, complete: true, is_active: true, is_open: true,
    hashing: 0, is_private: false, priority: 2, directory: "/data/torrents/movies",
    message: "", date_added: now - 45 * day, date_created: now - 90 * day,
    date_finished: now - 45 * day + 1200, peers_connected: 4, seeds_connected: 11,
    tags: ["movies"], comment: "Blender Foundation - peach.blender.org", connection_seed: "seed_prefer",
    throttle_name: "", ratio_group: 0,
  },
  {
    hash: hash(5), name: "Sintel.2010.4K.x265.mkv",
    size_bytes: 4.8 * GB, bytes_done: 4.8 * GB,
    up_rate: 210 * KB, down_rate: 0, up_total: 9.1 * GB, down_total: 4.8 * GB,
    ratio_millis: 1896, state: 1, complete: true, is_active: true, is_open: true,
    hashing: 0, is_private: false, priority: 2, directory: "/data/torrents/movies",
    message: "", date_added: now - 30 * day, date_created: now - 60 * day,
    date_finished: now - 30 * day + 800, peers_connected: 2, seeds_connected: 7,
    tags: ["movies"], comment: "Blender Foundation - durian.blender.org", connection_seed: "seed_prefer",
    throttle_name: "", ratio_group: 0,
  },
  {
    hash: hash(6), name: "Tears.of.Steel.2012.1080p.x264.mkv",
    size_bytes: 1.9 * GB, bytes_done: 1.9 * GB,
    up_rate: 0, down_rate: 0, up_total: 4.2 * GB, down_total: 1.9 * GB,
    ratio_millis: 2210, state: 1, complete: true, is_active: true, is_open: true,
    hashing: 0, is_private: false, priority: 2, directory: "/data/torrents/movies",
    message: "", date_added: now - 60 * day, date_created: now - 120 * day,
    date_finished: now - 60 * day + 400, peers_connected: 0, seeds_connected: 4,
    tags: ["movies"], comment: "Blender Foundation - mango.blender.org", connection_seed: "seed_prefer",
    throttle_name: "", ratio_group: 0,
  },
  {
    hash: hash(7), name: "LibreOffice_25.2.0_Linux_x86-64_deb.tar.gz",
    size_bytes: 380 * MB, bytes_done: 380 * MB,
    up_rate: 120 * KB, down_rate: 0, up_total: 2.8 * GB, down_total: 380 * MB,
    ratio_millis: 7540, state: 1, complete: true, is_active: true, is_open: true,
    hashing: 0, is_private: false, priority: 2, directory: "/data/torrents/software",
    message: "", date_added: now - 7 * day, date_created: now - 14 * day,
    date_finished: now - 7 * day + 60, peers_connected: 3, seeds_connected: 15,
    tags: ["software"], comment: "", connection_seed: "seed_prefer",
    throttle_name: "", ratio_group: 0,
  },
  {
    hash: hash(8), name: "fedora-Workstation-Live-x86_64-41.iso",
    size_bytes: 2.1 * GB, bytes_done: 2.1 * GB,
    up_rate: 540 * KB, down_rate: 0, up_total: 12.8 * GB, down_total: 2.1 * GB,
    ratio_millis: 6095, state: 1, complete: true, is_active: true, is_open: true,
    hashing: 0, is_private: false, priority: 2, directory: "/data/torrents/linux",
    message: "", date_added: now - 5 * day, date_created: now - 12 * day,
    date_finished: now - 5 * day + 450, peers_connected: 7, seeds_connected: 6,
    tags: ["linux"], comment: "", connection_seed: "seed_prefer",
    throttle_name: "", ratio_group: 0,
  },

  {
    hash: hash(9), name: "Spring.2019.4K.Blender.Open.Movie.mkv",
    size_bytes: 8.4 * GB, bytes_done: 5.1 * GB,
    up_rate: 180 * KB, down_rate: 4.2 * MB, up_total: 620 * MB, down_total: 5.1 * GB,
    ratio_millis: 121, state: 1, complete: false, is_active: true, is_open: true,
    hashing: 0, is_private: false, priority: 2, directory: "/data/torrents/movies",
    message: "", date_added: now - 2 * hour, date_created: now - 30 * day,
    date_finished: 0, peers_connected: 8, seeds_connected: 14,
    tags: ["movies"], comment: "Blender Foundation - cloud.blender.org", connection_seed: "seed_prefer",
    throttle_name: "", ratio_group: 0,
  },
  {
    hash: hash(10), name: "openSUSE-Leap-15.6-DVD-x86_64.iso",
    size_bytes: 4.3 * GB, bytes_done: 1.8 * GB,
    up_rate: 95 * KB, down_rate: 2.8 * MB, up_total: 210 * MB, down_total: 1.8 * GB,
    ratio_millis: 116, state: 1, complete: false, is_active: true, is_open: true,
    hashing: 0, is_private: false, priority: 2, directory: "/data/torrents/linux",
    message: "", date_added: now - 1 * hour, date_created: now - 15 * day,
    date_finished: 0, peers_connected: 5, seeds_connected: 9,
    tags: ["linux"], comment: "", connection_seed: "seed_prefer",
    throttle_name: "", ratio_group: 0,
  },
  {
    hash: hash(11), name: "Blender-4.3.2-linux-x64.tar.xz",
    size_bytes: 540 * MB, bytes_done: 120 * MB,
    up_rate: 40 * KB, down_rate: 1.5 * MB, up_total: 18 * MB, down_total: 120 * MB,
    ratio_millis: 150, state: 1, complete: false, is_active: true, is_open: true,
    hashing: 0, is_private: false, priority: 2, directory: "/data/torrents/software",
    message: "", date_added: now - 20 * 60, date_created: now - 7 * day,
    date_finished: 0, peers_connected: 3, seeds_connected: 22,
    tags: ["software"], comment: "blender.org", connection_seed: "seed_prefer",
    throttle_name: "", ratio_group: 0,
  },
  {
    hash: hash(12), name: "linux-mint-22.1-cinnamon-64bit.iso",
    size_bytes: 2.8 * GB, bytes_done: 2.5 * GB,
    up_rate: 150 * KB, down_rate: 3.6 * MB, up_total: 380 * MB, down_total: 2.5 * GB,
    ratio_millis: 152, state: 1, complete: false, is_active: true, is_open: true,
    hashing: 0, is_private: false, priority: 2, directory: "/data/torrents/linux",
    message: "", date_added: now - 3 * hour, date_created: now - 10 * day,
    date_finished: 0, peers_connected: 6, seeds_connected: 18,
    tags: ["linux"], comment: "", connection_seed: "seed_prefer",
    throttle_name: "", ratio_group: 0,
  },

  {
    hash: hash(13), name: "FreeBSD-14.2-RELEASE-amd64-disc1.iso",
    size_bytes: 1.0 * GB, bytes_done: 1.0 * GB,
    up_rate: 0, down_rate: 0, up_total: 3.4 * GB, down_total: 1.0 * GB,
    ratio_millis: 3400, state: 1, complete: true, is_active: false, is_open: true,
    hashing: 0, is_private: false, priority: 2, directory: "/data/torrents/linux",
    message: "", date_added: now - 90 * day, date_created: now - 120 * day,
    date_finished: now - 90 * day + 200, peers_connected: 0, seeds_connected: 0,
    tags: ["linux"], comment: "", connection_seed: "seed_prefer",
    throttle_name: "", ratio_group: 0,
  },
  {
    hash: hash(14), name: "Cosmos.Laundromat.2015.4K.x265.mkv",
    size_bytes: 3.2 * GB, bytes_done: 3.2 * GB,
    up_rate: 0, down_rate: 0, up_total: 6.8 * GB, down_total: 3.2 * GB,
    ratio_millis: 2125, state: 1, complete: true, is_active: false, is_open: true,
    hashing: 0, is_private: false, priority: 2, directory: "/data/torrents/movies",
    message: "", date_added: now - 75 * day, date_created: now - 150 * day,
    date_finished: now - 75 * day + 500, peers_connected: 0, seeds_connected: 0,
    tags: ["movies"], comment: "Blender Foundation", connection_seed: "seed_prefer",
    throttle_name: "", ratio_group: 0,
  },
  {
    hash: hash(15), name: "GIMP-2.10.38-setup.exe",
    size_bytes: 320 * MB, bytes_done: 320 * MB,
    up_rate: 0, down_rate: 0, up_total: 1.6 * GB, down_total: 320 * MB,
    ratio_millis: 5120, state: 1, complete: true, is_active: false, is_open: true,
    hashing: 0, is_private: false, priority: 1, directory: "/data/torrents/software",
    message: "", date_added: now - 50 * day, date_created: now - 80 * day,
    date_finished: now - 50 * day + 45, peers_connected: 0, seeds_connected: 0,
    tags: ["software"], comment: "gimp.org", connection_seed: "seed_prefer",
    throttle_name: "", ratio_group: 0,
  },

  {
    hash: hash(16), name: "KDE-neon-user-20250110-1218.iso",
    size_bytes: 3.9 * GB, bytes_done: 3.9 * GB,
    up_rate: 0, down_rate: 0, up_total: 7.8 * GB, down_total: 3.9 * GB,
    ratio_millis: 2000, state: 0, complete: true, is_active: false, is_open: false,
    hashing: 0, is_private: false, priority: 2, directory: "/data/torrents/linux",
    message: "", date_added: now - 100 * day, date_created: now - 130 * day,
    date_finished: now - 100 * day + 700, peers_connected: 0, seeds_connected: 0,
    tags: ["linux"], comment: "", connection_seed: "seed_prefer",
    throttle_name: "", ratio_group: 0,
  },
  {
    hash: hash(17), name: "tails-amd64-6.11.img",
    size_bytes: 1.4 * GB, bytes_done: 1.4 * GB,
    up_rate: 0, down_rate: 0, up_total: 4.9 * GB, down_total: 1.4 * GB,
    ratio_millis: 3500, state: 0, complete: true, is_active: false, is_open: false,
    hashing: 0, is_private: false, priority: 2, directory: "/data/torrents/linux",
    message: "", date_added: now - 120 * day, date_created: now - 160 * day,
    date_finished: now - 120 * day + 350, peers_connected: 0, seeds_connected: 0,
    tags: ["linux"], comment: "tails.net", connection_seed: "seed_prefer",
    throttle_name: "", ratio_group: 0,
  },

  {
    hash: hash(18), name: "manjaro-kde-24.2.1-250115-linux610.iso",
    size_bytes: 4.1 * GB, bytes_done: 900 * MB,
    up_rate: 60 * KB, down_rate: 980 * KB, up_total: 30 * MB, down_total: 900 * MB,
    ratio_millis: 33, state: 1, complete: false, is_active: true, is_open: true,
    hashing: 0, is_private: false, priority: 2, directory: "/data/torrents/linux",
    message: "", date_added: now - 45 * 60, date_created: now - 5 * day,
    date_finished: 0, peers_connected: 4, seeds_connected: 10,
    tags: ["linux"], comment: "", connection_seed: "seed_prefer",
    throttle_name: "slow", ratio_group: 0,
  },

  {
    hash: hash(19), name: "Inkscape-1.4-x86_64.AppImage",
    size_bytes: 110 * MB, bytes_done: 110 * MB,
    up_rate: 75 * KB, down_rate: 0, up_total: 890 * MB, down_total: 110 * MB,
    ratio_millis: 8090, state: 1, complete: true, is_active: true, is_open: true,
    hashing: 0, is_private: false, priority: 2, directory: "/data/torrents/software",
    message: "", date_added: now - 35 * day, date_created: now - 50 * day,
    date_finished: now - 35 * day + 20, peers_connected: 1, seeds_connected: 9,
    tags: ["software"], comment: "inkscape.org", connection_seed: "seed_prefer",
    throttle_name: "slow", ratio_group: 0,
  },

  {
    hash: hash(20), name: "NixOS-24.11-x86_64-linux.iso",
    size_bytes: 2.4 * GB, bytes_done: 2.4 * GB,
    up_rate: 1.1 * MB, down_rate: 0, up_total: 16.2 * GB, down_total: 2.4 * GB,
    ratio_millis: 6750, state: 1, complete: true, is_active: true, is_open: true,
    hashing: 0, is_private: false, priority: 2, directory: "/data/torrents/linux",
    message: "", date_added: now - 18 * day, date_created: now - 25 * day,
    date_finished: now - 18 * day + 500, peers_connected: 8, seeds_connected: 4,
    tags: ["linux"], comment: "nixos.org", connection_seed: "seed_prefer",
    throttle_name: "", ratio_group: 0,
  },
] as MockTorrent[]).map(withChunks);

/** Mock global transfer rates and totals. */
export const stats: TransferStats = {
  up_rate: 7.6 * MB,
  up_total: 192.4 * GB,
  down_rate: 13.1 * MB,
  down_total: 58.3 * GB,
};

/** Mock global limits as [up, down], both unlimited. */
export const speedLimits: [number, number] = [0, 0];

/** Mock free disk space in bytes. */
export const diskFree = 482 * GB;

/** Mock server capabilities, every optional feature on. */
export const capabilities: ServerCapabilities = {
  has_dht_mode: true,
  has_scheduler_max_active: true,
  has_send_buffer_size: true,
  has_receive_buffer_size: true,
  has_tracker_scrape: true,
  has_peer_banned: true,
  has_peer_disconnect: true,
  has_peer_obfuscated: true,
  has_peer_snubbed: true,
  has_disconnect_seeders: true,
  has_file_prioritize_first: true,
  has_file_prioritize_last: true,
  has_tracker_insert: true,
  has_d_chunk_size: true,
  has_d_wanted_chunks: true,
  has_d_load_date: true,
  has_d_state_changed: true,
  has_d_skip_total: true,
  has_d_peers_connected: true,
  has_d_peers_not_connected: true,
  has_d_uploads_max: true,
  has_d_tracker_numwant: true,
  has_dht_override_port: true,
  has_tracker_numwant: true,
  has_ratio_groups: true,
  has_session_path: true,
  has_execute_capture: true,
  has_p_up_total: true,
  has_p_down_total: true,
  has_p_peer_rate: true,
  has_t_scrape_time_last: true,
  has_t_normal_interval: true,
  methods: [],
};

/** Mock profile list: one active SSH profile. */
export const profiles: ProfileList = {
  active: "Seedbox",
  startup: "Seedbox",
  profiles: [{ name: "Seedbox", conn_type: "ssh" }],
};

/** Client names the mock peers cycle through. */
const clientVersions = [
  "qBittorrent/5.0.3", "Transmission/4.0.6", "Deluge/2.1.1",
  "libtorrent/2.0.11", "rTorrent/0.10.0", "Vuze/5.8.0.0",
  "KTorrent/24.08.3", "aria2/1.37.0",
];

/** Country codes the mock peers cycle through. */
const countries = [
  "DE", "US", "FR", "NL", "JP", "GB", "CA", "AU", "SE", "BR",
];

/** Generate mock peers with varied clients, rates and encryption flags. */
function generatePeers(count: number): TorrentPeer[] {
  return Array.from({ length: count }, (_, i) => ({
    address: `${100 + i}.${20 + (i * 7) % 200}.${(i * 13) % 255}.${(i * 31) % 255}:${6881 + i}`,
    client_version: clientVersions[i % clientVersions.length],
    completed_percent: Math.min(100, 20 + i * 12),
    up_rate: (50 + i * 30) * KB,
    down_rate: (20 + i * 15) * KB,
    up_total: (10 + i * 5) * MB,
    down_total: (5 + i * 3) * MB,
    peer_rate: (100 + i * 40) * KB,
    is_encrypted: i % 3 !== 0,
    is_incoming: i % 4 === 0,
    is_obfuscated: i % 5 === 0,
    is_snubbed: false,
    id_html: `-${clientVersions[i % clientVersions.length].slice(0, 2)}${i}0- [${countries[i % countries.length]}]`,
  }));
}

/** Generate three public mock trackers, scrape counts derived from the torrent. */
function generateTrackers(t: Torrent): TorrentTracker[] {
  const trackerUrls = [
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.stealth.si:80/announce",
    "udp://tracker.torrent.eu.org:451/announce",
  ];
  return trackerUrls.map((url, i) => ({
    url,
    tracker_type: 2,
    is_enabled: true,
    scrape_complete: t.seeds_connected + 20 + i * 5,
    scrape_incomplete: t.peers_connected + 8 + i * 3,
    scrape_downloaded: 1200 + i * 400,
    group: i,
    scrape_time_last: now - 300 * (i + 1),
    normal_interval: 1800,
  }));
}

/** Generate mock files: one for a disc image, else video, subtitles, nfo and an unwanted sample. */
function generateFiles(t: Torrent): TorrentFile[] {
  const ext = t.name.split(".").pop() ?? "";

  if (["iso", "img"].includes(ext)) {
    const chunks = Math.ceil(t.size_bytes / chunkSize);
    const doneChunks = Math.ceil(t.bytes_done / chunkSize);
    return [{
      index: 0, path: t.name, size_bytes: t.size_bytes,
      size_chunks: chunks, completed_chunks: doneChunks, priority: 1,
    }];
  }

  const baseName = t.name.replace(/\.[^.]+$/, "");
  const mainSize = Math.floor(t.size_bytes * 0.92);
  const subSize = Math.floor(t.size_bytes * 0.04);
  const nfoSize = Math.floor(t.size_bytes * 0.0001);
  const sampleSize = t.size_bytes - mainSize - subSize - nfoSize;
  const ratio = t.size_bytes > 0 ? t.bytes_done / t.size_bytes : 1;

  return [
    {
      index: 0, path: `${baseName}/${t.name}`, size_bytes: mainSize,
      size_chunks: Math.ceil(mainSize / chunkSize),
      completed_chunks: Math.ceil(mainSize * ratio / chunkSize), priority: 1,
    },
    {
      index: 1, path: `${baseName}/${baseName}.srt`, size_bytes: subSize,
      size_chunks: Math.ceil(subSize / chunkSize),
      completed_chunks: Math.ceil(subSize * ratio / chunkSize), priority: 1,
    },
    {
      index: 2, path: `${baseName}/${baseName}.nfo`, size_bytes: nfoSize,
      size_chunks: 1, completed_chunks: ratio >= 1 ? 1 : 0, priority: 1,
    },
    {
      index: 3, path: `${baseName}/Sample/${baseName}.sample.mkv`, size_bytes: sampleSize,
      size_chunks: Math.ceil(sampleSize / chunkSize),
      completed_chunks: Math.ceil(sampleSize * ratio / chunkSize), priority: 0,
    },
  ];
}

/** Mock detail panel data for a torrent, the first one when the hash is unknown. */
export function torrentDetails(h: string): TorrentDetails {
  const t = torrents.find((t) => t.hash === h) ?? torrents[0];
  const files = generateFiles(t);
  const wantedRemaining = files
    .filter((f) => f.priority > 0)
    .reduce((s, f) => s + (f.size_chunks - f.completed_chunks), 0);

  return {
    files,
    peers: generatePeers(t.peers_connected),
    trackers: generateTrackers(t),
    chunk_size: chunkSize,
    wanted_chunks: wantedRemaining,
    load_date: t.date_added,
    is_private: t.is_private,
    state_changed: t.is_active ? t.date_added + 10 : t.date_finished + day,
    skip_total: Math.round(t.bytes_done * 0.002),
    peers_connected: t.peers_connected,
    peers_not_connected: t.peers_connected + 15,
  };
}

/** Mock rTorrent and libtorrent versions and hostname. */
export const systemInfo: SystemInfo = {
  client_version: "0.10.0",
  library_version: "0.14.0",
  hostname: "seedbox.example.com",
};

/** Mock activity log, starting empty. */
export const activityLog: LogEntry[] = [];

/** Mock RSS feeds the mock rules and history name. */
export const rssFeeds: RssFeedEntry[] = [
  { key: "Linux ISOs", url: "https://linuxtracker.org/rss.xml", poll_secs: 300, enabled: true, cookie: "" },
  { key: "Blender Open Movies", url: "https://blender.org/feeds/movies.xml", poll_secs: 600, enabled: true, cookie: "" },
];

/** Mock RSS rules, one plain and one with an exclude and a quality list. */
export const rssRules: RssRuleEntry[] = [
  {
    key: "Ubuntu Releases", name: "Ubuntu Releases",
    pattern: "ubuntu.*desktop.*amd64", exclude: "",
    feeds: ["Linux ISOs"], directory: "/data/torrents/linux", label: "linux",
    throttle: "", smart_episode: false, quality: [], start_season: 0, start_episode: 0, enabled: true,
  },
  {
    key: "Blender Films", name: "Blender Films",
    pattern: "(Big\\.Buck\\.Bunny|Sintel|Tears\\.of\\.Steel|Spring|Cosmos).*4K",
    exclude: "sample",
    feeds: ["Blender Open Movies"], directory: "/data/torrents/movies", label: "movies",
    throttle: "", smart_episode: false, quality: ["4K", "1080p"], start_season: 0, start_episode: 0, enabled: true,
  },
];

/** Mock RSS downloads, linked to the mock torrents by hash. */
export const rssHistory: RssDownloadRecord[] = [
  { timestamp: now - 14 * day, feed: "Linux ISOs", rule: "Ubuntu Releases", guid: "ubuntu-2404", title: "ubuntu-24.04.1-desktop-amd64.iso", hash: hash(1), season: 0, episode: 0 },
  { timestamp: now - 21 * day, feed: "Linux ISOs", rule: "Ubuntu Releases", guid: "arch-2025", title: "archlinux-2025.01.01-x86_64.iso", hash: hash(2), season: 0, episode: 0 },
  { timestamp: now - 10 * day, feed: "Linux ISOs", rule: "Ubuntu Releases", guid: "debian-128", title: "debian-12.8.0-amd64-DVD-1.iso", hash: hash(3), season: 0, episode: 0 },
  { timestamp: now - 45 * day, feed: "Blender Open Movies", rule: "Blender Films", guid: "bbb-4k", title: "Big.Buck.Bunny.2008.4K.60fps.x265.mkv", hash: hash(4), season: 0, episode: 0 },
  { timestamp: now - 30 * day, feed: "Blender Open Movies", rule: "Blender Films", guid: "sintel-4k", title: "Sintel.2010.4K.x265.mkv", hash: hash(5), season: 0, episode: 0 },
  { timestamp: now - 60 * day, feed: "Blender Open Movies", rule: "Blender Films", guid: "tos-1080", title: "Tears.of.Steel.2012.1080p.x264.mkv", hash: hash(6), season: 0, episode: 0 },
  { timestamp: now - 5 * day, feed: "Linux ISOs", rule: "Ubuntu Releases", guid: "fedora-41", title: "fedora-Workstation-Live-x86_64-41.iso", hash: hash(8), season: 0, episode: 0 },
  { timestamp: now - 2 * hour, feed: "Blender Open Movies", rule: "Blender Films", guid: "spring-4k", title: "Spring.2019.4K.Blender.Open.Movie.mkv", hash: hash(9), season: 0, episode: 0 },
];

/** Mock feed items keyed by feed name. */
export const rssFeedItems: Record<string, RssFeedItem[]> = {
  "Linux ISOs": [
    { title: "ubuntu-24.04.1-desktop-amd64.iso", guid: "ubuntu-2404", link: "https://releases.ubuntu.com/24.04.1/", published: now - 14 * day },
    { title: "archlinux-2025.01.01-x86_64.iso", guid: "arch-2025", link: "https://archlinux.org/download/", published: now - 21 * day },
    { title: "debian-12.8.0-amd64-DVD-1.iso", guid: "debian-128", link: "https://www.debian.org/CD/", published: now - 10 * day },
    { title: "fedora-Workstation-Live-x86_64-41.iso", guid: "fedora-41", link: "https://fedoraproject.org/workstation/download", published: now - 5 * day },
    { title: "linux-mint-22.1-cinnamon-64bit.iso", guid: "mint-221", link: "https://linuxmint.com/download.php", published: now - 3 * hour },
    { title: "openSUSE-Leap-15.6-DVD-x86_64.iso", guid: "opensuse-156", link: "https://get.opensuse.org/leap/", published: now - 1 * hour },
  ],
  "Blender Open Movies": [
    { title: "Big.Buck.Bunny.2008.4K.60fps.x265.mkv", guid: "bbb-4k", link: "https://peach.blender.org/", published: now - 45 * day },
    { title: "Sintel.2010.4K.x265.mkv", guid: "sintel-4k", link: "https://durian.blender.org/", published: now - 30 * day },
    { title: "Tears.of.Steel.2012.1080p.x264.mkv", guid: "tos-1080", link: "https://mango.blender.org/", published: now - 60 * day },
    { title: "Spring.2019.4K.Blender.Open.Movie.mkv", guid: "spring-4k", link: "https://cloud.blender.org/spring/", published: now - 2 * hour },
  ],
};

/** Weekday grid row: Peak Hours from 08:00 to 18:00, unlimited otherwise. */
const peakHours  = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0];
/** Weekend grid row, unlimited all day. */
const weekendDay = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

/** Mock scheduler: Peak Hours limits on weekday daytimes. */
export const schedulerConfig: SchedulerConfig = {
  enabled: true,
  profiles: [
    { name: "Peak Hours", down_kb: 2048, up_kb: 512 },
  ],
  grid: {
    mon: [...peakHours],
    tue: [...peakHours],
    wed: [...peakHours],
    thu: [...peakHours],
    fri: [...peakHours],
    sat: [...weekendDay],
    sun: [...weekendDay],
  },
};

/** Grid day keys in `Date.getDay()` order, Sunday first. */
const dayNames = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
/** Load time as a Date, for picking the active grid cell. */
const loadedAt = new Date(now * 1000);
/** Mock active cell: today's grid row at the load hour, days counted from Monday. */
export const schedulerActive: SchedulerActive = {
  profile_index: schedulerConfig.grid[dayNames[loadedAt.getDay()]][loadedAt.getHours()] ?? 0,
  day: (loadedAt.getDay() + 6) % 7,
  hour: loadedAt.getHours(),
};

/** Mock ratio groups: one with no action and one that stops. */
export const ratioGroups: RatioGroup[] = [
  { id: 0, enabled: true, min: 1.0, max: 0, upload_gib: 0, action: "none" },
  { id: 1, enabled: true, min: 2.0, max: 5.0, upload_gib: 50, action: "stop" },
];

/** Mock rTorrent settings for the Remote tab. */
export const remoteSettings: RemoteSettings = {
  default_directory: "/data/torrents",
  max_uploads: 50,
  max_downloads: 25,
  min_peers_normal: 100,
  max_peers_normal: 200,
  min_peers_seed: 10,
  max_peers_seed: 50,
  port_range: "49160-49170",
  pex: true,
  dht: "auto",
  encryption: "prefer_plaintext",
  hash_on_completion: true,
  scheduler_max_active: 10,
  send_buffer_size: 131072,
  receive_buffer_size: 131072,
  dht_override_port: null,
  tracker_numwant: -1,
};

/** Mock history of the mock torrents; every third is a magnet with no stored .torrent. */
export const torrentHistory: TorrentHistoryEntry[] = torrents.map((t, i) => ({
  id: i + 1,
  info_hash: t.hash,
  name: t.name,
  total_size: t.size_bytes,
  directory: t.directory,
  labels: t.tags,
  trackers: ["tracker.opentrackr.org", "open.stealth.si"],
  source: i % 3 === 0 ? "magnet" : "file",
  is_private: false,
  added_at: t.date_added,
  removed_at: t.state === 0 ? t.date_added + 30 * day : null,
  has_blob: i % 3 !== 0,
  loaded: t.state !== 0,
}));

/** Sort key of each History column, matching the database's order. */
const HISTORY_KEYS: Record<HistorySort, (e: TorrentHistoryEntry) => string | number> = {
  name: (e) => (e.name || e.info_hash).toLowerCase(),
  size: (e) => e.total_size,
  added: (e) => e.added_at,
  status: (e) => (e.loaded ? 0 : 1),
};

/** Mock History page, filtered and sorted as the database does it. */
export function historyPage(q: HistoryQuery): TorrentHistoryPage {
  const key = HISTORY_KEYS[q.sort];
  const search = q.search?.toLowerCase();
  const rows = torrentHistory
    .filter((e) => (!search || e.name.toLowerCase().includes(search))
      && (!q.source || e.source === q.source)
      && (q.loaded === null || e.loaded === q.loaded))
    .sort((a, b) => {
      const x = key(a);
      const y = key(b);
      const c = x < y ? -1 : x > y ? 1 : 0;
      return (q.desc ? -c : c) || b.added_at - a.added_at;
    });
  return { entries: rows.slice(q.page * q.page_size, (q.page + 1) * q.page_size), total: rows.length };
}

/** Sample .torrent files the Add dialog opens with. */
export const demoAddTorrents: {
  fileName: string;
  meta: TorrentMeta;
}[] = [
  {
    fileName: "ubuntu-24.04.2-desktop-amd64.iso.torrent",
    meta: {
      info_hash: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
      name: "ubuntu-24.04.2-desktop-amd64.iso",
      total_size: 5.8 * GB,
      piece_length: 4 * MB,
      piece_count: Math.ceil(5.8 * GB / (4 * MB)),
      files: [{ path: "ubuntu-24.04.2-desktop-amd64.iso", size: 5.8 * GB }],
    },
  },
  {
    fileName: "Big.Buck.Bunny.2008.4K.60fps.x265.torrent",
    meta: {
      info_hash: "b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3",
      name: "Big.Buck.Bunny.2008.4K.60fps.x265",
      total_size: 6.2 * GB,
      piece_length: 4 * MB,
      piece_count: Math.ceil(6.2 * GB / (4 * MB)),
      files: [
        { path: "Big.Buck.Bunny.2008.4K.60fps.x265/Big.Buck.Bunny.2008.4K.60fps.x265.mkv", size: 5.7 * GB },
        { path: "Big.Buck.Bunny.2008.4K.60fps.x265/Big.Buck.Bunny.2008.4K.60fps.x265.srt", size: 248 * MB },
        { path: "Big.Buck.Bunny.2008.4K.60fps.x265/Big.Buck.Bunny.2008.4K.60fps.x265.nfo", size: 620 * KB },
        { path: "Big.Buck.Bunny.2008.4K.60fps.x265/Sample/Big.Buck.Bunny.sample.mkv", size: 245 * MB },
      ],
    },
  },
  {
    fileName: "Blender-4.3.2-linux-x64.tar.xz.torrent",
    meta: {
      info_hash: "c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
      name: "Blender-4.3.2-linux-x64.tar.xz",
      total_size: 540 * MB,
      piece_length: 2 * MB,
      piece_count: Math.ceil(540 * MB / (2 * MB)),
      files: [{ path: "Blender-4.3.2-linux-x64.tar.xz", size: 540 * MB }],
    },
  },
];

/** Subdirectories for the directory browser. */
export function remoteDirectory(path: string): string[] {
  if (path.endsWith("/downloads") || path === "") return ["complete", "incomplete", "tv", "movies"];
  return [];
}

/** Per-torrent tunables for the properties dialog. */
export function torrentProperties() {
  return {
    max_uploads: 8,
    peers_min: 40,
    peers_max: 100,
    tracker_numwant: -1,
    connection_seed: "seed",
  };
}
