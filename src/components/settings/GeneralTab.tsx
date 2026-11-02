import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Select } from "../Select";
import { Checkbox, INPUT_STYLE, SectionLabel } from "../ui";
import { DEFAULT_SPEED_PRESETS, STORAGE_KEY_PRESETS, loadPresets, saveJSON } from "../../prefs";
import { THEMES, type ThemeId } from "../../theme";
import i18n, { LANGUAGES } from "../../i18n";
import { formatLimit } from "../../format";

/** General tab: app preferences; language and speed presets save here, the rest via the parent. */
export function GeneralTab({
  closeToTray,
  onCloseToTrayChange,
  startMinimized,
  onStartMinimizedChange,
  autostart,
  onAutostartChange,
  pollInterval,
  onPollIntervalChange,
  confirmRemove,
  onConfirmRemoveChange,
  checkUpdates,
  onCheckUpdatesChange,
  notifyComplete,
  onNotifyCompleteChange,
  notifyRatio,
  onNotifyRatioChange,
  ratioTarget,
  onRatioTargetChange,
  showSpeedInTitle,
  onShowSpeedInTitleChange,
  showSearchBar,
  onShowSearchBarChange,
  showSidebar,
  onShowSidebarChange,
  defaultTrackers,
  onDefaultTrackersChange,
  diskProvider,
  onDiskProviderChange,
  diskQuotaGB,
  onDiskQuotaGBChange,
  theme,
  onThemeChange,
}: {
  closeToTray: boolean;
  onCloseToTrayChange: (v: boolean) => void;
  startMinimized: boolean;
  onStartMinimizedChange: (v: boolean) => void;
  autostart: boolean;
  onAutostartChange: (v: boolean) => void;
  pollInterval: number;
  onPollIntervalChange: (ms: number) => void;
  confirmRemove: boolean;
  onConfirmRemoveChange: (v: boolean) => void;
  checkUpdates: boolean;
  onCheckUpdatesChange: (v: boolean) => void;
  notifyComplete: boolean;
  onNotifyCompleteChange: (v: boolean) => void;
  notifyRatio: boolean;
  onNotifyRatioChange: (v: boolean) => void;
  ratioTarget: number;
  onRatioTargetChange: (v: number) => void;
  showSpeedInTitle: boolean;
  onShowSpeedInTitleChange: (v: boolean) => void;
  showSearchBar: boolean;
  onShowSearchBarChange: (v: boolean) => void;
  showSidebar: boolean;
  onShowSidebarChange: (v: boolean) => void;
  defaultTrackers: string;
  onDefaultTrackersChange: (v: string) => void;
  diskProvider: string;
  onDiskProviderChange: (v: string) => void;
  diskQuotaGB: number;
  onDiskQuotaGBChange: (v: number) => void;
  theme: ThemeId;
  onThemeChange: (v: ThemeId) => void;
}) {
  const { t } = useTranslation();
  const [presets, setPresets] = useState(loadPresets);
  const [presetInput, setPresetInput] = useState("");

  function savePresets(next: number[]) {
    setPresets(next);
    saveJSON(STORAGE_KEY_PRESETS, next);
  }

  function addPreset() {
    const val = Math.round(Number(presetInput));
    if (isNaN(val) || val < 0 || presets.includes(val)) return;
    const next = [...presets, val].sort((a, b) => a - b);
    savePresets(next);
    setPresetInput("");
  }

  function removePreset(kb: number) {
    savePresets(presets.filter((p) => p !== kb));
  }

  function resetPresets() {
    savePresets(DEFAULT_SPEED_PRESETS);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="text-xs" style={{ color: "var(--text-primary)" }}>{t("settings.general.theme")}</span>
        <Select
          value={theme}
          onChange={(v) => onThemeChange(v as ThemeId)}
          options={THEMES.map((th) => ({ value: th.id, label: th.label }))}
          className="text-xs"
          style={{ minWidth: 100 }}
        />
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs" style={{ color: "var(--text-primary)" }}>{t("settings.general.language")}</span>
        <Select
          value={i18n.resolvedLanguage ?? "en"}
          onChange={(v) => i18n.changeLanguage(v)}
          options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))}
          className="text-xs"
          style={{ minWidth: 100 }}
        />
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>{t("settings.general.window")}</SectionLabel>
        <Checkbox checked={closeToTray} onChange={onCloseToTrayChange} label={t("settings.general.closeToTray")} />
        <Checkbox checked={startMinimized} onChange={onStartMinimizedChange} label={t("settings.general.startMinimized")} />
        <Checkbox checked={autostart} onChange={onAutostartChange} label={t("settings.general.autostart")} />
        <Checkbox checked={showSpeedInTitle} onChange={onShowSpeedInTitleChange} label={t("settings.general.speedInTitle")} />
        <Checkbox checked={showSearchBar} onChange={onShowSearchBarChange} label={t("settings.general.showSearchBar")} />
        <Checkbox checked={showSidebar} onChange={onShowSidebarChange} label={t("settings.general.showSidebar")} />
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>{t("settings.general.behavior")}</SectionLabel>
        <Checkbox checked={confirmRemove} onChange={onConfirmRemoveChange} label={t("settings.general.confirmRemove")} />
        <Checkbox checked={checkUpdates} onChange={onCheckUpdatesChange} label={t("settings.general.checkUpdates")} />
        <div className="flex items-center gap-2">
          <span className="text-xs" style={{ color: "var(--text-primary)" }}>{t("settings.general.pollInterval")}</span>
          <Select
            value={String(pollInterval)}
            onChange={(v) => onPollIntervalChange(Number(v))}
            options={[
              { value: "1000", label: "1s" },
              { value: "2000", label: "2s" },
              { value: "3000", label: "3s" },
              { value: "5000", label: "5s" },
              { value: "10000", label: "10s" },
            ]}
            className="text-xs"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>{t("settings.general.defaultTrackers")}</SectionLabel>
        <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
          {t("settings.general.defaultTrackersHint")}
        </span>
        <textarea
          value={defaultTrackers}
          onChange={(e) => onDefaultTrackersChange(e.target.value)}
          rows={3}
          placeholder={"https://tracker.example.com/announce\nudp://open.tracker.cl:1337/announce"}
          className="px-2 py-1.5 rounded text-xs outline-none resize-y"
          style={{
            background: "var(--bg-secondary)",
            color: "var(--text-primary)",
            border: "1px solid var(--border)",
            fontFamily: "monospace",
          }}
        />
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>{t("settings.general.speedPresets")}</SectionLabel>
        <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
          {t("settings.general.speedPresetsHint")}
        </span>
        <div className="flex flex-wrap gap-1">
          {presets.map((kb) => (
            <span
              key={kb}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs"
              style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
            >
              {kb === 0 ? "\u221e" : formatLimit(kb)}
              {kb !== 0 && (
                <button
                  onClick={() => removePreset(kb)}
                  className="ml-0.5 hover:brightness-150"
                  style={{ color: "var(--text-secondary)", fontSize: "10px" }}
                >
                  {"\u00d7"}
                </button>
              )}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <input
            type="number"
            min="1"
            value={presetInput}
            onChange={(e) => setPresetInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addPreset(); }}
            placeholder="KB/s"
            className="px-2 py-1 rounded text-xs outline-none w-20"
            style={INPUT_STYLE}
          />
          <button
            onClick={addPreset}
            className="px-2 py-1 rounded text-xs"
            style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
          >
            {t("common.add")}
          </button>
          <button
            onClick={resetPresets}
            className="px-2 py-1 rounded text-xs"
            style={{ color: "var(--text-secondary)" }}
          >
            {t("common.reset")}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>{t("settings.general.diskSpace")}</SectionLabel>
        <div className="flex items-center gap-2">
          <span className="text-xs" style={{ color: "var(--text-primary)" }}>{t("settings.general.provider")}</span>
          <Select
            value={diskProvider}
            onChange={onDiskProviderChange}
            options={[
              { value: "auto", label: "Auto (df)" },
              { value: "whatbox", label: "Whatbox" },
            ]}
            className="text-xs"
          />
        </div>
        {diskProvider === "whatbox" && (
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: "var(--text-primary)" }}>{t("settings.general.slotQuota")}</span>
            <input
              type="number"
              min="1"
              value={diskQuotaGB || ""}
              onChange={(e) => onDiskQuotaGBChange(Number(e.target.value) || 0)}
              className="px-2 py-1 rounded text-xs outline-none w-20"
              style={INPUT_STYLE}
            />
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>GB</span>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>{t("settings.general.notifications")}</SectionLabel>
        <Checkbox checked={notifyComplete} onChange={onNotifyCompleteChange} label={t("settings.general.notifyComplete")} />
        <Checkbox checked={notifyRatio} onChange={onNotifyRatioChange} label={t("settings.general.notifyRatio")} />
        {notifyRatio && (
          <div className="flex items-center gap-2 ml-6">
            <span className="text-xs" style={{ color: "var(--text-primary)" }}>{t("settings.general.ratioTarget")}</span>
            <input
              type="number"
              step="0.1"
              min="0.1"
              value={ratioTarget}
              onChange={(e) => onRatioTargetChange(Number(e.target.value) || 1.0)}
              className="px-2 py-1 rounded text-xs outline-none w-16"
              style={INPUT_STYLE}
            />
          </div>
        )}
      </div>
    </div>
  );
}
