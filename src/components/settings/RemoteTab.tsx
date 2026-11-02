import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api";
import type { RemoteSettings } from "../../api";
import { Select } from "../Select";
import { Checkbox, Input, NumInput, SaveFooter, SectionLabel, TabError, TabNotice } from "../ui";

/** Remote tab: rTorrent settings loaded from the server and saved back on demand. */
export function RemoteTab({ isConnected }: { isConnected: boolean }) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<RemoteSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!isConnected) return;
    setLoading(true);
    api.getRemoteSettings()
      .then(setSettings)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [isConnected]);

  if (!isConnected) return <TabNotice>{t("settings.remote.connectFirst")}</TabNotice>;
  if (loading) return <TabNotice>{t("settings.remote.loadingSettings")}</TabNotice>;
  if (!settings) return <TabError>{error || t("settings.remote.failedToLoad")}</TabError>;

  function update(partial: Partial<RemoteSettings>) {
    setSettings((s) => s ? { ...s, ...partial } : s);
    setSaved(false);
  }

  async function handleSave() {
    if (!settings) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.saveRemoteSettings(settings);
      setSaved(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <SectionLabel>{t("settings.remote.directory")}</SectionLabel>
        <Input
          label={t("settings.remote.defaultDownload")}
          value={settings.default_directory}
          onChange={(v) => update({ default_directory: v })}
          placeholder="/home/user/downloads"
        />
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>{t("settings.remote.slots")}</SectionLabel>
        <div className="flex gap-3">
          <NumInput label={t("settings.remote.maxUploads")} value={settings.max_uploads} onChange={(v) => update({ max_uploads: v })} width="100px" />
          <NumInput label={t("settings.remote.maxDownloads")} value={settings.max_downloads} onChange={(v) => update({ max_downloads: v })} width="100px" />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>{t("settings.remote.peersLeeching")}</SectionLabel>
        <div className="flex gap-3">
          <NumInput label={t("settings.remote.min")} value={settings.min_peers_normal} onChange={(v) => update({ min_peers_normal: v })} />
          <NumInput label={t("settings.remote.max")} value={settings.max_peers_normal} onChange={(v) => update({ max_peers_normal: v })} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>{t("settings.remote.peersSeeding")}</SectionLabel>
        <div className="flex gap-3">
          <NumInput label={t("settings.remote.min")} value={settings.min_peers_seed} onChange={(v) => update({ min_peers_seed: v })} />
          <NumInput label={t("settings.remote.max")} value={settings.max_peers_seed} onChange={(v) => update({ max_peers_seed: v })} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>{t("settings.remote.network")}</SectionLabel>
        <Input
          label={t("settings.remote.portRange")}
          value={settings.port_range}
          onChange={(v) => update({ port_range: v })}
          placeholder="6881-6999"
        />
        <div className="flex gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: "var(--text-secondary)" }}>{t("settings.remote.dht")}</label>
            <Select
              value={settings.dht ?? ""}
              onChange={(v) => update({ dht: v || null })}
              options={settings.dht === null
                ? [{ value: "", label: t("settings.remote.unavailable") }]
                : [
                    { value: "disable", label: t("settings.remote.disable") },
                    { value: "off", label: t("settings.remote.off") },
                    { value: "auto", label: t("settings.remote.auto") },
                    { value: "on", label: t("settings.remote.on") },
                  ]
              }
              disabled={settings.dht === null}
              className="text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: "var(--text-secondary)" }}>
              {t("settings.remote.encryption")} <span style={{ opacity: 0.5 }}>({t("settings.remote.writeOnly")})</span>
            </label>
            <Select
              value={settings.encryption ?? ""}
              onChange={(v) => update({ encryption: v || null })}
              options={[
                { value: "", label: t("settings.remote.dontChange") },
                { value: "none", label: t("settings.remote.encNone") },
                { value: "allow_incoming,enable_retry,prefer_plaintext", label: t("settings.remote.encAllow") },
                { value: "require,require_RC4", label: t("settings.remote.encRequire") },
                { value: "allow_incoming,try_outgoing,enable_retry", label: t("settings.remote.encPrefer") },
              ]}
              className="text-sm"
            />
          </div>
        </div>
        {settings.dht_override_port !== null && (
          <NumInput label={t("settings.remote.dhtPortOverride")} value={settings.dht_override_port} onChange={(v) => update({ dht_override_port: v })} min={0} max={65535} hint="0 = default" />
        )}
        {settings.tracker_numwant !== null && (
          <NumInput label={t("settings.remote.trackerNumwant")} value={settings.tracker_numwant} onChange={(v) => update({ tracker_numwant: v })} min={-1} hint="-1 = default" />
        )}
        <Checkbox checked={settings.pex} onChange={(v) => update({ pex: v })} label={t("settings.remote.pex")} />
        <Checkbox checked={settings.hash_on_completion} onChange={(v) => update({ hash_on_completion: v })} label={t("settings.remote.hashOnCompletion")} />
      </div>

      {(settings.scheduler_max_active !== null || settings.send_buffer_size !== null) && (
        <div className="flex flex-col gap-2">
          <SectionLabel>{t("settings.remote.advanced")}</SectionLabel>
          <div className="flex gap-3">
            {settings.scheduler_max_active !== null && (
              <NumInput label={t("settings.remote.maxActive")} value={settings.scheduler_max_active} onChange={(v) => update({ scheduler_max_active: v })} />
            )}
            {settings.send_buffer_size !== null && (
              <NumInput label={t("settings.remote.sendBuffer")} value={settings.send_buffer_size} onChange={(v) => update({ send_buffer_size: v })} />
            )}
            {settings.receive_buffer_size !== null && (
              <NumInput label={t("settings.remote.recvBuffer")} value={settings.receive_buffer_size} onChange={(v) => update({ receive_buffer_size: v })} />
            )}
          </div>
        </div>
      )}

      <SaveFooter error={error} saved={saved} saving={saving} onSave={handleSave} />
    </div>
  );
}
