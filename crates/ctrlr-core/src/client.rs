//! rTorrent client over SCGI, SSH or HTTP, speaking JSON-RPC or XML-RPC.
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::json;

use crate::rpc::{self, JsonRpcRequest, RpcError};
use crate::ssh::SshTunnel;
use crate::{http, scgi, xmlrpc};
use crate::torrent::{ServerCapabilities, SystemInfo, Torrent, TorrentDetails, TorrentFile, TorrentPeer, TorrentProperties, TorrentTracker, TransferStats, MULTICALL_FIELDS};

/// Escape backslashes and quotes for a double-quoted trailing load command argument.
fn quote_arg(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

/// Torrent file bytes as a base64 data: URI, which load commands accept in place of a path.
fn torrent_data_uri(data: &[u8]) -> String {
    use base64::Engine;
    let encoded = base64::engine::general_purpose::STANDARD.encode(data);
    format!("data:application/x-bittorrent;base64,{encoded}")
}

/// Connection target for rTorrent: a transport, its address and the RPC protocol it speaks.
#[derive(Clone)]
pub enum ConnectionTarget {
    /// Unix domain socket path.
    Unix(PathBuf),
    /// TCP host and port.
    Tcp { host: String, port: u16 },
    /// Remote Unix socket reached through an SSH channel per request.
    Ssh(Arc<SshTunnel>),
    /// HTTP(S) endpoint (nginx scgi_pass proxy, JSON-RPC).
    Http {
        url: String,
        username: Option<String>,
        password: Option<String>,
    },
    /// XML-RPC over HTTP(S), the standard rTorrent XMLRPC endpoint.
    Xmlrpc {
        url: String,
        username: Option<String>,
        password: Option<String>,
    },
}

/// rTorrent RPC client bound to one connection target.
pub struct RtorrentClient {
    target: ConnectionTarget,
    request_id: AtomicU64,
    /// Reusable HTTP client for connection pooling / TLS session reuse.
    http_client: reqwest::Client,
}

impl RtorrentClient {
    /// Create a client for a connection target, with HTTP connect and request timeouts set.
    pub fn new(target: ConnectionTarget) -> Self {
        Self {
            target,
            request_id: AtomicU64::new(1),
            // a stalled endpoint would otherwise hang the poll loop forever
            http_client: reqwest::Client::builder()
                .connect_timeout(std::time::Duration::from_secs(15))
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .unwrap_or_default(),
        }
    }

    /// Client for a Unix domain socket, connecting per request.
    pub fn unix(path: impl Into<PathBuf>) -> Self {
        Self::new(ConnectionTarget::Unix(path.into()))
    }

    /// Client for an SCGI port over TCP, connecting per request.
    pub fn tcp(host: impl Into<String>, port: u16) -> Self {
        Self::new(ConnectionTarget::Tcp {
            host: host.into(),
            port,
        })
    }

    /// Client through an SSH tunnel, opening one channel per request.
    pub fn ssh(tunnel: Arc<SshTunnel>) -> Self {
        Self::new(ConnectionTarget::Ssh(tunnel))
    }

    /// Client for a JSON-RPC HTTP(S) proxy such as nginx scgi_pass.
    pub fn http(
        url: impl Into<String>,
        username: Option<String>,
        password: Option<String>,
    ) -> Self {
        Self::new(ConnectionTarget::Http {
            url: url.into(),
            username,
            password,
        })
    }

    /// Client for an XML-RPC endpoint over HTTP(S).
    pub fn xmlrpc(
        url: impl Into<String>,
        username: Option<String>,
        password: Option<String>,
    ) -> Self {
        Self::new(ConnectionTarget::Xmlrpc {
            url: url.into(),
            username,
            password,
        })
    }

    /// Next JSON-RPC request id, unique within this client.
    fn next_id(&self) -> u64 {
        self.request_id.fetch_add(1, Ordering::Relaxed)
    }

    /// Send one RPC call in the target's protocol and return its result.
    pub async fn call(
        &self,
        method: impl Into<String>,
        params: Vec<serde_json::Value>,
    ) -> Result<serde_json::Value, RpcError> {
        let method = method.into();
        if matches!(&self.target, ConnectionTarget::Xmlrpc { .. }) {
            let body = xmlrpc::serialize_call(&method, &params)?;
            let response_bytes = self.send_raw(&body).await?;
            xmlrpc::parse_response(&response_bytes)
        } else {
            let request = JsonRpcRequest {
                jsonrpc: "2.0",
                method,
                params,
                id: self.next_id(),
            };
            let body = rpc::serialize_request(&request)?;
            let response_bytes = self.send_raw(&body).await?;
            let response = rpc::parse_response(&response_bytes)?;
            response
                .result
                .ok_or_else(|| RpcError::Protocol("response missing result".into()))
        }
    }

    /// Send several calls in one round trip, results in input order; any fault fails the batch.
    pub async fn call_batch(
        &self,
        calls: Vec<(String, Vec<serde_json::Value>)>,
    ) -> Result<Vec<serde_json::Value>, RpcError> {
        if matches!(&self.target, ConnectionTarget::Xmlrpc { .. }) {
            let expected = calls.len();
            let body = xmlrpc::serialize_multicall(&calls)?;
            let response_bytes = self.send_raw(&body).await?;
            let results = xmlrpc::parse_multicall_response(&response_bytes)?;
            // callers index these positionally
            if results.len() != expected {
                return Err(RpcError::Protocol(format!(
                    "multicall returned {} results for {expected} calls", results.len()
                )));
            }
            Ok(results)
        } else {
            let requests: Vec<JsonRpcRequest> = calls
                .into_iter()
                .map(|(method, params)| JsonRpcRequest {
                    jsonrpc: "2.0",
                    method,
                    params,
                    id: self.next_id(),
                })
                .collect();

            let body = rpc::serialize_batch(&requests)?;
            let response_bytes = self.send_raw(&body).await?;
            let responses = rpc::parse_batch_response(&response_bytes)?;

            // batch replies may come back in any order
            let id_to_pos: std::collections::HashMap<u64, usize> = requests
                .iter()
                .enumerate()
                .map(|(i, r)| (r.id, i))
                .collect();
            let expected = requests.len();
            let mut results: Vec<Option<serde_json::Value>> = (0..expected).map(|_| None).collect();
            for resp in responses {
                if let Some(err) = &resp.error {
                    return Err(RpcError::Rpc {
                        code: err.code,
                        message: err.message.clone(),
                    });
                }
                let id = resp.id
                    .ok_or_else(|| RpcError::Protocol("batch response missing id".into()))?;
                let pos = id_to_pos.get(&id)
                    .ok_or_else(|| RpcError::Protocol(format!("unexpected batch response id {id}")))?;
                let result = resp.result
                    .ok_or_else(|| RpcError::Protocol("batch response missing result".into()))?;
                results[*pos] = Some(result);
            }
            results.into_iter().enumerate().map(|(i, v)| {
                v.ok_or_else(|| RpcError::Protocol(format!("missing batch response for request {i}")))
            }).collect()
        }
    }

    /// List all methods supported by the rTorrent server.
    pub async fn list_methods(&self) -> Result<Vec<String>, RpcError> {
        let result = self.call("system.listMethods", vec![]).await?;
        let arr = result.as_array()
            .ok_or_else(|| RpcError::Protocol("system.listMethods result is not an array".into()))?;
        Ok(arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
    }

    /// List all torrents in the main view, with wanted chunks where the server has them.
    pub async fn list_torrents(&self, caps: Option<&ServerCapabilities>) -> Result<Vec<Torrent>, RpcError> {
        let mut params: Vec<serde_json::Value> = vec![
            serde_json::Value::String(String::new()),
            serde_json::Value::String("main".into()),
        ];
        for field in MULTICALL_FIELDS {
            params.push(serde_json::Value::String((*field).into()));
        }
        if caps.is_some_and(|c| c.has_d_wanted_chunks) {
            params.push(serde_json::Value::String("d.wanted_chunks=".into()));
        }

        let result = self.call("d.multicall2", params).await?;
        let rows = result
            .as_array()
            .ok_or_else(|| RpcError::Protocol("d.multicall2 result is not an array".into()))?;

        let mut torrents = Vec::with_capacity(rows.len());
        for row in rows {
            let fields = row
                .as_array()
                .ok_or_else(|| RpcError::Protocol("torrent row is not an array".into()))?;
            torrents.push(Torrent::from_multicall_row(fields)?);
        }
        Ok(torrents)
    }

    /// Get global upload and download rates and totals.
    pub async fn get_transfer_stats(&self) -> Result<TransferStats, RpcError> {
        let vals = self.call_batch(vec![
            ("throttle.global_up.rate".into(), vec![json!("")]),
            ("throttle.global_up.total".into(), vec![json!("")]),
            ("throttle.global_down.rate".into(), vec![json!("")]),
            ("throttle.global_down.total".into(), vec![json!("")]),
        ]).await?;

        Ok(TransferStats {
            up_rate: vals[0].as_i64().unwrap_or(0),
            up_total: vals[1].as_i64().unwrap_or(0),
            down_rate: vals[2].as_i64().unwrap_or(0),
            down_total: vals[3].as_i64().unwrap_or(0),
        })
    }

    /// Add a torrent with directory, label and throttle applied before it starts.
    pub async fn add_torrent_with_options(
        &self,
        source: &str,
        directory: Option<&str>,
        label: Option<&str>,
        throttle: Option<&str>,
    ) -> Result<(), RpcError> {
        let mut params: Vec<serde_json::Value> = vec![json!(""), json!(source)];
        if let Some(dir) = directory.filter(|d| !d.is_empty()) {
            params.push(json!(format!("d.directory.set=\"{}\"", quote_arg(dir))));
        }
        if let Some(tag) = label.filter(|l| !l.is_empty()) {
            let encoded = urlencoding::encode(tag).into_owned();
            params.push(json!(format!("d.custom1.set=\"{}\"", quote_arg(&encoded))));
        }
        if let Some(t) = throttle.filter(|t| !t.is_empty()) {
            params.push(json!(format!("d.throttle_name.set=\"{}\"", quote_arg(t))));
        }
        self.call("load.start", params).await?;
        Ok(())
    }

    /// Add .torrent bytes with directory, label and throttle applied before it starts.
    pub async fn add_torrent_file_with_options(
        &self,
        data: &[u8],
        directory: Option<&str>,
        label: Option<&str>,
        throttle: Option<&str>,
    ) -> Result<(), RpcError> {
        self.add_torrent_with_options(&torrent_data_uri(data), directory, label, throttle).await
    }

    /// Add .torrent bytes with file priorities set before the first hash check, then start it.
    pub async fn add_torrent_configured(
        &self,
        data: &[u8],
        info_hash: &str,
        directory: Option<&str>,
        file_priorities: &[(usize, i64)],
    ) -> Result<(), RpcError> {
        let mut params: Vec<serde_json::Value> = vec![json!(""), json!(torrent_data_uri(data))];
        if let Some(dir) = directory {
            params.push(json!(format!("d.directory.set=\"{}\"", quote_arg(dir))));
        }

        self.call("load.raw", params).await?;

        // load.raw returns before the download is registered
        let hash = info_hash.to_uppercase();
        let mut registered = false;
        for _ in 0..20 {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            match self.call("d.name", vec![json!(hash)]).await {
                Ok(val) if val.as_str().is_some_and(|s| !s.is_empty()) => {
                    registered = true;
                    break;
                }
                Ok(_) | Err(RpcError::Rpc { .. }) => {}
                Err(e) => return Err(e),
            }
        }
        if !registered {
            return Err(RpcError::Protocol("torrent not registered after load".into()));
        }

        let priority_calls: Vec<(String, Vec<serde_json::Value>)> = file_priorities
            .iter()
            .filter(|(_, p)| *p != 1)
            .map(|&(index, priority)| (
                "f.priority.set".into(),
                vec![json!(format!("{hash}:f{index}")), json!(priority)],
            ))
            .collect();

        if !priority_calls.is_empty() {
            self.call_batch(priority_calls).await?;
            self.call("d.update_priorities", vec![json!(hash)]).await?;
        }

        // d.start hash checks on its own
        self.call("d.start", vec![json!(hash)]).await?;

        // a rejected trailing load command flags hash-failed and later starts silently no-op
        let state = self.call_batch(vec![
            ("d.is_active".into(), vec![json!(hash)]),
            ("d.hashing".into(), vec![json!(hash)]),
            ("d.message".into(), vec![json!(hash)]),
        ]).await?;
        let active = state[0].as_i64().unwrap_or(1) != 0;
        let hashing = state[1].as_i64().unwrap_or(0) != 0;
        let message = state[2].as_str().unwrap_or("");
        if !active && !hashing && !message.is_empty() {
            return Err(RpcError::Protocol(format!("torrent added but not started: {message}")));
        }

        Ok(())
    }

    /// Remove a torrent from rTorrent, optionally running rm -rf on its data first.
    async fn remove_torrent(&self, hash: &str, delete_data: bool) -> Result<(), RpcError> {
        let base_path = if delete_data {
            let val = self.call("d.base_path", vec![json!(hash)]).await?;
            Some(val.as_str().unwrap_or("").to_string())
        } else {
            None
        };

        self.call("d.stop", vec![json!(hash)]).await?;
        self.call("d.close", vec![json!(hash)]).await?;

        if let Some(path) = &base_path
            && !path.is_empty() {
                self.call("execute2", vec![json!(""), json!("rm"), json!("-rf"), json!("--"), json!(path)]).await?;
            }

        self.call("d.erase", vec![json!(hash)]).await?;
        Ok(())
    }

    /// Get a torrent's files, peers, trackers and scalar detail fields in one round trip.
    pub async fn get_torrent_details(&self, hash: &str, caps: &ServerCapabilities) -> Result<TorrentDetails, RpcError> {
        let mut p_fields = vec![
            json!(hash), json!(""),
            json!("p.address="), json!("p.client_version="),
            json!("p.completed_percent="), json!("p.up_rate="),
            json!("p.down_rate="),
        ];
        // row positions skip the leading hash and "" args
        let mut p_idx = 5;
        let p_up_total_idx = if caps.has_p_up_total { p_fields.push(json!("p.up_total=")); let i = p_idx; p_idx += 1; Some(i) } else { None };
        let p_down_total_idx = if caps.has_p_down_total { p_fields.push(json!("p.down_total=")); let i = p_idx; p_idx += 1; Some(i) } else { None };
        let p_peer_rate_idx = if caps.has_p_peer_rate { p_fields.push(json!("p.peer_rate=")); let i = p_idx; p_idx += 1; Some(i) } else { None };
        p_fields.push(json!("p.is_encrypted="));
        let p_encrypted_idx = p_idx; p_idx += 1;
        p_fields.push(json!("p.is_incoming="));
        let p_incoming_idx = p_idx; p_idx += 1;
        let p_obfuscated_idx = if caps.has_peer_obfuscated { p_fields.push(json!("p.is_obfuscated=")); let i = p_idx; p_idx += 1; Some(i) } else { None };
        let p_snubbed_idx = if caps.has_peer_snubbed { p_fields.push(json!("p.is_snubbed=")); let i = p_idx; p_idx += 1; Some(i) } else { None };
        p_fields.push(json!("p.id_html="));
        let p_id_html_idx = p_idx;

        // one unsupported field faults the whole multicall
        let mut t_fields = vec![
            json!(hash), json!(""),
            json!("t.url="), json!("t.type="), json!("t.is_enabled="),
        ];
        let mut t_idx = 3;
        let t_scrape_idx = if caps.has_tracker_scrape {
            t_fields.push(json!("t.scrape_complete="));
            t_fields.push(json!("t.scrape_incomplete="));
            t_fields.push(json!("t.scrape_downloaded="));
            let i = t_idx;
            t_idx += 3;
            Some(i)
        } else { None };
        t_fields.push(json!("t.group="));
        let t_group_idx = t_idx;
        t_idx += 1;
        let t_scrape_time_idx = if caps.has_t_scrape_time_last { t_fields.push(json!("t.scrape_time_last=")); let i = t_idx; t_idx += 1; Some(i) } else { None };
        let t_interval_idx = if caps.has_t_normal_interval { t_fields.push(json!("t.normal_interval=")); let i = t_idx; t_idx += 1; Some(i) } else { None };
        let _ = t_idx;

        let mut calls: Vec<(String, Vec<serde_json::Value>)> = vec![
            ("f.multicall".into(), vec![
                json!(hash), json!(""),
                json!("f.path="), json!("f.size_bytes="),
                json!("f.size_chunks="), json!("f.completed_chunks="),
                json!("f.priority="),
            ]),
            ("p.multicall".into(), p_fields),
            ("t.multicall".into(), t_fields),
            ("d.is_private".into(), vec![json!(hash)]),
        ];
        let mut idx_chunk_size = None;
        let mut idx_wanted_chunks = None;
        let mut idx_load_date = None;
        let mut idx_state_changed = None;
        let mut idx_skip_total = None;
        let mut idx_peers_connected = None;
        let mut idx_peers_not_connected = None;

        if caps.has_d_chunk_size {
            idx_chunk_size = Some(calls.len());
            calls.push(("d.chunk_size".into(), vec![json!(hash)]));
        }
        if caps.has_d_wanted_chunks {
            idx_wanted_chunks = Some(calls.len());
            calls.push(("d.wanted_chunks".into(), vec![json!(hash)]));
        }
        if caps.has_d_load_date {
            idx_load_date = Some(calls.len());
            calls.push(("d.load_date".into(), vec![json!(hash)]));
        }
        if caps.has_d_state_changed {
            idx_state_changed = Some(calls.len());
            calls.push(("d.state_changed".into(), vec![json!(hash)]));
        }
        if caps.has_d_skip_total {
            idx_skip_total = Some(calls.len());
            calls.push(("d.skip.total".into(), vec![json!(hash)]));
        }
        if caps.has_d_peers_connected {
            idx_peers_connected = Some(calls.len());
            calls.push(("d.peers_connected".into(), vec![json!(hash)]));
        }
        if caps.has_d_peers_not_connected {
            idx_peers_not_connected = Some(calls.len());
            calls.push(("d.peers_not_connected".into(), vec![json!(hash)]));
        }

        let vals = self.call_batch(calls).await?;

        let file_rows = vals[0].as_array()
            .ok_or_else(|| RpcError::Protocol("f.multicall result is not an array".into()))?;
        let mut files = Vec::with_capacity(file_rows.len());
        for (i, row) in file_rows.iter().enumerate() {
            let fields = row.as_array()
                .ok_or_else(|| RpcError::Protocol("file row is not an array".into()))?;
            files.push(TorrentFile::from_multicall_row(i, fields)?);
        }

        let peer_rows = vals[1].as_array()
            .ok_or_else(|| RpcError::Protocol("p.multicall result is not an array".into()))?;
        let mut peers = Vec::with_capacity(peer_rows.len());
        let opt_i64 = |row: &[serde_json::Value], idx: Option<usize>| idx.and_then(|i| row.get(i)).and_then(|v| v.as_i64()).unwrap_or(0);
        let opt_bool = |row: &[serde_json::Value], idx: Option<usize>| idx.and_then(|i| row.get(i)).and_then(|v| v.as_i64()).map(|n| n != 0).unwrap_or(false);
        for row in peer_rows {
            let f = row.as_array()
                .ok_or_else(|| RpcError::Protocol("peer row is not an array".into()))?;
            if f.len() < 5 { continue; }
            peers.push(TorrentPeer {
                address: f[0].as_str().unwrap_or("").to_string(),
                client_version: f[1].as_str().unwrap_or("").to_string(),
                completed_percent: f[2].as_i64().unwrap_or(0),
                up_rate: f[3].as_i64().unwrap_or(0),
                down_rate: f[4].as_i64().unwrap_or(0),
                up_total: opt_i64(f, p_up_total_idx),
                down_total: opt_i64(f, p_down_total_idx),
                peer_rate: opt_i64(f, p_peer_rate_idx),
                is_encrypted: f.get(p_encrypted_idx).and_then(|v| v.as_i64()).unwrap_or(0) != 0,
                is_incoming: f.get(p_incoming_idx).and_then(|v| v.as_i64()).unwrap_or(0) != 0,
                is_obfuscated: opt_bool(f, p_obfuscated_idx),
                is_snubbed: opt_bool(f, p_snubbed_idx),
                id_html: f.get(p_id_html_idx).and_then(|v| v.as_str()).unwrap_or("").to_string(),
            });
        }

        let tracker_rows = vals[2].as_array()
            .ok_or_else(|| RpcError::Protocol("t.multicall result is not an array".into()))?;
        let mut trackers = Vec::with_capacity(tracker_rows.len());
        for row in tracker_rows {
            let f = row.as_array()
                .ok_or_else(|| RpcError::Protocol("tracker row is not an array".into()))?;
            // rTorrent emits empty rows for invalid tracker slots
            if f.len() <= t_group_idx { continue; }
            trackers.push(TorrentTracker {
                url: f[0].as_str().unwrap_or("").to_string(),
                tracker_type: f[1].as_i64().unwrap_or(0),
                is_enabled: f[2].as_i64().unwrap_or(0) != 0,
                scrape_complete: opt_i64(f, t_scrape_idx),
                scrape_incomplete: opt_i64(f, t_scrape_idx.map(|i| i + 1)),
                scrape_downloaded: opt_i64(f, t_scrape_idx.map(|i| i + 2)),
                group: f[t_group_idx].as_i64().unwrap_or(0),
                scrape_time_last: opt_i64(f, t_scrape_time_idx),
                normal_interval: opt_i64(f, t_interval_idx),
            });
        }

        let i64_at = |idx: Option<usize>| idx.map(|i| vals[i].as_i64().unwrap_or(0)).unwrap_or(0);

        Ok(TorrentDetails {
            files,
            peers,
            trackers,
            is_private: vals[3].as_i64().unwrap_or(0) != 0,
            chunk_size: i64_at(idx_chunk_size),
            wanted_chunks: i64_at(idx_wanted_chunks),
            load_date: i64_at(idx_load_date),
            state_changed: i64_at(idx_state_changed),
            skip_total: i64_at(idx_skip_total),
            peers_connected: i64_at(idx_peers_connected),
            peers_not_connected: i64_at(idx_peers_not_connected),
        })
    }

    /// Enable or disable one of a torrent's trackers by index.
    pub async fn toggle_tracker(&self, hash: &str, index: usize, enabled: bool) -> Result<(), RpcError> {
        let target = format!("{hash}:t{index}");
        let method = if enabled { "t.enable" } else { "t.disable" };
        self.call(method, vec![json!(target)]).await?;
        Ok(())
    }

    /// Add a tracker URL to a torrent in a given group.
    pub async fn add_tracker(&self, hash: &str, group: i64, url: &str) -> Result<(), RpcError> {
        self.call("d.tracker.insert", vec![json!(hash), json!(group), json!(url)]).await?;
        Ok(())
    }

    /// Force a tracker announce for a torrent, even inside the announce interval.
    pub async fn force_announce(&self, hash: &str) -> Result<(), RpcError> {
        self.call("d.tracker_announce.force", vec![json!(hash)]).await?;
        Ok(())
    }

    /// Ban a peer of a torrent by peer id.
    pub async fn ban_peer(&self, hash: &str, peer_id: &str) -> Result<(), RpcError> {
        let target = format!("{hash}:p{peer_id}");
        self.call("p.banned.set", vec![json!(target), json!(1)]).await?;
        Ok(())
    }

    /// Disconnect a peer of a torrent by peer id.
    pub async fn disconnect_peer(&self, hash: &str, peer_id: &str) -> Result<(), RpcError> {
        let target = format!("{hash}:p{peer_id}");
        self.call("p.disconnect", vec![json!(target)]).await?;
        Ok(())
    }

    /// Disconnect all seeders from a torrent.
    pub async fn disconnect_seeders(&self, hash: &str) -> Result<(), RpcError> {
        self.call("d.disconnect.seeders", vec![json!(hash)]).await?;
        Ok(())
    }

    /// Prioritize a file's first piece, or stop prioritizing it, and apply it.
    pub async fn prioritize_first_piece(&self, hash: &str, index: usize, enable: bool) -> Result<(), RpcError> {
        let method = if enable { "f.prioritize_first.enable" } else { "f.prioritize_first.disable" };
        self.set_file_flag(hash, index, method).await
    }

    /// Prioritize a file's last piece, or stop prioritizing it, and apply it.
    pub async fn prioritize_last_piece(&self, hash: &str, index: usize, enable: bool) -> Result<(), RpcError> {
        let method = if enable { "f.prioritize_last.enable" } else { "f.prioritize_last.disable" };
        self.set_file_flag(hash, index, method).await
    }

    /// Set a file flag, then d.update_priorities; libtorrent reads the flag only on a priority update.
    async fn set_file_flag(&self, hash: &str, index: usize, method: &str) -> Result<(), RpcError> {
        self.call_batch(vec![
            (method.into(), vec![json!(format!("{hash}:f{index}"))]),
            ("d.update_priorities".into(), vec![json!(hash)]),
        ]).await?;
        Ok(())
    }

    /// Set a torrent's tags, URL-encoded and comma-joined in d.custom1.
    pub async fn set_tags(&self, hash: &str, tags: &[String]) -> Result<(), RpcError> {
        let encoded: Vec<String> = tags.iter().map(|t| urlencoding::encode(t).into_owned()).collect();
        let value = encoded.join(",");
        self.call("d.custom1.set", vec![json!(hash), json!(value)]).await?;
        Ok(())
    }

    /// Set a torrent's added date, stored in the d.custom addtime key.
    pub async fn set_date_added(&self, hash: &str, epoch: i64) -> Result<(), RpcError> {
        self.call("d.custom.set", vec![json!(hash), json!("addtime"), json!(epoch.to_string())]).await?;
        Ok(())
    }

    /// Move a torrent's data to a new directory, then restore its stopped, paused or active state.
    async fn move_torrent(&self, hash: &str, directory: &str) -> Result<(), RpcError> {
        let was_open = self.call("d.is_open", vec![json!(hash)]).await?.as_i64() == Some(1);
        let was_active = self.call("d.is_active", vec![json!(hash)]).await?.as_i64() == Some(1);

        self.call("d.stop", vec![json!(hash)]).await?;
        self.call("d.close", vec![json!(hash)]).await?;

        let base_path = self.call("d.base_path", vec![json!(hash)]).await?;
        let base_path = base_path.as_str().unwrap_or("");
        let old_dir = self.call("d.directory", vec![json!(hash)]).await?;
        let old_dir = old_dir.as_str().unwrap_or("").to_string();

        self.call("d.directory.set", vec![json!(hash), json!(directory)]).await?;

        // the prior state comes back even when mv fails
        let mv_err = if !base_path.is_empty() {
            self.call("execute2", vec![
                json!(""), json!("mv"), json!("--"), json!(base_path), json!(directory),
            ]).await.err()
        } else {
            None
        };

        // data never left the old dir
        if mv_err.is_some() && !old_dir.is_empty() {
            self.call("d.directory.set", vec![json!(hash), json!(old_dir)]).await.ok();
        }

        if was_open {
            self.call("d.open", vec![json!(hash)]).await?;
        }
        if was_active {
            self.call("d.start", vec![json!(hash)]).await?;
        }

        if let Some(e) = mv_err {
            return Err(e);
        }
        Ok(())
    }

    /// Set a file's priority by 0-based index, 0 off, 1 normal, 2 high, and apply it.
    pub async fn set_file_priority(&self, hash: &str, file_index: usize, priority: i64) -> Result<(), RpcError> {
        self.call_batch(vec![
            ("f.priority.set".into(), vec![json!(format!("{hash}:f{file_index}")), json!(priority)]),
            ("d.update_priorities".into(), vec![json!(hash)]),
        ]).await?;
        Ok(())
    }

    /// Get global (up, down) speed limits in bytes/sec, 0 for unlimited.
    pub async fn get_speed_limits(&self) -> Result<(i64, i64), RpcError> {
        let vals = self.call_batch(vec![
            ("throttle.global_up.max_rate".into(), vec![json!("")]),
            ("throttle.global_down.max_rate".into(), vec![json!("")]),
        ]).await?;
        Ok((vals[0].as_i64().unwrap_or(0), vals[1].as_i64().unwrap_or(0)))
    }

    /// Set global upload speed limit in KB/s (0 = unlimited).
    pub async fn set_upload_limit(&self, kb_per_sec: i64) -> Result<(), RpcError> {
        self.call("throttle.global_up.max_rate.set_kb", vec![json!(""), json!(kb_per_sec)]).await?;
        Ok(())
    }

    /// Set global download speed limit in KB/s (0 = unlimited).
    pub async fn set_download_limit(&self, kb_per_sec: i64) -> Result<(), RpcError> {
        self.call("throttle.global_down.max_rate.set_kb", vec![json!(""), json!(kb_per_sec)]).await?;
        Ok(())
    }

    /// Get rTorrent's client version, library version and hostname.
    pub async fn get_system_info(&self) -> Result<SystemInfo, RpcError> {
        let vals = self.call_batch(vec![
            ("system.client_version".into(), vec![]),
            ("system.library_version".into(), vec![]),
            ("system.hostname".into(), vec![]),
        ]).await?;

        Ok(SystemInfo {
            client_version: vals[0].as_str().unwrap_or("").to_string(),
            library_version: vals[1].as_str().unwrap_or("").to_string(),
            hostname: vals[2].as_str().unwrap_or("").to_string(),
        })
    }

    /// Identity of this rTorrent instance, its hostname and session directory, shared by profiles.
    pub async fn server_id(&self) -> Result<String, RpcError> {
        let host = self.call("system.hostname", vec![]).await?;
        let session = self.call("session.path", vec![]).await.ok();
        Ok(format!(
            "{}:{}",
            host.as_str().unwrap_or(""),
            session.as_ref().and_then(|s| s.as_str()).unwrap_or(""),
        ))
    }

    /// Get rTorrent's default download directory.
    pub async fn get_default_directory(&self) -> Result<String, RpcError> {
        let val = self.call("directory.default", vec![]).await?;
        Ok(val.as_str().unwrap_or("").to_string())
    }

    /// Get free bytes on the default download directory's partition, 0 when unknown.
    pub async fn get_free_diskspace(&self) -> Result<i64, RpcError> {
        let dir = self.get_default_directory().await?;
        if dir.is_empty() {
            return Ok(0);
        }
        let result = self.call(
            "execute.capture",
            vec![json!(""), json!("df"), json!("-P"), json!("-B1"), json!(dir)],
        ).await?;
        let output = result.as_str().unwrap_or("");
        // df -P: header line, then Filesystem 1-blocks Used Available Capacity Mounted-on
        let bytes = output
            .lines()
            .nth(1)
            .and_then(|line| line.split_whitespace().nth(3))
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(0);
        Ok(bytes)
    }

    /// Get the DHT mode from dht.statistics, since `dht` only redirects to the setter.
    pub async fn get_dht(&self) -> Result<String, RpcError> {
        let val = self.call("dht.statistics", vec![]).await?;
        let mode = val.get("dht")
            .and_then(|v| v.as_str())
            .unwrap_or("disable");
        Ok(mode.to_string())
    }

    /// Get disk usage in bytes via `quota --used --units b` (seedbox-specific).
    pub async fn get_disk_used(&self) -> Result<i64, RpcError> {
        let result = self.call(
            "execute.capture",
            vec![json!(""), json!("quota"), json!("--used"), json!("--units"), json!("b")],
        ).await?;
        let output = result.as_str().unwrap_or("").trim();
        output.parse::<i64>().map_err(|_| RpcError::Protocol(format!("Failed to parse quota output: {}", output)))
    }

    /// List the subdirectory names of a path on the rTorrent host.
    pub async fn list_directory(&self, path: &str) -> Result<Vec<String>, RpcError> {
        let result = self.call(
            "execute.capture",
            vec![json!(""), json!("ls"), json!("-1ap"), json!(path)],
        ).await?;

        let output = result.as_str().unwrap_or("");
        let dirs: Vec<String> = output
            .lines()
            .filter(|line| line.ends_with('/'))
            .filter(|line| *line != "./" && *line != "../")
            .map(|line| line.trim_end_matches('/').to_string())
            .collect();

        Ok(dirs)
    }

    /// Call every method on every hash in one batch, in method order per hash.
    async fn fan_out(
        &self, hashes: &[String], methods: &[&str], extra: &[serde_json::Value],
    ) -> Result<(), RpcError> {
        let calls: Vec<(String, Vec<serde_json::Value>)> = hashes
            .iter()
            .flat_map(|h| {
                methods.iter().map(move |m| {
                    let mut params = vec![json!(h)];
                    params.extend_from_slice(extra);
                    (m.to_string(), params)
                })
            })
            .collect();
        if !calls.is_empty() {
            self.call_batch(calls).await?;
        }
        Ok(())
    }

    /// Stop and close each torrent.
    pub async fn pause_torrents(&self, hashes: &[String]) -> Result<(), RpcError> {
        self.fan_out(hashes, &["d.stop", "d.close"], &[]).await
    }

    /// Open and start each torrent.
    pub async fn resume_torrents(&self, hashes: &[String]) -> Result<(), RpcError> {
        self.fan_out(hashes, &["d.open", "d.start"], &[]).await
    }

    /// Remove torrents in turn until one fails, returning those removed and the failure if any.
    pub async fn remove_torrents(
        &self, hashes: &[String], delete_data: bool,
    ) -> (Vec<String>, Option<RpcError>) {
        let mut removed = Vec::with_capacity(hashes.len());
        for h in hashes {
            if let Err(e) = self.remove_torrent(h, delete_data).await {
                return (removed, Some(e));
            }
            removed.push(h.clone());
        }
        (removed, None)
    }

    /// Queue a hash check on each torrent.
    pub async fn recheck_torrents(&self, hashes: &[String]) -> Result<(), RpcError> {
        self.fan_out(hashes, &["d.check_hash"], &[]).await
    }

    /// Reannounce each torrent to its trackers, without the force flag.
    pub async fn reannounce_torrents(&self, hashes: &[String]) -> Result<(), RpcError> {
        self.fan_out(hashes, &["d.tracker_announce"], &[]).await
    }

    /// Set each torrent's priority, 0 off, 1 low, 2 normal, 3 high.
    pub async fn set_torrents_priority(&self, hashes: &[String], priority: i64) -> Result<(), RpcError> {
        self.fan_out(hashes, &["d.priority.set"], &[json!(priority)]).await
    }

    /// Set each torrent's named throttle group, empty name to clear.
    pub async fn set_torrents_throttle(&self, hashes: &[String], throttle_name: &str) -> Result<(), RpcError> {
        self.fan_out(hashes, &["d.throttle_name.set"], &[json!(throttle_name)]).await
    }

    /// Set each torrent's ratio group 0 to 7 by view membership, -1 for none.
    pub async fn set_torrents_ratio_group(
        &self,
        hashes_with_old: &[(String, i64)],
        new_group: i64,
    ) -> Result<(), RpcError> {
        let mut calls: Vec<(String, Vec<serde_json::Value>)> = Vec::new();
        for (hash, old) in hashes_with_old {
            if *old >= 0 && *old != new_group {
                let view = format!("rat_{old}");
                calls.push(("view.set_not_visible".into(), vec![json!(hash), json!(view)]));
                calls.push(("d.views.remove".into(), vec![json!(hash), json!(view)]));
            }
            if new_group >= 0 && new_group != *old {
                let view = format!("rat_{new_group}");
                calls.push(("d.views.push_back_unique".into(), vec![json!(hash), json!(view)]));
                calls.push(("view.set_visible".into(), vec![json!(hash), json!(view)]));
            }
        }
        if !calls.is_empty() {
            self.call_batch(calls).await?;
        }
        Ok(())
    }

    /// Move each torrent's data to a new directory in turn, stopping at the first failure.
    pub async fn move_torrents(&self, hashes: &[String], directory: &str) -> Result<(), RpcError> {
        for h in hashes {
            self.move_torrent(h, directory).await?;
        }
        Ok(())
    }

    /// Get a torrent's .torrent file bytes from rTorrent's session directory.
    pub async fn get_torrent_file(&self, hash: &str) -> Result<Vec<u8>, RpcError> {
        let session_path = self.call("session.path", vec![]).await?;
        let session_dir = session_path.as_str().unwrap_or("");
        if session_dir.is_empty() {
            return Err(RpcError::Protocol("session.path is empty".into()));
        }
        let file_path = format!("{}{}.torrent", session_dir, hash.to_uppercase());
        let result = self.call(
            "execute.capture",
            vec![json!(""), json!("base64"), json!(&file_path)],
        ).await?;
        let raw = result.as_str().unwrap_or("");
        // GNU base64 wraps at 76 chars
        let b64: String = raw.chars().filter(|c| !c.is_ascii_whitespace()).collect();
        if b64.is_empty() {
            return Err(RpcError::Protocol("empty base64 output".into()));
        }
        use base64::Engine;
        base64::engine::general_purpose::STANDARD
            .decode(&b64)
            .map_err(|e| RpcError::Protocol(format!("base64 decode failed: {e}")))
    }

    /// Get a torrent's tunable properties in one batch.
    pub async fn get_torrent_properties(
        &self, hash: &str, caps: &ServerCapabilities,
    ) -> Result<TorrentProperties, RpcError> {
        let mut calls = vec![
            ("d.uploads_max".into(), vec![json!(hash)]),
            ("d.peers_min".into(), vec![json!(hash)]),
            ("d.peers_max".into(), vec![json!(hash)]),
            ("d.connection_seed".into(), vec![json!(hash)]),
        ];
        if caps.has_d_tracker_numwant {
            calls.push(("d.tracker_numwant".into(), vec![json!(hash)]));
        }
        let vals = self.call_batch(calls).await?;
        Ok(TorrentProperties {
            max_uploads: vals[0].as_i64().unwrap_or(0),
            peers_min: vals[1].as_i64().unwrap_or(0),
            peers_max: vals[2].as_i64().unwrap_or(0),
            connection_seed: vals[3].as_str().unwrap_or("seed").to_string(),
            tracker_numwant: vals.get(4).and_then(|v| v.as_i64()).unwrap_or(-1),
        })
    }

    /// Set a torrent's tunable properties in one batch.
    pub async fn set_torrent_properties(
        &self, hash: &str, props: &TorrentProperties, caps: &ServerCapabilities,
    ) -> Result<(), RpcError> {
        let mut calls = vec![
            ("d.uploads_max.set".into(), vec![json!(hash), json!(props.max_uploads)]),
            ("d.peers_min.set".into(), vec![json!(hash), json!(props.peers_min)]),
            ("d.peers_max.set".into(), vec![json!(hash), json!(props.peers_max)]),
            ("d.connection_seed.set".into(), vec![json!(hash), json!(props.connection_seed)]),
        ];
        if caps.has_d_tracker_numwant {
            calls.push(("d.tracker_numwant.set".into(), vec![json!(hash), json!(props.tracker_numwant)]));
        }
        self.call_batch(calls).await?;
        Ok(())
    }

    /// Send an encoded request over the target's transport and return the response body.
    async fn send_raw(&self, body: &[u8]) -> Result<Vec<u8>, RpcError> {
        match &self.target {
            ConnectionTarget::Unix(path) => {
                scgi::request_unix(path, "application/json", body).await
            }
            ConnectionTarget::Tcp { host, port } => {
                scgi::request_tcp(host, *port, "application/json", body).await
            }
            ConnectionTarget::Ssh(tunnel) => {
                let stream = tunnel.open_stream().await?;
                scgi::send_scgi(stream, "application/json", body).await
            }
            ConnectionTarget::Http {
                url,
                username,
                password,
            } => {
                http::request(
                    &self.http_client, url, body, "application/json",
                    username.as_deref(), password.as_deref(),
                ).await
            }
            ConnectionTarget::Xmlrpc {
                url,
                username,
                password,
            } => {
                http::request(
                    &self.http_client, url, body, "text/xml",
                    username.as_deref(), password.as_deref(),
                ).await
            }
        }
    }
}
