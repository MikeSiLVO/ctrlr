//! Config files under ~/.ctrlr, OS keyring passwords, and connecting from a profile.
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

/// App settings and connection profiles from ~/.ctrlr/config.toml.
#[derive(Debug, Deserialize, Serialize)]
pub struct Config {
    #[serde(default = "default_profile_name")]
    pub active: String,

    #[serde(default)]
    pub start_minimized: bool,

    #[serde(default)]
    pub autostart: bool,

    #[serde(default)]
    pub profiles: BTreeMap<String, ConnectionConfig>,
}

/// Profile name made active when the config names none.
fn default_profile_name() -> String {
    "default".to_string()
}

impl Default for Config {
    fn default() -> Self {
        Config {
            active: default_profile_name(),
            start_minimized: false,
            autostart: false,
            profiles: BTreeMap::new(),
        }
    }
}

/// How one profile reaches rTorrent; passwords are never written to the file.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "type")]
pub enum ConnectionConfig {
    #[serde(rename = "unix")]
    Unix { socket: String },
    #[serde(rename = "tcp")]
    Tcp {
        host: String,
        #[serde(default = "default_port")]
        port: u16,
    },
    #[serde(rename = "ssh")]
    Ssh {
        ssh_host: String,
        #[serde(default = "default_ssh_port")]
        ssh_port: u16,
        #[serde(default)]
        ssh_user: Option<String>,
        remote_socket: String,
    },
    #[serde(rename = "http")]
    Http {
        url: String,
        username: Option<String>,
        #[serde(skip_serializing, default)]
        password: Option<String>,
    },
    #[serde(rename = "xmlrpc")]
    Xmlrpc {
        url: String,
        username: Option<String>,
        #[serde(skip_serializing, default)]
        password: Option<String>,
    },
}

/// SCGI port for a TCP profile that sets none.
fn default_port() -> u16 {
    5000
}

/// SSH port for an SSH profile that sets none.
fn default_ssh_port() -> u16 {
    22
}

impl Config {
    /// Load config.toml, or defaults when it does not exist.
    pub fn load() -> Result<Config, String> {
        load_toml("config.toml")
    }

    /// Save config.toml, readable by the owner only on Unix.
    pub fn save(&self) -> Result<(), String> {
        save_toml("config.toml", self)
    }

    /// Connection settings of the active profile, None when no profile has that name.
    pub fn active_connection(&self) -> Option<&ConnectionConfig> {
        self.profiles.get(&self.active)
    }
}

/// Directory holding ctrlr's config and data, under HOME or USERPROFILE.
pub fn config_dir() -> Option<PathBuf> {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok()
        .map(|h| PathBuf::from(h).join(".ctrlr"))
}

/// Load a TOML file from the config directory, or the type's default when it does not exist.
pub fn load_toml<T: DeserializeOwned + Default>(name: &str) -> Result<T, String> {
    let path = config_dir().ok_or("could not determine home directory")?.join(name);
    let content = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(T::default()),
        Err(e) => return Err(format!("failed to read {}: {e}", path.display())),
    };
    toml::from_str(&content).map_err(|e| format!("invalid {name}: {e}"))
}

/// Save a value as TOML in the config directory, readable by the owner only on Unix.
pub fn save_toml<T: Serialize>(name: &str, value: &T) -> Result<(), String> {
    let dir = config_dir().ok_or("could not determine home directory")?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("failed to create {}: {e}", dir.display()))?;
    let path = dir.join(name);
    let content =
        toml::to_string_pretty(value).map_err(|e| format!("failed to serialize {name}: {e}"))?;
    std::fs::write(&path, &content)
        .map_err(|e| format!("failed to write {}: {e}", path.display()))?;

    // rss.toml feed urls and cookies carry private tracker passkeys
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("failed to set permissions on {}: {e}", path.display()))?;
    }

    Ok(())
}

/// Service name that groups ctrlr's entries in the OS credential store.
const KEYRING_SERVICE: &str = "ctrlr";

/// Save a password in the OS credential store.
pub fn save_credential(key: &str, password: &str) -> Result<(), String> {
    keyring::Entry::new(KEYRING_SERVICE, key)
        .and_then(|entry| entry.set_password(password))
        .map_err(|e| format!("failed to save credential: {e}"))
}

/// Load a password from the OS credential store, None when missing or unreadable.
pub fn load_credential(key: &str) -> Option<String> {
    read_credential(key).ok().flatten()
}

/// Read a password from the OS credential store, None only when no entry exists.
pub fn read_credential(key: &str) -> Result<Option<String>, String> {
    match keyring::Entry::new(KEYRING_SERVICE, key).and_then(|entry| entry.get_password()) {
        Ok(pw) => Ok(Some(pw)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("failed to read credential: {e}")),
    }
}

/// Delete a password from the OS credential store.
pub fn delete_credential(key: &str) -> Result<(), String> {
    keyring::Entry::new(KEYRING_SERVICE, key)
        .and_then(|entry| entry.delete_credential())
        .map_err(|e| format!("failed to delete credential: {e}"))
}

impl ConnectionConfig {
    /// Keyring key for the profile's password, None for the types that take no password.
    pub fn credential_key(&self, profile: &str) -> Option<String> {
        match self {
            ConnectionConfig::Ssh { ssh_host, ssh_user, .. } => {
                let user = ssh_user.as_deref().unwrap_or("");
                Some(format!("ssh:{profile}:{user}@{ssh_host}"))
            }
            ConnectionConfig::Http { url, .. } | ConnectionConfig::Xmlrpc { url, .. } => {
                Some(format!("http:{profile}:{url}"))
            }
            ConnectionConfig::Tcp { .. } | ConnectionConfig::Unix { .. } => None,
        }
    }
}

/// Connect to the config file's active profile, or to localhost:5000 when it has none.
pub async fn connect_from_config(
) -> Result<(crate::RtorrentClient, Option<Arc<crate::SshTunnel>>), Box<dyn std::error::Error>> {
    let config = Config::load()?;
    match config.active_connection() {
        Some(conn) => connect_with_config(&config.active, conn).await,
        None => Ok((crate::RtorrentClient::tcp("localhost", 5000), None)),
    }
}

/// Connect using an explicit config, its password from the OS keyring; only SSH connects up front.
pub async fn connect_with_config(
    profile: &str,
    conn: &ConnectionConfig,
) -> Result<(crate::RtorrentClient, Option<Arc<crate::SshTunnel>>), Box<dyn std::error::Error>> {
    let password = conn.credential_key(profile).and_then(|key| load_credential(&key));
    match conn {
        ConnectionConfig::Unix { socket } => {
            Ok((crate::RtorrentClient::unix(socket), None))
        }
        ConnectionConfig::Tcp { host, port } => {
            Ok((crate::RtorrentClient::tcp(host, *port), None))
        }
        ConnectionConfig::Ssh {
            ssh_host,
            ssh_port,
            ssh_user,
            remote_socket,
        } => {
            let tunnel = crate::SshTunnel::new(ssh_host, remote_socket)
                .with_port(*ssh_port)
                .with_user(ssh_user.clone())
                .with_password(password);
            tunnel.ensure().await?;
            let tunnel = Arc::new(tunnel);
            Ok((crate::RtorrentClient::ssh(tunnel.clone()), Some(tunnel)))
        }
        ConnectionConfig::Http {
            url,
            username,
            ..
        } => Ok((
            crate::RtorrentClient::http(url, username.clone(), password),
            None,
        )),
        ConnectionConfig::Xmlrpc {
            url,
            username,
            ..
        } => Ok((
            crate::RtorrentClient::xmlrpc(url, username.clone(), password),
            None,
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Pin the exact keyring keys, since saved passwords are looked up by them.
    #[test]
    fn credential_keys_stay_byte_identical() {
        let ssh = |ssh_user: Option<&str>| ConnectionConfig::Ssh {
            ssh_host: "seedbox.example".into(),
            ssh_port: 22,
            ssh_user: ssh_user.map(String::from),
            remote_socket: "/tmp/rpc.socket".into(),
        };
        assert_eq!(
            ssh(Some("user")).credential_key("home").as_deref(),
            Some("ssh:home:user@seedbox.example")
        );
        assert_eq!(
            ssh(None).credential_key("home").as_deref(),
            Some("ssh:home:@seedbox.example")
        );

        let url = "https://box.example/RPC2";
        let http = ConnectionConfig::Http { url: url.into(), username: None, password: None };
        let xmlrpc = ConnectionConfig::Xmlrpc { url: url.into(), username: None, password: None };
        let expected = Some("http:home:https://box.example/RPC2");
        assert_eq!(http.credential_key("home").as_deref(), expected);
        assert_eq!(xmlrpc.credential_key("home").as_deref(), expected);

        let tcp = ConnectionConfig::Tcp { host: "localhost".into(), port: 5000 };
        assert_eq!(tcp.credential_key("home"), None);
        assert_eq!(ConnectionConfig::Unix { socket: "/s".into() }.credential_key("home"), None);
    }
}
