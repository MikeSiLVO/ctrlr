//! Shared core of Ctrl+R: rTorrent RPC client, models, config and local storage.
pub mod client;
pub mod config;
pub mod db;
pub mod http;
pub mod meta;
pub mod rpc;
pub mod scgi;
pub mod ssh;
pub mod torrent;
pub mod rss;
pub mod xmlrpc;

pub use client::{ConnectionTarget, RtorrentClient};
pub use config::Config;
pub use meta::TorrentMeta;
pub use rpc::RpcError;
pub use ssh::SshTunnel;
pub use torrent::{ServerCapabilities, SystemInfo, Torrent, TorrentDetails, TorrentFile, TorrentPeer, TorrentProperties, TorrentTracker, TransferStats};
