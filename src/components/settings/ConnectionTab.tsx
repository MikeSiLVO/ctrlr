import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import * as api from "../../api";
import type { ConnectionSettings, LaunchStatus } from "../../api";
import { Select } from "../Select";
import { useDialog } from "../AppDialog";
import { Input } from "../ui";

/** Connection tab: profile add, rename and delete, the connection form, and any launch retry. */
export function ConnectionTab({
  onConnected,
  onDisconnected,
  isConnected,
  initialProfile,
  initialAddMode,
}: {
  onConnected: () => void;
  onDisconnected: () => void;
  isConnected: boolean;
  initialProfile?: string;
  initialAddMode?: boolean;
}) {
  const { t } = useTranslation();
  const dialog = useDialog();

  // read once on mount
  const initialProfileRef = useRef(initialProfile);
  const initialAddModeRef = useRef(initialAddMode);

  const [profiles, setProfiles] = useState<string[]>([]);
  // a prompt can outlive the render it opened in; name checks after it read this
  const profilesRef = useRef(profiles);
  profilesRef.current = profiles;
  const [activeProfile, setActiveProfile] = useState<string | null>(null);
  // null until listProfiles resolves; never a guessed profile name
  const [selectedProfile, setSelectedProfile] = useState<string | null>(null);

  // empty connType means choose a type, for a new profile or first install
  const [connType, setConnType] = useState("");
  const [sshHost, setSshHost] = useState("");
  const [sshPort, setSshPort] = useState("22");
  const [sshUser, setSshUser] = useState("");
  const [sshPassword, setSshPassword] = useState("");
  const [remoteSocket, setRemoteSocket] = useState("");
  const [host, setHost] = useState("localhost");
  const [port, setPort] = useState("5000");
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [socket, setSocket] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [launch, setLaunch] = useState<LaunchStatus | null>(null);
  const [now, setNow] = useState(() => Date.now() / 1000);

  function resetForm() {
    setConnType("");
    setSshHost("");
    setSshPort("22");
    setSshUser("");
    setSshPassword("");
    setRemoteSocket("");
    setHost("localhost");
    setPort("5000");
    setUrl("");
    setUsername("");
    setPassword("");
    setSocket("");
    setError(null);
  }

  function applySettings(settings: ConnectionSettings | null) {
    if (!settings) { resetForm(); return; }
    setConnType(settings.conn_type);
    setSshHost(settings.ssh_host ?? "");
    setSshPort(settings.ssh_port ? String(settings.ssh_port) : "22");
    setSshUser(settings.ssh_user ?? "");
    setSshPassword(settings.ssh_password ?? "");
    setRemoteSocket(settings.remote_socket ?? "");
    setHost(settings.host ?? "localhost");
    setPort(settings.port ? String(settings.port) : "5000");
    setUrl(settings.url ?? "");
    setUsername(settings.username ?? "");
    setPassword(settings.password ?? "");
    setSocket(settings.socket ?? "");
  }

  // settings load only in the selectedProfile effect below
  useEffect(() => {
    const initProfile = initialProfileRef.current;
    api.listProfiles().then((result) => {
      setProfiles(result.profiles.map((p) => p.name));
      setActiveProfile(result.active);
      setSelectedProfile(initProfile ?? result.active ?? result.startup ?? "default");
    }).catch((e) => setError(String(e)));
    api.getLaunchStatus().then((status) => {
      if (!status) return;
      setLaunch(status);
      setError(status.error);
    });
    const unlisten = listen<LaunchStatus>("launch-retry", (event) => {
      setLaunch(event.payload);
      setError(event.payload.error);
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  useEffect(() => {
    if (launch?.retry_at == null) return;
    const id = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(id);
  }, [launch?.retry_at]);

  useEffect(() => {
    if (initialAddModeRef.current) handleAddProfile();
  }, []);

  useEffect(() => {
    if (!selectedProfile) return;
    let current = true;
    api.getProfileSettings(selectedProfile).then((settings) => {
      // null when the profile is not on disk yet, newly added
      if (current) applySettings(settings);
    }).catch((e) => { if (current) setError(String(e)); });
    return () => { current = false; };
  }, [selectedProfile]);

  function buildSettings(): ConnectionSettings {
    const settings: ConnectionSettings = { profile: selectedProfile ?? undefined, conn_type: connType };
    if (connType === "ssh") {
      settings.ssh_host = sshHost;
      const parsedSshPort = Number(sshPort) || 22;
      if (parsedSshPort !== 22) settings.ssh_port = parsedSshPort;
      settings.ssh_user = sshUser || undefined;
      settings.ssh_password = sshPassword || undefined;
      settings.remote_socket = remoteSocket;
    } else if (connType === "tcp") {
      settings.host = host;
      settings.port = Number(port) || 5000;
    } else if (connType === "http" || connType === "xmlrpc") {
      settings.url = url;
      if (username) settings.username = username;
      if (password) settings.password = password;
    } else if (connType === "unix") {
      settings.socket = socket;
    }
    return settings;
  }

  const [saved, setSaved] = useState(false);

  async function handleSave() {
    if (!selectedProfile) return;
    setLoading(true);
    setError(null);
    try {
      await api.saveProfile(selectedProfile, buildSettings());
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setLaunch(null);
    try {
      await api.saveAndConnect(buildSettings());
      setActiveProfile(selectedProfile);
      onConnected();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleAddProfile() {
    const name = await dialog.prompt(t("dialog.profileName"));
    if (!name?.trim()) return;
    const trimmed = name.trim();
    if (profilesRef.current.includes(trimmed)) {
      setError(t("dialog.profileExists"));
      return;
    }
    setProfiles((prev) => [...prev, trimmed]);
    setSelectedProfile(trimmed);
    resetForm();
  }

  async function handleRenameProfile() {
    if (!selectedProfile) return;
    const newName = await dialog.prompt(t("dialog.newName"), selectedProfile);
    if (!newName?.trim() || newName.trim() === selectedProfile) return;
    const trimmed = newName.trim();
    if (profilesRef.current.includes(trimmed)) {
      setError(t("dialog.profileNameExists"));
      return;
    }
    try {
      await api.renameProfile(selectedProfile, trimmed);
      setProfiles((prev) => prev.map((p) => p === selectedProfile ? trimmed : p));
      if (activeProfile === selectedProfile) setActiveProfile(trimmed);
      setSelectedProfile(trimmed);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleDeleteProfile() {
    if (!selectedProfile || profiles.length <= 1) return;
    if (!(await dialog.confirm(t("dialog.deleteProfile", { name: selectedProfile })))) return;
    try {
      await api.deleteProfile(selectedProfile);
      const remaining = profilesRef.current.filter((p) => p !== selectedProfile);
      setProfiles(remaining);
      const next = remaining[0] ?? "default";
      setSelectedProfile(next);
      if (activeProfile === selectedProfile) {
        setActiveProfile(null);
        onDisconnected();
      }
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <form onSubmit={handleConnect} className="flex flex-col gap-3">
      {profiles.length > 0 && (
        <div
          className="flex items-center gap-2 pb-3"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <span className="text-xs shrink-0" style={{ color: "var(--text-secondary)" }}>{t("settings.connection.profile")}</span>
          <Select
            value={selectedProfile ?? ""}
            onChange={setSelectedProfile}
            options={profiles.map((p) => ({
              value: p,
              label: p + (p === activeProfile ? ` (${t("settings.connection.active")})` : ""),
            }))}
            className="flex-1 text-xs"
          />
          <button
            type="button"
            onClick={handleAddProfile}
            className="px-2 py-1 rounded text-xs font-medium"
            style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)" }}
            title={t("settings.connection.addProfile")}
          >+</button>
          <button
            type="button"
            onClick={handleRenameProfile}
            className="px-2 py-1 rounded text-xs"
            style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)" }}
            title={t("settings.connection.renameProfile")}
          >{t("common.rename")}</button>
          {profiles.length > 1 && (
            <button
              type="button"
              onClick={handleDeleteProfile}
              className="px-2 py-1 rounded text-xs font-medium"
              style={{ background: "var(--bg-tertiary)", color: "var(--danger)" }}
              title={t("settings.connection.deleteProfile")}
            >&times;</button>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label className="text-xs" style={{ color: "var(--text-secondary)" }}>{t("settings.connection.connType")}</label>
        <Select
          value={connType}
          onChange={setConnType}
          options={[
            ...(!connType ? [{ value: "", label: t("settings.connection.selectType") }] : []),
            { value: "ssh", label: t("settings.connection.ssh") },
            { value: "xmlrpc", label: t("settings.connection.xmlrpc") },
            { value: "tcp", label: t("settings.connection.tcp") },
            { value: "http", label: t("settings.connection.http") },
            { value: "unix", label: t("settings.connection.unix") },
          ]}
          className="text-sm"
        />
      </div>

      {connType === "ssh" && (
        <>
          <div className="flex gap-3">
            <div className="flex-1">
              <Input label={t("settings.connection.host")} value={sshHost} onChange={setSshHost} placeholder="seedbox.example.com" />
            </div>
            <div className="w-20">
              <Input label={t("settings.connection.sshPort")} value={sshPort} onChange={setSshPort} placeholder="22" />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <Input label={t("settings.connection.username")} value={sshUser} onChange={setSshUser} placeholder="user" />
            </div>
            <div className="flex-1">
              <Input label={t("settings.connection.password")} value={sshPassword} onChange={setSshPassword} type="password" />
            </div>
          </div>
          <Input label={t("settings.connection.remoteSocket")} value={remoteSocket} onChange={setRemoteSocket} placeholder="/home/user/.config/rtorrent/socket" />
        </>
      )}

      {connType === "tcp" && (
        <div className="flex gap-3">
          <div className="flex-1">
            <Input label={t("settings.connection.host")} value={host} onChange={setHost} placeholder="localhost" />
          </div>
          <div className="w-28">
            <Input label={t("settings.connection.port")} value={port} onChange={setPort} placeholder="5000" />
          </div>
        </div>
      )}

      {connType === "xmlrpc" && (
        <>
          <Input label={t("settings.connection.url")} value={url} onChange={setUrl} placeholder="https://server.example.com/xmlrpc" />
          <div className="flex gap-3">
            <div className="flex-1">
              <Input label={t("settings.connection.usernameOptional")} value={username} onChange={setUsername} />
            </div>
            <div className="flex-1">
              <Input label={t("settings.connection.passwordOptional")} value={password} onChange={setPassword} type="password" />
            </div>
          </div>
        </>
      )}

      {connType === "http" && (
        <>
          <Input label={t("settings.connection.url")} value={url} onChange={setUrl} placeholder="https://rtorrent.example.com/RPC2" />
          <div className="flex gap-3">
            <div className="flex-1">
              <Input label={t("settings.connection.usernameOptional")} value={username} onChange={setUsername} />
            </div>
            <div className="flex-1">
              <Input label={t("settings.connection.passwordOptional")} value={password} onChange={setPassword} type="password" />
            </div>
          </div>
        </>
      )}

      {connType === "unix" && (
        <Input label={t("settings.connection.socketPath")} value={socket} onChange={setSocket} placeholder="/home/user/.config/rtorrent/socket" />
      )}

      {error && (
        <div className="text-xs" style={{ color: "var(--danger)" }}>{error}</div>
      )}
      {launch?.retry_at != null && (
        <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
          {launch.retry_at > now
            ? t("settings.connection.retrying", { seconds: Math.ceil(launch.retry_at - now), attempt: launch.attempt + 1 })
            : t("settings.connection.retryingNow", { attempt: launch.attempt + 1 })}
        </div>
      )}

      {connType && (
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={loading}
            onClick={handleSave}
            className="px-4 py-1.5 rounded text-xs font-medium disabled:opacity-40"
            style={{ background: "var(--bg-tertiary)", color: saved ? "var(--success, #4ade80)" : "var(--text-primary)" }}
          >
            {saved ? t("common.saved") : t("common.save")}
          </button>
          {isConnected && selectedProfile === activeProfile ? (
            <button
              type="button"
              disabled={loading}
              onClick={async () => {
                setLoading(true);
                try {
                  await api.disconnect();
                  onDisconnected();
                  setActiveProfile(null);
                } catch (err) {
                  setError(String(err));
                } finally {
                  setLoading(false);
                }
              }}
              className="px-4 py-1.5 rounded text-xs font-medium disabled:opacity-40"
              style={{ background: "var(--bg-tertiary)", color: "var(--danger)" }}
            >
              {t("settings.connection.disconnect")}
            </button>
          ) : (
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-1.5 rounded text-xs font-medium disabled:opacity-40"
              style={{ background: "var(--accent-dim)", color: "white" }}
            >
              {loading ? t("settings.connection.connecting") : t("settings.connection.connect")}
            </button>
          )}
        </div>
      )}
    </form>
  );
}
