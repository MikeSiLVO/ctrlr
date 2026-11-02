import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import * as api from "../api";
import type { TransferStats, UpdateInfo } from "../types";
import { formatLimit, formatRate, formatSize } from "../format";
import { loadPresets } from "../prefs";
import { ContextMenu } from "./ContextMenu";

/** Props for the bottom status bar. */
interface StatusBarProps {
  stats: TransferStats | null;
  limits: [number, number] | null;
  onLimitsChanged: () => void;
  freeDiskspace: number | null;
  totalSize: number | null;
  decimalSize?: boolean;
  update: UpdateInfo | null;
  onDismissUpdate: () => void;
}

/** Speed limit readout, edited inline in KB/s on click, with presets on right-click. */
function LimitEditor({
  label,
  arrow,
  arrowColor,
  currentLimit,
  onSave,
}: {
  label: string;
  arrow: string;
  arrowColor: string;
  currentLimit: number;
  onSave: (kb: number) => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [presetMenu, setPresetMenu] = useState<{ x: number; y: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [presets] = useState(loadPresets);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function startEdit() {
    setValue(currentLimit === 0 ? "" : String(Math.round(currentLimit / 1024)));
    setEditing(true);
  }

  function commit() {
    setEditing(false);
    const trimmed = value.trim();
    const kb = trimmed === "" ? 0 : Math.max(0, Math.round(Number(trimmed)));
    if (!isNaN(kb)) onSave(kb);
  }

  if (editing) {
    return (
      <span className="flex items-center gap-1">
        <span style={{ color: arrowColor }}>{arrow}</span>
        {label}:
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
          placeholder={`0 = \u221e`}
          className="w-16 px-1 rounded text-[11px] outline-none"
          style={{
            background: "var(--bg-tertiary)",
            border: "1px solid var(--border)",
            color: "var(--text-primary)",
          }}
        />
        <span style={{ color: "var(--text-secondary)" }}>KB/s</span>
      </span>
    );
  }

  return (
    <>
      <span
        onClick={startEdit}
        onContextMenu={(e) => {
          e.preventDefault();
          setPresetMenu({ x: e.clientX, y: e.clientY });
        }}
        className="cursor-pointer hover:underline"
        title={t("statusbar.editLimit")}
      >
        {label}: {currentLimit === 0 ? "\u221e" : `${formatSize(currentLimit)}/s`}
      </span>
      {presetMenu && (
        <ContextMenu
          x={presetMenu.x}
          y={presetMenu.y}
          items={presets.map((kb) => ({
            label: kb === 0 ? t("statusbar.unlimited") : formatLimit(kb),
            onClick: () => onSave(kb),
          }))}
          onClose={() => setPresetMenu(null)}
        />
      )}
    </>
  );
}

/** Bottom bar of rates, totals, disk space and any update; global limits save to the server. */
export function StatusBar({
  stats, limits, onLimitsChanged, freeDiskspace, totalSize, decimalSize, update, onDismissUpdate,
}: StatusBarProps) {
  const { t } = useTranslation();
  const upLimit = limits ? limits[0] : 0;
  const downLimit = limits ? limits[1] : 0;

  return (
    <div
      className="flex items-center justify-between px-3 py-1 shrink-0"
      style={{
        background: "var(--bg-secondary)",
        borderTop: "1px solid var(--border)",
        color: "var(--text-secondary)",
        fontSize: "13px",
      }}
    >
      <div className="flex items-center">
        <span>
          <span style={{ color: "var(--success)" }}>{"\u2191"}</span>{" "}
          {stats ? (formatRate(stats.up_rate) || "0 B/s") : "-"}
          {stats ? ` (${formatSize(stats.up_total)})` : ""}
        </span>
        <span className="mx-2" style={{ color: "var(--border)" }}>{"|"}</span>
        <span>
          <span style={{ color: "var(--accent)" }}>{"\u2193"}</span>{" "}
          {stats ? (formatRate(stats.down_rate) || "0 B/s") : "-"}
          {stats ? ` (${formatSize(stats.down_total)})` : ""}
        </span>
        {totalSize != null && totalSize > 0 && (
          <>
            <span className="mx-2" style={{ color: "var(--border)" }}>{"|"}</span>
            <span title={t("statusbar.totalSize")}>
              {t("statusbar.torrents")} {formatSize(totalSize, decimalSize)}
            </span>
          </>
        )}
        {freeDiskspace != null && freeDiskspace > 0 && (
          <>
            <span className="mx-2" style={{ color: "var(--border)" }}>{"|"}</span>
            <span title={t("statusbar.freeDisk")}>
              {formatSize(freeDiskspace, decimalSize)} {t("statusbar.free")}
            </span>
          </>
        )}
      </div>
      <div className="flex gap-4">
        {update && (
          <span className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => openUrl(update.url)}
              title={t("statusbar.openRelease")}
              className="hover:underline"
              style={{ color: "var(--accent)" }}
            >
              {t("statusbar.updateAvailable", { version: update.version })}
            </button>
            <button
              type="button"
              onClick={onDismissUpdate}
              title={t("statusbar.dismissUpdate")}
              className="hover:brightness-150"
              style={{ color: "var(--text-secondary)" }}
            >
              {"\u00d7"}
            </button>
          </span>
        )}
        <LimitEditor
          label={t("statusbar.ul")}
          arrow={"\u2191"}
          arrowColor="var(--success)"
          currentLimit={upLimit}
          onSave={(kb) => api.setUploadLimit(kb).then(onLimitsChanged)}
        />
        <LimitEditor
          label={t("statusbar.dl")}
          arrow={"\u2193"}
          arrowColor="var(--accent)"
          currentLimit={downLimit}
          onSave={(kb) => api.setDownloadLimit(kb).then(onLimitsChanged)}
        />
      </div>
    </div>
  );
}
