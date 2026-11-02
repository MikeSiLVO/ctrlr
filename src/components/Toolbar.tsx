import { useTranslation } from "react-i18next";
import type { ProfileInfo } from "../api";
import { ConnectionPopover } from "./ConnectionPopover";

/** Props for the main toolbar. */
interface ToolbarProps {
  hasSelection: boolean;
  isPaused: boolean;
  showLog: boolean;
  showSearchBar: boolean;
  searchText: string;
  onSearchChange: (text: string) => void;
  onAdd: () => void;
  onRemove: () => void;
  onTogglePause: () => void;
  onRecheck: () => void;
  onToggleLog: () => void;
  onSettings: () => void;
  onRss: () => void;
  onHistory: () => void;
  activeProfile: string | null;
  profiles: ProfileInfo[];
  isConnected: boolean;
  onSwitchProfile: (name: string) => void;
  onDisconnect: () => void;
  onEditProfile: (name: string) => void;
  onAddProfile: () => void;
}

/** Toolbar text button, red for a destructive action. */
function ToolbarButton({
  label,
  onClick,
  disabled,
  variant,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "danger";
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="px-3 py-1 rounded text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      style={{
        background: variant === "danger" ? "var(--danger)" : "var(--bg-tertiary)",
        color: "var(--text-primary)",
      }}
    >
      {label}
    </button>
  );
}

/** Main toolbar of torrent actions, optional search box, dialog buttons and connection switcher. */
export function Toolbar({
  hasSelection,
  isPaused,
  showLog,
  showSearchBar,
  searchText,
  onSearchChange,
  onAdd,
  onRemove,
  onTogglePause,
  onRecheck,
  onToggleLog,
  onSettings,
  onRss,
  onHistory,
  activeProfile,
  profiles,
  isConnected,
  onSwitchProfile,
  onDisconnect,
  onEditProfile,
  onAddProfile,
}: ToolbarProps) {
  const { t } = useTranslation();

  return (
    <div
      className="flex items-center gap-2 px-3 py-2"
      style={{
        background: "var(--bg-secondary)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <ToolbarButton label={t("toolbar.add")} onClick={onAdd} />
      <ToolbarButton
        label={t("toolbar.remove")}
        onClick={onRemove}
        disabled={!hasSelection}
        variant="danger"
      />
      <div
        className="mx-1"
        style={{ width: 1, height: 20, background: "var(--border)" }}
      />
      <ToolbarButton
        label={isPaused ? t("toolbar.resume") : t("toolbar.pause")}
        onClick={onTogglePause}
        disabled={!hasSelection}
      />
      <ToolbarButton
        label={t("toolbar.recheck")}
        onClick={onRecheck}
        disabled={!hasSelection}
      />
      <div className="flex-1" />
      {showSearchBar && (
        <input
          type="text"
          data-search-filter
          placeholder={t("common.filter")}
          value={searchText}
          onChange={(e) => onSearchChange(e.target.value)}
          className="px-2 rounded text-xs"
          style={{
            background: "var(--bg-tertiary)",
            color: "var(--text-primary)",
            border: `1px solid ${searchText ? "var(--accent)" : "var(--border)"}`,
            width: "160px",
            height: "24px",
            outline: "none",
          }}
        />
      )}
      <div
        className="mx-0.5"
        style={{ width: 1, height: 20, background: "var(--border)" }}
      />
      <button
        onClick={onToggleLog}
        className="px-3 py-1 rounded text-xs font-medium transition-colors"
        style={{
          background: showLog ? "var(--accent)" : "var(--bg-tertiary)",
          color: showLog ? "#fff" : "var(--text-primary)",
        }}
      >
        {t("toolbar.log")}
      </button>
      <ToolbarButton label={t("toolbar.rss")} onClick={onRss} />
      <ToolbarButton label={t("toolbar.history")} onClick={onHistory} />
      <ToolbarButton label={t("toolbar.settings")} onClick={onSettings} />
      {isConnected && (
        <>
          <div
            className="mx-0.5"
            style={{ width: 1, height: 20, background: "var(--border)" }}
          />
          <ConnectionPopover
            activeProfile={activeProfile}
            profiles={profiles}
            isConnected={isConnected}
            onSwitch={onSwitchProfile}
            onDisconnect={onDisconnect}
            onEdit={onEditProfile}
            onAdd={onAddProfile}
          />
        </>
      )}
    </div>
  );
}
