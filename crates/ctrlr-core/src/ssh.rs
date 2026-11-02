//! SSH transport to rTorrent's remote socket, with host key checks and reconnect backoff.
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};

use russh::client;
use russh::ChannelStream;
use tokio::sync::Mutex;

use crate::rpc::RpcError;

/// Wait after the first failed connect, doubled after each further failure.
const RETRY_FIRST: Duration = Duration::from_secs(2);
/// Longest wait between reconnect attempts.
const RETRY_MAX: Duration = Duration::from_secs(60);

/// When the next reconnect may run, and the error to report until then.
#[derive(Default)]
struct Backoff {
    delay: Option<Duration>,
    next_attempt: Option<Instant>,
    last_error: String,
}

/// Session handler that checks the host key against ~/.ssh/known_hosts.
struct SshHandler {
    host: String,
    port: u16,
}

impl client::Handler for SshHandler {
    type Error = russh::Error;

    /// Check the host key by trust on first use, saving an unknown key and rejecting a changed one.
    async fn check_server_key(
        &mut self,
        server_key: &russh::keys::PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        use russh::keys;

        // no CA is trusted, and certificate host keys are never negotiated
        let keys::PublicKeyOrCertificate::PublicKey { key: server_public_key, .. } = server_key
        else {
            return Ok(false);
        };
        match keys::check_known_hosts(&self.host, self.port, server_public_key) {
            Ok(true) => Ok(true),
            Ok(false) => {
                keys::known_hosts::learn_known_hosts(&self.host, self.port, server_public_key)
                    .map_err(|_| russh::Error::NoHomeDir)?;
                Ok(true)
            }
            Err(keys::Error::KeyChanged { line }) => {
                Err(russh::Error::KeyChanged { line })
            }
            Err(_) => Err(russh::Error::CouldNotReadKey),
        }
    }
}

/// In-process SSH tunnel opening one direct-streamlocal channel per request, no local listener.
pub struct SshTunnel {
    ssh_host: String,
    ssh_port: u16,
    ssh_user: String,
    remote_socket: String,
    password: Option<String>,
    /// Whether the SSH session is alive; cleared on close or when the session fails a channel open.
    healthy: Arc<AtomicBool>,
    /// Bumped on every connect; a late failure from an older session leaves the health flag alone.
    generation: Arc<AtomicU64>,
    handle: Mutex<Option<Arc<client::Handle<SshHandler>>>>,
    backoff: std::sync::Mutex<Backoff>,
}

impl SshTunnel {
    /// Tunnel to a remote socket on port 22, not connected until ensure().
    pub fn new(ssh_host: &str, remote_socket: &str) -> Self {
        SshTunnel {
            ssh_host: ssh_host.into(),
            ssh_port: 22,
            ssh_user: String::new(),
            remote_socket: remote_socket.into(),
            password: None,
            healthy: Arc::new(AtomicBool::new(false)),
            generation: Arc::new(AtomicU64::new(0)),
            handle: Mutex::new(None),
            backoff: std::sync::Mutex::new(Backoff::default()),
        }
    }

    /// With an SSH port other than 22.
    pub fn with_port(mut self, port: u16) -> Self {
        self.ssh_port = port;
        self
    }

    /// With a login user, leaving the empty default for None.
    pub fn with_user(mut self, user: Option<String>) -> Self {
        if let Some(u) = user {
            self.ssh_user = u;
        }
        self
    }

    /// With a login password; None authenticates with an empty one.
    pub fn with_password(mut self, password: Option<String>) -> Self {
        self.password = password;
        self
    }

    /// Whether the SSH session is alive, as of the last connect, close or channel open.
    pub fn is_healthy(&self) -> bool {
        self.healthy.load(Ordering::Relaxed)
    }

    /// The last connect error while a reconnect is still waiting out its backoff.
    pub fn backoff_error(&self) -> Option<RpcError> {
        let b = self.backoff.lock().unwrap_or_else(|e| e.into_inner());
        match b.next_attempt {
            Some(at) if Instant::now() < at => Some(RpcError::Connection(b.last_error.clone())),
            _ => None,
        }
    }

    /// Ensure a live session, connecting unless healthy and failing fast during backoff.
    pub async fn ensure(&self) -> Result<(), RpcError> {
        if self.is_healthy() {
            return Ok(());
        }
        if let Some(e) = self.backoff_error() {
            return Err(e);
        }
        let result = self.connect().await;
        let mut b = self.backoff.lock().unwrap_or_else(|e| e.into_inner());
        match &result {
            Ok(()) => *b = Backoff::default(),
            Err(e) => {
                let delay = b.delay.map_or(RETRY_FIRST, |d| (d * 2).min(RETRY_MAX));
                b.delay = Some(delay);
                b.next_attempt = Some(Instant::now() + delay);
                b.last_error = match e {
                    RpcError::Connection(msg) | RpcError::Unreachable(msg) => msg.clone(),
                    other => other.to_string(),
                };
            }
        }
        result
    }

    /// Replace any previous session with a freshly authenticated one.
    async fn connect(&self) -> Result<(), RpcError> {
        self.close().await.ok();

        let config = Arc::new(client::Config {
            inactivity_timeout: Some(Duration::from_secs(120)),
            keepalive_interval: Some(Duration::from_secs(15)),
            keepalive_max: 5,
            ..<client::Config as Default>::default()
        });

        let handler = SshHandler {
            host: self.ssh_host.clone(),
            port: self.ssh_port,
        };
        // uncapped, a silently dropped route waits out the OS TCP timeout, minutes
        let mut ssh = tokio::time::timeout(
            Duration::from_secs(20),
            client::connect(config, (&*self.ssh_host, self.ssh_port), handler),
        )
            .await
            .map_err(|_| RpcError::Unreachable(format!("SSH connect to {} timed out after 20s", self.ssh_host)))?
            .map_err(|e| {
                let msg = format!("SSH connect to {} failed: {e}", self.ssh_host);
                // a refused or changed host key also lands here, and the host did answer
                if matches!(e, russh::Error::IO(_)) { RpcError::Unreachable(msg) } else { RpcError::Connection(msg) }
            })?;

        let password = self.password.as_deref().unwrap_or("");
        let auth = tokio::time::timeout(
            Duration::from_secs(30),
            ssh.authenticate_password(&self.ssh_user, password),
        )
            .await
            .map_err(|_| RpcError::Connection("SSH authentication timed out after 30s".into()))?
            .map_err(|e| RpcError::Connection(format!("SSH auth failed: {e}")))?;

        if !matches!(auth, client::AuthResult::Success) {
            return Err(RpcError::Connection(
                "SSH authentication failed, check username/password".into(),
            ));
        }

        *self.handle.lock().await = Some(Arc::new(ssh));
        self.generation.fetch_add(1, Ordering::SeqCst);
        // a dead remote socket only shows up at the first channel open
        self.healthy.store(true, Ordering::Relaxed);
        Ok(())
    }

    /// Open a channel to the rTorrent socket for one request, marking a dead session unhealthy.
    pub async fn open_stream(&self) -> Result<ChannelStream<client::Msg>, RpcError> {
        let (handle, session) = {
            let guard = self.handle.lock().await;
            let handle = guard.clone()
                .ok_or_else(|| RpcError::Connection("SSH tunnel is not connected".into()))?;
            (handle, self.generation.load(Ordering::SeqCst))
        };
        // a session killed without a RST never answers an open, it does not fail it
        let opened = tokio::time::timeout(
            Duration::from_secs(20),
            handle.channel_open_direct_streamlocal(self.remote_socket.as_str()),
        ).await;
        match opened {
            Ok(Ok(channel)) => Ok(channel.into_stream()),
            // server refused the socket; the session itself is alive
            Ok(Err(russh::Error::ChannelOpenFailure(reason))) => Err(RpcError::Connection(
                format!("rTorrent socket unavailable ({reason:?})"),
            )),
            Ok(Err(e)) => Err(self.mark_failed(session, format!("SSH channel open failed: {e}"))),
            Err(_) => Err(self.mark_failed(session, "SSH channel open timed out after 20s".into())),
        }
    }

    /// Clear the health flag if the failure belongs to the current session.
    fn mark_failed(&self, session: u64, msg: String) -> RpcError {
        if self.generation.load(Ordering::SeqCst) == session {
            self.healthy.store(false, Ordering::Relaxed);
        }
        RpcError::Connection(msg)
    }

    /// Shut down the tunnel, sending an SSH disconnect to the remote.
    pub async fn close(&self) -> Result<(), RpcError> {
        self.healthy.store(false, Ordering::Relaxed);
        if let Some(handle) = self.handle.lock().await.take() {
            handle
                .disconnect(russh::Disconnect::ByApplication, "", "en")
                .await
                .ok();
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A refused connect backs off, and the next ensure fails fast with its error.
    #[tokio::test]
    async fn test_failed_connect_backs_off() {
        // nothing listens on port 1
        let tunnel = SshTunnel::new("127.0.0.1", "/tmp/rtorrent.sock").with_port(1);
        assert!(tunnel.backoff_error().is_none());
        let first = tunnel.ensure().await.unwrap_err().to_string();

        let waiting = tunnel.backoff_error().expect("a failed connect starts a backoff");
        assert_eq!(waiting.to_string(), first);
        assert_eq!(tunnel.ensure().await.unwrap_err().to_string(), first);
        assert_eq!(tunnel.backoff.lock().unwrap().delay, Some(RETRY_FIRST));
    }
}
