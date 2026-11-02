//! Data models for rTorrent torrents, files, peers, trackers and server capabilities.
use serde::{Deserialize, Serialize};

use crate::rpc::RpcError;

/// Fields requested in d.multicall2, in the order from_multicall_row reads them.
pub const MULTICALL_FIELDS: &[&str] = &[
    "d.hash=",
    "d.name=",
    "d.state=",
    "d.is_active=",
    "d.complete=",
    "d.is_open=",
    "d.is_private=",
    "d.hashing=",
    "d.priority=",
    "d.up.rate=",
    "d.up.total=",
    "d.down.rate=",
    "d.down.total=",
    "d.ratio=",
    "d.bytes_done=",
    "d.size_bytes=",
    "d.directory=",
    "d.creation_date=",
    "d.timestamp.finished=",
    "d.timestamp.started=",
    "d.custom=addtime",
    "d.custom1=",
    "d.custom2=",
    "d.message=",
    "d.peers_complete=",
    "d.peers_connected=",
    "d.connection_seed=",
    "d.throttle_name=",
    "cat=$d.views=",
    "d.size_chunks=",
    "d.completed_chunks=",
];

/// One torrent in the main view, as listed by d.multicall2.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Torrent {
    pub hash: String,
    pub name: String,
    pub size_bytes: i64,
    pub bytes_done: i64,
    pub up_rate: i64,
    pub down_rate: i64,
    pub up_total: i64,
    pub down_total: i64,
    /// Ratio * 1000 as returned by rTorrent.
    pub ratio_millis: i64,
    pub state: i64,
    pub complete: bool,
    pub is_active: bool,
    pub is_open: bool,
    /// 0 not hashing, 1 normal, 2 after finish, 3 rehashing.
    pub hashing: i64,
    pub is_private: bool,
    pub priority: i64,
    pub directory: String,
    pub message: String,
    pub date_added: i64,
    pub date_created: i64,
    pub date_finished: i64,
    pub peers_connected: i64,
    pub seeds_connected: i64,
    pub tags: Vec<String>,
    pub comment: String,
    pub connection_seed: String,
    pub throttle_name: String,
    /// Ratio group index (0-7), or -1 if not in any ratio group.
    pub ratio_group: i64,
    pub size_chunks: i64,
    pub completed_chunks: i64,
    /// Chunks still wanted. None when the server lacks d.wanted_chunks.
    pub wanted_chunks: Option<i64>,
    /// A magnet still fetching its metadata, which rTorrent names `<HASH>.meta`.
    pub fetching_metadata: bool,
}

/// Parse the ratio group from a d.views list, rat_N for N in 0 to 7, or -1 for none.
fn parse_ratio_group(views: &str) -> i64 {
    for segment in views.split(',') {
        let s = segment.trim();
        if let Some(n) = s.strip_prefix("rat_")
            && let Ok(i) = n.parse::<i64>()
                && (0..8).contains(&i) {
                    return i;
                }
    }
    -1
}

impl Torrent {
    /// Parse a torrent from one d.multicall2 row in MULTICALL_FIELDS order.
    pub fn from_multicall_row(row: &[serde_json::Value]) -> Result<Self, RpcError> {
        if row.len() < MULTICALL_FIELDS.len() {
            return Err(RpcError::Protocol(format!(
                "expected {} fields per torrent, got {}",
                MULTICALL_FIELDS.len(),
                row.len()
            )));
        }

        fn str_at(row: &[serde_json::Value], i: usize) -> String {
            row[i].as_str().unwrap_or("").to_string()
        }

        fn i64_at(row: &[serde_json::Value], i: usize) -> i64 {
            row[i].as_i64().unwrap_or(0)
        }

        fn bool_at(row: &[serde_json::Value], i: usize) -> bool {
            row[i].as_i64().unwrap_or(0) != 0
        }

        let tags_raw = str_at(row, 21);
        let tags = if tags_raw.is_empty() {
            vec![]
        } else {
            tags_raw.split(',').map(|s| {
                urlencoding::decode(s).map(|c| c.into_owned()).unwrap_or_else(|_| s.to_string())
            }).collect()
        };

        // ruTorrent stores d.custom2 comments as VRS24mrker plus the url-encoded text
        let comment_raw = str_at(row, 22);
        let comment = match comment_raw.strip_prefix("VRS24mrker") {
            Some(encoded) => urlencoding::decode(encoded)
                .map(|c| c.into_owned())
                .unwrap_or_else(|_| encoded.to_string()),
            None => comment_raw,
        };

        // d.timestamp.started resets on every resume; addtime is the real add time
        let date_started = i64_at(row, 19);
        let date_addtime = row[20].as_i64().unwrap_or_else(|| {
            row[20]
                .as_str()
                .and_then(|s| s.parse().ok())
                .unwrap_or(0)
        });
        let date_added = if date_addtime > 0 { date_addtime } else { date_started };
        let hash = str_at(row, 0);
        let name = str_at(row, 1);
        let fetching_metadata = name.eq_ignore_ascii_case(&format!("{hash}.meta"));

        Ok(Torrent {
            hash,
            name,
            fetching_metadata,
            state: i64_at(row, 2),
            is_active: bool_at(row, 3),
            complete: bool_at(row, 4),
            is_open: bool_at(row, 5),
            is_private: bool_at(row, 6),
            hashing: i64_at(row, 7),
            priority: i64_at(row, 8),
            up_rate: i64_at(row, 9),
            up_total: i64_at(row, 10),
            down_rate: i64_at(row, 11),
            down_total: i64_at(row, 12),
            ratio_millis: i64_at(row, 13),
            bytes_done: i64_at(row, 14),
            size_bytes: i64_at(row, 15),
            directory: str_at(row, 16),
            date_created: i64_at(row, 17),
            date_finished: i64_at(row, 18),
            date_added,
            tags,
            comment,
            message: str_at(row, 23),
            seeds_connected: i64_at(row, 24),
            peers_connected: i64_at(row, 25),
            connection_seed: str_at(row, 26),
            throttle_name: str_at(row, 27),
            ratio_group: parse_ratio_group(&str_at(row, 28)),
            size_chunks: i64_at(row, 29),
            completed_chunks: i64_at(row, 30),
            wanted_chunks: (row.len() > MULTICALL_FIELDS.len()).then(|| i64_at(row, 31)),
        })
    }
}

/// One file in a torrent, as listed by f.multicall.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TorrentFile {
    pub index: usize,
    pub path: String,
    pub size_bytes: i64,
    pub size_chunks: i64,
    pub completed_chunks: i64,
    pub priority: i64,
}

impl TorrentFile {
    /// Parse a file from one f.multicall row, tagged with its index in the torrent.
    pub fn from_multicall_row(index: usize, row: &[serde_json::Value]) -> Result<Self, RpcError> {
        if row.len() < 5 {
            return Err(RpcError::Protocol(format!(
                "file row too short: expected >= 5 fields, got {}",
                row.len()
            )));
        }
        Ok(TorrentFile {
            index,
            path: row[0].as_str().unwrap_or("").to_string(),
            size_bytes: row[1].as_i64().unwrap_or(0),
            size_chunks: row[2].as_i64().unwrap_or(0),
            completed_chunks: row[3].as_i64().unwrap_or(0),
            priority: row[4].as_i64().unwrap_or(0),
        })
    }

}

/// One peer connected to a torrent, optional fields 0 or false where the server lacks them.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TorrentPeer {
    pub address: String,
    pub client_version: String,
    pub completed_percent: i64,
    pub up_rate: i64,
    pub down_rate: i64,
    pub up_total: i64,
    pub down_total: i64,
    pub peer_rate: i64,
    pub is_encrypted: bool,
    pub is_incoming: bool,
    pub is_obfuscated: bool,
    pub is_snubbed: bool,
    pub id_html: String,
}

/// One tracker of a torrent, optional fields 0 where the server lacks them.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TorrentTracker {
    pub url: String,
    pub tracker_type: i64,
    pub is_enabled: bool,
    pub scrape_complete: i64,
    pub scrape_incomplete: i64,
    pub scrape_downloaded: i64,
    pub group: i64,
    pub scrape_time_last: i64,
    pub normal_interval: i64,
}

/// All detail data for a single torrent, fetched in one batch.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TorrentDetails {
    pub files: Vec<TorrentFile>,
    pub peers: Vec<TorrentPeer>,
    pub trackers: Vec<TorrentTracker>,
    pub chunk_size: i64,
    pub wanted_chunks: i64,
    pub load_date: i64,
    pub is_private: bool,
    pub state_changed: i64,
    /// Wasted bytes: incoming data rTorrent discarded. Not a chunk count.
    pub skip_total: i64,
    pub peers_connected: i64,
    pub peers_not_connected: i64,
}

/// Per-torrent tunable properties such as upload slots and peer limits.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TorrentProperties {
    pub max_uploads: i64,
    pub peers_min: i64,
    pub peers_max: i64,
    pub tracker_numwant: i64,
    pub connection_seed: String,
}

/// Global upload and download rates and totals.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferStats {
    pub up_rate: i64,
    pub up_total: i64,
    pub down_rate: i64,
    pub down_total: i64,
}

/// rTorrent system information: its client and library versions and hostname.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemInfo {
    pub client_version: String,
    pub library_version: String,
    pub hostname: String,
}

/// Server capabilities derived from system.listMethods.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ServerCapabilities {
    pub has_dht_mode: bool,
    pub has_scheduler_max_active: bool,
    pub has_send_buffer_size: bool,
    pub has_receive_buffer_size: bool,
    pub has_tracker_scrape: bool,
    pub has_peer_banned: bool,
    pub has_peer_disconnect: bool,
    pub has_peer_obfuscated: bool,
    pub has_peer_snubbed: bool,
    pub has_disconnect_seeders: bool,
    pub has_file_prioritize_first: bool,
    pub has_file_prioritize_last: bool,
    pub has_tracker_insert: bool,
    pub has_d_chunk_size: bool,
    pub has_d_wanted_chunks: bool,
    pub has_d_load_date: bool,
    pub has_d_state_changed: bool,
    pub has_d_skip_total: bool,
    pub has_d_peers_connected: bool,
    pub has_d_peers_not_connected: bool,
    pub has_d_uploads_max: bool,
    pub has_d_tracker_numwant: bool,
    pub has_dht_override_port: bool,
    pub has_tracker_numwant: bool,
    pub has_ratio_groups: bool,
    pub has_session_path: bool,
    pub has_execute_capture: bool,
    pub has_p_up_total: bool,
    pub has_p_down_total: bool,
    pub has_p_peer_rate: bool,
    pub has_t_scrape_time_last: bool,
    pub has_t_normal_interval: bool,
    /// Raw method list for debugging.
    pub methods: Vec<String>,
}

impl ServerCapabilities {
    /// Build capabilities from a system.listMethods result.
    pub fn from_methods(methods: &[String]) -> Self {
        let method_set: std::collections::HashSet<&str> = methods.iter().map(String::as_str).collect();
        let has = |name: &str| method_set.contains(name);
        ServerCapabilities {
            has_dht_mode: has("dht"),
            has_scheduler_max_active: has("scheduler.max_active"),
            has_send_buffer_size: has("network.send_buffer.size"),
            has_receive_buffer_size: has("network.receive_buffer.size"),
            has_tracker_scrape: has("t.scrape_complete"),
            has_peer_banned: has("p.banned.set"),
            has_peer_disconnect: has("p.disconnect"),
            has_peer_obfuscated: has("p.is_obfuscated"),
            has_peer_snubbed: has("p.is_snubbed"),
            has_disconnect_seeders: has("d.disconnect.seeders"),
            has_file_prioritize_first: has("f.prioritize_first.enable"),
            has_file_prioritize_last: has("f.prioritize_last.enable"),
            has_tracker_insert: has("d.tracker.insert"),
            has_d_chunk_size: has("d.chunk_size"),
            has_d_wanted_chunks: has("d.wanted_chunks"),
            has_d_load_date: has("d.load_date"),
            has_d_state_changed: has("d.state_changed"),
            has_d_skip_total: has("d.skip.total"),
            has_d_peers_connected: has("d.peers_connected"),
            has_d_peers_not_connected: has("d.peers_not_connected"),
            has_d_uploads_max: has("d.uploads_max"),
            has_d_tracker_numwant: has("d.tracker_numwant"),
            has_dht_override_port: has("dht.override_port"),
            has_tracker_numwant: has("trackers.numwant"),
            has_ratio_groups: has("group.rat_0.ratio.min"),
            has_session_path: has("session.path"),
            has_execute_capture: has("execute.capture"),
            has_p_up_total: has("p.up_total"),
            has_p_down_total: has("p.down_total"),
            has_p_peer_rate: has("p.peer_rate"),
            has_t_scrape_time_last: has("t.scrape_time_last"),
            has_t_normal_interval: has("t.normal_interval"),
            methods: methods.to_vec(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// One value per field, positionally matching MULTICALL_FIELDS.
    fn row() -> Vec<serde_json::Value> {
        vec![
            json!("ABC123"), json!("Ubuntu.iso"), json!(1), json!(1), json!(0), json!(1),
            json!(0), json!(0), json!(2), json!(100), json!(1000), json!(200), json!(2000),
            json!(1500), json!(512), json!(1024), json!("/downloads"), json!(1700000000),
            json!(1700000100), json!(1700000200), json!("1699999999"), json!("linux%2Ciso"),
            json!("VRS24mrkerhello%20world"), json!(""), json!(3), json!(7), json!("seed"),
            json!("slow"), json!("main,rat_2"), json!(4), json!(2),
        ]
    }

    /// MULTICALL_FIELDS and the shared test row agree on length, one value per requested field.
    #[test]
    fn field_list_and_parser_agree_on_length() {
        assert_eq!(MULTICALL_FIELDS.len(), row().len());
    }

    /// Flag only the `<HASH>.meta` name rTorrent gives a magnet without its metadata yet.
    #[test]
    fn flags_a_magnet_fetching_metadata() {
        assert!(!Torrent::from_multicall_row(&row()).unwrap().fetching_metadata);
        let mut r = row();
        r[1] = json!("ABC123.meta");
        assert!(Torrent::from_multicall_row(&r).unwrap().fetching_metadata);
        r[1] = json!("Other.meta");
        assert!(!Torrent::from_multicall_row(&r).unwrap().fetching_metadata);
    }

    /// Parse a full row by position, d.peers_complete into seeds and d.peers_connected into peers.
    #[test]
    fn parses_every_field_in_order() {
        let mut r = row();
        r[7] = json!(3);
        r[23] = json!("Tracker: timed out");
        let t = Torrent::from_multicall_row(&r).unwrap();
        assert_eq!(t.hash, "ABC123");
        assert_eq!(t.name, "Ubuntu.iso");
        assert_eq!((t.state, t.hashing), (1, 3));
        assert!(t.is_active && t.is_open && !t.complete && !t.is_private);
        assert_eq!(t.priority, 2);
        assert_eq!((t.date_created, t.date_finished), (1700000000, 1700000100));
        assert_eq!(t.message, "Tracker: timed out");
        assert_eq!(t.connection_seed, "seed");
        assert_eq!((t.up_rate, t.up_total, t.down_rate, t.down_total), (100, 1000, 200, 2000));
        assert_eq!(t.ratio_millis, 1500);
        assert_eq!((t.bytes_done, t.size_bytes), (512, 1024));
        assert_eq!(t.directory, "/downloads");
        assert_eq!(t.seeds_connected, 3);
        assert_eq!(t.peers_connected, 7);
        assert_eq!(t.throttle_name, "slow");
        assert_eq!((t.size_chunks, t.completed_chunks), (4, 2));
    }

    /// Decode an escaped-comma tag, encoded ruTorrent comment, string addtime and ratio group.
    #[test]
    fn decodes_tags_comment_and_add_time() {
        let t = Torrent::from_multicall_row(&row()).unwrap();
        assert_eq!(t.tags, vec!["linux,iso"]);
        assert_eq!(t.comment, "hello world");
        assert_eq!(t.date_added, 1699999999);
        assert_eq!(t.ratio_group, 2);
    }

    /// Keep a comment without ruTorrent's prefix as written, percent escapes included.
    #[test]
    fn keeps_a_comment_without_the_prefix() {
        let mut r = row();
        r[22] = json!("50%25 off");
        assert_eq!(Torrent::from_multicall_row(&r).unwrap().comment, "50%25 off");
    }

    /// Split linux,iso into two tags and an empty string into none.
    #[test]
    fn splits_tags_on_unescaped_commas() {
        let mut r = row();
        r[21] = json!("linux,iso");
        assert_eq!(Torrent::from_multicall_row(&r).unwrap().tags, vec!["linux", "iso"]);
        r[21] = json!("");
        assert!(Torrent::from_multicall_row(&r).unwrap().tags.is_empty());
    }

    /// Fall back to d.timestamp.started for the add date when addtime is "0" or the unset "".
    #[test]
    fn falls_back_to_started_when_addtime_is_missing() {
        let mut r = row();
        for unset in ["0", ""] {
            r[20] = json!(unset);
            assert_eq!(Torrent::from_multicall_row(&r).unwrap().date_added, 1700000200);
        }
    }

    /// Wanted chunks are None for a row of just the listed fields and Some(2) for an appended 2.
    #[test]
    fn wanted_chunks_is_none_unless_the_server_appended_it() {
        assert!(Torrent::from_multicall_row(&row()).unwrap().wanted_chunks.is_none());
        let mut r = row();
        r.push(json!(2));
        assert_eq!(Torrent::from_multicall_row(&r).unwrap().wanted_chunks, Some(2));
    }

    /// Reject a 5-value row with an error rather than an out-of-bounds panic.
    #[test]
    fn rejects_a_short_row() {
        assert!(Torrent::from_multicall_row(&row()[..5]).is_err());
    }

    /// Match rat_0 as group 0, and give -1 for no rat view, rat_8 past the last group, or rat_x.
    #[test]
    fn ratio_group_only_matches_a_rat_view() {
        assert_eq!(parse_ratio_group("main,rat_0"), 0);
        assert_eq!(parse_ratio_group("main"), -1);
        assert_eq!(parse_ratio_group("rat_8"), -1);
        assert_eq!(parse_ratio_group("ratio,rat_x"), -1);
    }
}
