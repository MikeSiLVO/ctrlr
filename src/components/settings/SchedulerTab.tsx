import React, { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api";
import type { SchedulerConfig, SchedulerProfile, SchedulerGrid } from "../../types";
import { formatLimit } from "../../format";
import { Checkbox, INPUT_STYLE, SaveFooter, SectionLabel, TabError, TabNotice } from "../ui";

/** Grid day keys, Monday first. */
const DAY_KEYS: (keyof SchedulerGrid)[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** Day label translation keys, Monday first. */
const DAY_I18N_KEYS = [
  "settings.scheduler.days.mon",
  "settings.scheduler.days.tue",
  "settings.scheduler.days.wed",
  "settings.scheduler.days.thu",
  "settings.scheduler.days.fri",
  "settings.scheduler.days.sat",
  "settings.scheduler.days.sun",
] as const;

/** Grid cell colors by profile index, 0 being unlimited and then up to five custom profiles. */
const PROFILE_COLORS = [
  "var(--bg-tertiary)",
  "#3b82f6",
  "#f59e0b",
  "#10b981",
  "#ef4444",
  "#8b5cf6",
];

/** Profile name with its down and up limits, infinity for unlimited. */
function profileLabel(p: SchedulerProfile): string {
  const down = p.down_kb === 0 ? "∞" : formatLimit(p.down_kb);
  const up = p.up_kb === 0 ? "∞" : formatLimit(p.up_kb);
  return `${p.name} (↓${down} ↑${up})`;
}

/** Scheduler tab: speed profiles painted onto a 7x24 week grid, saved to the backend scheduler. */
export function SchedulerTab() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<SchedulerConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [activeTool, setActiveTool] = useState(0);
  const [activeDay, setActiveDay] = useState(-1);
  const [activeHour, setActiveHour] = useState(-1);
  const paintingRef = useRef(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([api.schedulerGetConfig(), api.schedulerGetActive()])
      .then(([cfg, active]) => {
        setConfig(cfg);
        setActiveDay(active.day);
        setActiveHour(active.hour);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      api.schedulerGetActive().then((a) => {
        setActiveDay(a.day);
        setActiveHour(a.hour);
      });
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const paintCell = useCallback(
    (day: number, hour: number) => {
      if (!config) return;
      setConfig((prev) => {
        if (!prev) return prev;
        const key = DAY_KEYS[day];
        const row = [...prev.grid[key]];
        if (row[hour] === activeTool) return prev;
        row[hour] = activeTool;
        return { ...prev, grid: { ...prev.grid, [key]: row } };
      });
      setSaved(false);
    },
    [config, activeTool],
  );

  if (loading) return <TabNotice>{t("settings.scheduler.loading")}</TabNotice>;
  if (!config) return <TabError>{error || t("settings.scheduler.failedToLoad")}</TabError>;

  function updateProfile(idx: number, partial: Partial<SchedulerProfile>) {
    setConfig((prev) => {
      if (!prev) return prev;
      const profiles = prev.profiles.map((p, i) => (i === idx ? { ...p, ...partial } : p));
      return { ...prev, profiles };
    });
    setSaved(false);
  }

  function addProfile() {
    if (!config || config.profiles.length >= 5) return;
    setConfig({
      ...config,
      profiles: [...config.profiles, { name: `Profile ${config.profiles.length + 1}`, down_kb: 0, up_kb: 0 }],
    });
    setSaved(false);
  }

  function removeProfile(idx: number) {
    if (!config) return;
    const profileIndex = idx + 1;
    const newGrid = { ...config.grid };
    for (const key of DAY_KEYS) {
      newGrid[key] = config.grid[key].map((v) => {
        if (v === profileIndex) return 0;
        if (v > profileIndex) return v - 1;
        return v;
      });
    }
    const profiles = config.profiles.filter((_, i) => i !== idx);
    setConfig({ ...config, profiles, grid: newGrid });
    if (activeTool === profileIndex) setActiveTool(0);
    else if (activeTool > profileIndex) setActiveTool(activeTool - 1);
    setSaved(false);
  }

  async function handleSave() {
    if (!config) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.schedulerSaveConfig(config);
      setSaved(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  const allProfiles = [
    { name: t("settings.scheduler.unlimited"), down_kb: 0, up_kb: 0 },
    ...config.profiles,
  ];

  function profileTooltip(idx: number): string {
    const p = allProfiles[idx];
    return p ? profileLabel(p) : "";
  }

  const currentProfile = allProfiles[config.grid[DAY_KEYS[activeDay]]?.[activeHour] ?? 0];
  const currentText = currentProfile
    ? `${t(DAY_I18N_KEYS[activeDay])} ${String(activeHour).padStart(2, "0")}:00 \u2192 ${profileLabel(currentProfile)}`
    : "";

  return (
    <div
      className="flex flex-col gap-3"
      onMouseUp={() => { paintingRef.current = false; }}
      onMouseLeave={() => { paintingRef.current = false; }}
    >
      <Checkbox
        checked={config.enabled}
        onChange={(v) => { setConfig({ ...config, enabled: v }); setSaved(false); }}
        label={t("settings.scheduler.enable")}
      />

      <div className="flex flex-col gap-1.5">
        <SectionLabel>{t("settings.scheduler.speedProfiles")}</SectionLabel>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTool(0)}
              className="w-5 h-5 rounded-sm shrink-0 border-2"
              style={{
                background: PROFILE_COLORS[0],
                borderColor: activeTool === 0 ? "var(--text-primary)" : "transparent",
              }}
              title={t("settings.scheduler.selectToPaint")}
            />
            <span className="px-1.5 py-1 text-xs w-24" style={{ color: "var(--text-secondary)" }}>
              {t("settings.scheduler.unlimited")}
            </span>
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{"\u2193"}</span>
            <span className="px-1.5 py-1 text-xs w-16" style={{ color: "var(--text-secondary)" }}>{"\u221e"}</span>
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{"\u2191"}</span>
            <span className="px-1.5 py-1 text-xs w-16" style={{ color: "var(--text-secondary)" }}>{"\u221e"}</span>
          </div>

          {config.profiles.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveTool(i + 1)}
                className="w-5 h-5 rounded-sm shrink-0 border-2"
                style={{
                  background: PROFILE_COLORS[(i + 1) % PROFILE_COLORS.length],
                  borderColor: activeTool === i + 1 ? "var(--text-primary)" : "transparent",
                }}
                title={t("settings.scheduler.selectToPaint")}
              />
              <input
                type="text"
                value={p.name}
                onChange={(e) => updateProfile(i, { name: e.target.value })}
                className="px-1.5 py-1 rounded text-xs w-24"
                style={INPUT_STYLE}
              />
              <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{"\u2193"}</span>
              <input
                type="number"
                min={0}
                value={p.down_kb}
                onChange={(e) => updateProfile(i, { down_kb: Number(e.target.value) || 0 })}
                className="px-1.5 py-1 rounded text-xs w-16"
                style={INPUT_STYLE}
                title={t("settings.scheduler.downloadLimit")}
              />
              <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{"\u2191"}</span>
              <input
                type="number"
                min={0}
                value={p.up_kb}
                onChange={(e) => updateProfile(i, { up_kb: Number(e.target.value) || 0 })}
                className="px-1.5 py-1 rounded text-xs w-16"
                style={INPUT_STYLE}
                title={t("settings.scheduler.uploadLimit")}
              />
              <span className="text-xs" style={{ color: "var(--text-secondary)" }}>KB/s</span>
              <button
                type="button"
                onClick={() => removeProfile(i)}
                className="text-sm hover:brightness-150 ml-1"
                style={{ color: "var(--text-secondary)" }}
                title={t("settings.scheduler.removeProfile")}
              >
                {"\u00d7"}
              </button>
            </div>
          ))}

          {config.profiles.length < 5 && (
            <button
              type="button"
              onClick={addProfile}
              className="text-xs px-2 py-1 rounded self-start"
              style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
            >
              {t("settings.scheduler.addProfile")}
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <SectionLabel>{t("settings.scheduler.scheduleGrid")}</SectionLabel>
        <div
          className="select-none"
          style={{
            display: "grid",
            gridTemplateColumns: "36px repeat(24, 1fr)",
            gap: 2,
          }}
        >
          <div />
          {Array.from({ length: 24 }, (_, h) => (
            <div
              key={h}
              className="text-center"
              style={{
                fontSize: "11px",
                lineHeight: "18px",
                color: "var(--text-secondary)",
              }}
            >
              {h}
            </div>
          ))}

          {DAY_KEYS.map((dayKey, dayIdx) => (
            <React.Fragment key={dayKey}>
              <span
                style={{
                  fontSize: "12px",
                  lineHeight: "22px",
                  color: "var(--text-secondary)",
                  textAlign: "right",
                  paddingRight: 2,
                }}
              >
                {t(DAY_I18N_KEYS[dayIdx])}
              </span>
              {Array.from({ length: 24 }, (_, h) => {
                const profileIdx = config.grid[DAY_KEYS[dayIdx]][h] ?? 0;
                const isCurrent = config.enabled && dayIdx === activeDay && h === activeHour;
                return (
                  <div
                    key={`${dayKey}-${h}`}
                    onMouseDown={() => {
                      paintingRef.current = true;
                      paintCell(dayIdx, h);
                    }}
                    onMouseEnter={() => {
                      if (paintingRef.current) paintCell(dayIdx, h);
                    }}
                    title={profileTooltip(profileIdx)}
                    style={{
                      height: 22,
                      borderRadius: 2,
                      background: PROFILE_COLORS[profileIdx % PROFILE_COLORS.length],
                      outline: isCurrent
                        ? "2px solid var(--accent)"
                        : "none",
                      outlineOffset: -1,
                      cursor: "pointer",
                      position: "relative",
                    }}
                  >
                    {isCurrent && (
                      <div style={{
                        position: "absolute",
                        top: 0,
                        right: 0,
                        width: 0,
                        height: 0,
                        borderTop: "7px solid var(--accent)",
                        borderLeft: "7px solid transparent",
                      }} />
                    )}
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>

      {config.enabled && activeDay >= 0 && (
        <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
          {t("settings.scheduler.now")} {currentText}
        </div>
      )}

      <SaveFooter error={error} saved={saved} saving={saving} onSave={handleSave} />
    </div>
  );
}
