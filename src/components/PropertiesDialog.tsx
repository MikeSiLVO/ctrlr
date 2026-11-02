import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../api";
import type { TorrentProperties } from "../api";
import { Select } from "./Select";
import { INPUT_STYLE, DialogShell } from "./ui";

/** Props for the per-torrent properties dialog. */
interface PropertiesDialogProps {
  hash: string;
  onClose: () => void;
}

/** Properties dialog: one torrent's upload slots, peer limits, numwant and seed mode. */
export function PropertiesDialog({ hash, onClose }: PropertiesDialogProps) {
  const { t } = useTranslation();
  const [props, setProps] = useState<TorrentProperties | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getTorrentProperties(hash).then(setProps).catch((e) => setError(String(e)));
  }, [hash]);

  async function handleSave() {
    if (!props) return;
    setSaving(true);
    try {
      await api.setTorrentProperties(hash, props);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  function set<K extends keyof TorrentProperties>(key: K, value: TorrentProperties[K]) {
    setProps((prev) => prev ? { ...prev, [key]: value } : prev);
  }

  return (
    <DialogShell
      onClose={onClose}
      panelClassName="rounded-lg p-4 w-[340px] flex flex-col gap-3"
      panelStyle={{  }}
    >
        <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          {t("properties.title")}
        </span>

        {!props ? (
          <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
            {error || t("common.loading")}
          </span>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <label className="text-xs w-28 shrink-0" style={{ color: "var(--text-secondary)" }}>
                  {t("properties.uploadSlots")}
                </label>
                <input
                  type="number"
                  min={0}
                  value={props.max_uploads}
                  onChange={(e) => set("max_uploads", Number(e.target.value) || 0)}
                  className="flex-1 px-2 py-1 rounded text-xs outline-none"
                  style={INPUT_STYLE}
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs w-28 shrink-0" style={{ color: "var(--text-secondary)" }}>
                  {t("properties.minPeers")}
                </label>
                <input
                  type="number"
                  min={0}
                  value={props.peers_min}
                  onChange={(e) => set("peers_min", Number(e.target.value) || 0)}
                  className="flex-1 px-2 py-1 rounded text-xs outline-none"
                  style={INPUT_STYLE}
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs w-28 shrink-0" style={{ color: "var(--text-secondary)" }}>
                  {t("properties.maxPeers")}
                </label>
                <input
                  type="number"
                  min={0}
                  value={props.peers_max}
                  onChange={(e) => set("peers_max", Number(e.target.value) || 0)}
                  className="flex-1 px-2 py-1 rounded text-xs outline-none"
                  style={INPUT_STYLE}
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs w-28 shrink-0" style={{ color: "var(--text-secondary)" }}>
                  {t("properties.trackerNumwant")}
                </label>
                <input
                  type="number"
                  min={-1}
                  value={props.tracker_numwant}
                  onChange={(e) => set("tracker_numwant", Number(e.target.value))}
                  className="flex-1 px-2 py-1 rounded text-xs outline-none"
                  style={INPUT_STYLE}
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs w-28 shrink-0" style={{ color: "var(--text-secondary)" }}>
                  {t("properties.seedMode")}
                </label>
                <Select
                  value={props.connection_seed}
                  onChange={(v) => set("connection_seed", v)}
                  options={[
                    { value: "seed", label: t("properties.normalSeed") },
                    { value: "leech", label: t("properties.leech") },
                    { value: "initial_seed", label: t("properties.superSeed") },
                  ]}
                  className="flex-1 text-xs"
                />
              </div>
            </div>

            {error && (
              <span className="text-xs" style={{ color: "var(--danger)" }}>{error}</span>
            )}

            <div className="flex justify-end gap-2 mt-1">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1 rounded text-xs"
                style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)" }}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="px-3 py-1 rounded text-xs"
                style={{ background: "var(--accent)", color: "white" }}
              >
                {saving ? t("common.saving") : t("common.save")}
              </button>
            </div>
          </>
        )}
    </DialogShell>
  );
}
