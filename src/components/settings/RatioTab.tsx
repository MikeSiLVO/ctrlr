import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api";
import type { RatioGroup } from "../../api";
import type { ServerCapabilities } from "../../types";
import { loadJSON, saveJSON } from "../../prefs";
import { Select } from "../Select";
import { INPUT_STYLE, SaveFooter, TabError, TabNotice } from "../ui";

/** Storage key for the local ratio group names and upload units. */
const RATIO_PREFS_KEY = "ctrlr:ratio-group-prefs";

/** Unit a ratio group's upload limit is shown in. */
type UploadUnit = "MB" | "GB" | "TB";

/** Upload units for the picker, each with its size in GiB. */
const UPLOAD_UNITS: { value: UploadUnit; label: string; gib: number }[] = [
  { value: "MB", label: "MB", gib: 1 / 1024 },
  { value: "GB", label: "GB", gib: 1 },
  { value: "TB", label: "TB", gib: 1024 },
];

/** Local-only ratio group display names and upload units. */
interface RatioGroupPrefs {
  names: string[];
  upload_units: UploadUnit[];
}

/** Load local ratio group names and upload units, defaulting when absent or malformed. */
function loadRatioPrefs(): RatioGroupPrefs {
  const defaults: RatioGroupPrefs = {
    names: Array.from({ length: 8 }, (_, i) => `ratio${i}`),
    upload_units: Array.from({ length: 8 }, () => "GB" as UploadUnit),
  };
  const stored = loadJSON(RATIO_PREFS_KEY, defaults);
  return stored.names?.length === 8 && stored.upload_units?.length === 8 ? stored : defaults;
}

/** Save ratio group names and upload units to localStorage. */
function saveRatioPrefs(prefs: RatioGroupPrefs) {
  saveJSON(RATIO_PREFS_KEY, prefs);
}

/** Load the local display names of the eight ratio groups. */
export function loadRatioGroupNames(): string[] {
  return loadRatioPrefs().names;
}

/** Convert GiB to the number shown in an upload unit. */
function gibToDisplay(gib: number, unit: UploadUnit): number {
  const info = UPLOAD_UNITS.find((u) => u.value === unit)!;
  return gib / info.gib;
}

/** Convert a number shown in an upload unit back to GiB. */
function displayToGib(value: number, unit: UploadUnit): number {
  const info = UPLOAD_UNITS.find((u) => u.value === unit)!;
  return value * info.gib;
}

/** Ratio tab: server ratio group limits and actions, with names and upload units kept locally. */
export function RatioTab({ isConnected, capabilities }: { isConnected: boolean; capabilities: ServerCapabilities | null }) {
  const { t } = useTranslation();
  const [groups, setGroups] = useState<RatioGroup[] | null>(null);
  const [prefs, setPrefs] = useState<RatioGroupPrefs>(loadRatioPrefs);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const ratioActions = [
    { value: "stop", label: t("settings.ratio.stop") },
    { value: "close", label: t("settings.ratio.close") },
    { value: "remove", label: t("settings.ratio.remove") },
  ];

  useEffect(() => {
    if (!isConnected || !capabilities?.has_ratio_groups) return;
    setLoading(true);
    api.getRatioGroups()
      .then(setGroups)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [isConnected, capabilities?.has_ratio_groups]);

  if (!isConnected) return <TabNotice>{t("settings.ratio.connectFirst")}</TabNotice>;
  if (!capabilities?.has_ratio_groups) return <TabNotice>{t("settings.ratio.notSupported")}</TabNotice>;
  if (loading) return <TabNotice>{t("settings.ratio.loading")}</TabNotice>;
  if (!groups) return <TabError>{error || t("settings.ratio.failedToLoad")}</TabError>;

  function updateGroup(id: number, partial: Partial<RatioGroup>) {
    setGroups((gs) => gs ? gs.map((g) => g.id === id ? { ...g, ...partial } : g) : gs);
    setSaved(false);
  }

  function updateName(idx: number, name: string) {
    setPrefs((prev) => {
      const names = [...prev.names];
      names[idx] = name;
      return { ...prev, names };
    });
    setSaved(false);
  }

  function updateUploadUnit(idx: number, newUnit: UploadUnit) {
    setPrefs((prev) => {
      const units = [...prev.upload_units];
      units[idx] = newUnit;
      return { ...prev, upload_units: units };
    });
    setSaved(false);
  }

  async function handleSave() {
    if (!groups) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.saveRatioGroups(groups);
      saveRatioPrefs(prefs);
      setSaved(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
        {t("settings.ratio.description")}
      </div>

      <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)" }}>
            <th className="text-left py-1.5 px-1 font-medium" style={{ color: "var(--text-secondary)", width: "28px" }}></th>
            <th className="text-left py-1.5 px-1 font-medium" style={{ color: "var(--text-secondary)" }}>{t("settings.ratio.name")}</th>
            <th className="text-left py-1.5 px-1 font-medium" style={{ color: "var(--text-secondary)" }}>{t("settings.ratio.minRatio")}</th>
            <th className="text-left py-1.5 px-1 font-medium" style={{ color: "var(--text-secondary)" }}>{t("settings.ratio.maxRatio")}</th>
            <th className="text-left py-1.5 px-1 font-medium" style={{ color: "var(--text-secondary)" }}>{t("settings.ratio.upload")}</th>
            <th className="text-left py-1.5 px-1 font-medium" style={{ color: "var(--text-secondary)", width: "90px" }}>{t("settings.ratio.action")}</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.id} style={{ borderBottom: "1px solid var(--border)", opacity: g.enabled ? 1 : 0.5 }}>
              <td className="py-1.5 px-1">
                <input
                  type="checkbox"
                  checked={g.enabled}
                  onChange={(e) => updateGroup(g.id, { enabled: e.target.checked })}
                  className="accent-sky-500"
                />
              </td>
              <td className="py-1.5 px-1">
                <input
                  type="text"
                  value={prefs.names[g.id]}
                  onChange={(e) => updateName(g.id, e.target.value)}
                  className="w-24 px-1.5 py-0.5 rounded text-xs"
                  style={INPUT_STYLE}
                />
              </td>
              <td className="py-1.5 px-1">
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={g.min}
                  onChange={(e) => updateGroup(g.id, { min: parseFloat(e.target.value) || 0 })}
                  disabled={!g.enabled}
                  className="w-20 px-1.5 py-0.5 rounded text-xs disabled:opacity-40"
                  style={INPUT_STYLE}
                />
              </td>
              <td className="py-1.5 px-1">
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={g.max}
                  onChange={(e) => updateGroup(g.id, { max: parseFloat(e.target.value) || 0 })}
                  disabled={!g.enabled}
                  className="w-20 px-1.5 py-0.5 rounded text-xs disabled:opacity-40"
                  style={INPUT_STYLE}
                />
              </td>
              <td className="py-1.5 px-1">
                <div className="flex gap-1 items-center">
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={Math.round(gibToDisplay(g.upload_gib, prefs.upload_units[g.id]) * 100) / 100}
                    onChange={(e) => updateGroup(g.id, { upload_gib: displayToGib(parseFloat(e.target.value) || 0, prefs.upload_units[g.id]) })}
                    disabled={!g.enabled}
                    className="w-16 px-1.5 py-0.5 rounded text-xs disabled:opacity-40"
                    style={INPUT_STYLE}
                  />
                  <Select
                    value={prefs.upload_units[g.id]}
                    onChange={(v) => updateUploadUnit(g.id, v as UploadUnit)}
                    options={UPLOAD_UNITS.map((u) => ({ value: u.value, label: u.label }))}
                    disabled={!g.enabled}
                    className="text-xs"
                  />
                </div>
              </td>
              <td className="py-1.5 px-1">
                <Select
                  value={g.action}
                  onChange={(v) => updateGroup(g.id, { action: v })}
                  options={ratioActions}
                  disabled={!g.enabled}
                  className="text-xs"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
        {t("settings.ratio.uploadHint")}
      </div>

      <SaveFooter error={error} saved={saved} saving={saving} onSave={handleSave} />
    </div>
  );
}
