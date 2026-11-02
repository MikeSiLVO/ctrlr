import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { ServerCapabilities } from "../../types";
import { SidebarTab, DialogShell } from "../ui";
import type { ThemeId } from "../../theme";
import { AboutTab } from "./AboutTab";
import { ConnectionTab } from "./ConnectionTab";
import { DebugTab } from "./DebugTab";
import { GeneralTab } from "./GeneralTab";
import { RatioTab } from "./RatioTab";
import { RemoteTab } from "./RemoteTab";
import { SchedulerTab } from "./SchedulerTab";

/** Tabs of the settings dialog. */
type Tab = "general" | "remote" | "ratio" | "scheduler" | "connection" | "debug" | "about";

/** Props for the settings dialog: connect callbacks, opening tab, each preference and setter. */
interface SettingsDialogProps {
  onConnected: () => void;
  onDisconnected?: () => void;
  onClose?: () => void;
  required?: boolean;
  isConnected?: boolean;
  initialTab?: Tab;
  initialProfile?: string;
  initialAddMode?: boolean;
  closeToTray: boolean;
  onCloseToTrayChange: (v: boolean) => void;
  pollInterval: number;
  onPollIntervalChange: (ms: number) => void;
  confirmRemove: boolean;
  onConfirmRemoveChange: (v: boolean) => void;
  checkUpdates: boolean;
  onCheckUpdatesChange: (v: boolean) => void;
  startMinimized: boolean;
  onStartMinimizedChange: (v: boolean) => void;
  autostart: boolean;
  onAutostartChange: (v: boolean) => void;
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
  capabilities?: ServerCapabilities | null;
}

/** Settings dialog: app, server and connection tabs; stays open while a connection is required. */
export function SettingsDialog({
  onConnected,
  onDisconnected,
  onClose,
  required,
  isConnected: connected,
  initialTab,
  initialProfile,
  initialAddMode,
  closeToTray,
  onCloseToTrayChange,
  pollInterval,
  onPollIntervalChange,
  confirmRemove,
  onConfirmRemoveChange,
  checkUpdates,
  onCheckUpdatesChange,
  startMinimized,
  onStartMinimizedChange,
  autostart,
  onAutostartChange,
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
  capabilities,
}: SettingsDialogProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>(initialTab ?? (required ? "connection" : "general"));
  const [addMode, setAddMode] = useState(initialAddMode);
  // the Connection tab remounts on every visit; the add prompt belongs to the first
  useEffect(() => {
    if (tab !== "connection") setAddMode(false);
  }, [tab]);

  return (
    <DialogShell
      onClose={onClose ?? (() => {})}
      dismissible={!required}
      panelClassName="rounded-lg flex"
      // one size for every tab; resizing per tab moves the sidebar out from under the cursor
      panelStyle={{ width: "780px", height: "520px" }}
    >
        <div
          className="flex flex-col gap-1 p-3 shrink-0 w-[130px]"
          style={{ borderRight: "1px solid var(--border)" }}
        >
          <span className="text-xs font-semibold px-3 pb-1" style={{ color: "var(--text-primary)" }}>
            {t("settings.title")}
          </span>
          <SidebarTab label={t("settings.general")} active={tab === "general"} onClick={() => setTab("general")} />
          <SidebarTab label={t("settings.remote")} active={tab === "remote"} onClick={() => setTab("remote")} />
          <SidebarTab label={t("settings.ratio")} active={tab === "ratio"} onClick={() => setTab("ratio")} />
          <SidebarTab label={t("settings.scheduler")} active={tab === "scheduler"} onClick={() => setTab("scheduler")} />
          <SidebarTab label={t("settings.connection")} active={tab === "connection"} onClick={() => setTab("connection")} />
          <SidebarTab label={t("settings.debug")} active={tab === "debug"} onClick={() => setTab("debug")} />
          <SidebarTab label={t("settings.about")} active={tab === "about"} onClick={() => setTab("about")} />
          {required && (
            <div className="mt-auto px-3 text-xs leading-tight" style={{ color: "var(--text-secondary)" }}>
              {t("settings.configureConnection")}
            </div>
          )}
          {!required && onClose && (
            <div className="mt-auto">
              <button
                type="button"
                onClick={onClose}
                className="w-full px-3 py-1.5 rounded text-xs"
                style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)" }}
              >
                {t("common.close")}
              </button>
            </div>
          )}
        </div>

        <div className="flex-1 p-4 overflow-auto min-h-0">
          {tab === "general" && (
            <GeneralTab
              closeToTray={closeToTray}
              onCloseToTrayChange={onCloseToTrayChange}
              startMinimized={startMinimized}
              onStartMinimizedChange={onStartMinimizedChange}
              autostart={autostart}
              onAutostartChange={onAutostartChange}
              pollInterval={pollInterval}
              onPollIntervalChange={onPollIntervalChange}
              confirmRemove={confirmRemove}
              onConfirmRemoveChange={onConfirmRemoveChange}
              checkUpdates={checkUpdates}
              onCheckUpdatesChange={onCheckUpdatesChange}
              notifyComplete={notifyComplete}
              onNotifyCompleteChange={onNotifyCompleteChange}
              notifyRatio={notifyRatio}
              onNotifyRatioChange={onNotifyRatioChange}
              ratioTarget={ratioTarget}
              onRatioTargetChange={onRatioTargetChange}
              showSpeedInTitle={showSpeedInTitle}
              onShowSpeedInTitleChange={onShowSpeedInTitleChange}
              showSearchBar={showSearchBar}
              onShowSearchBarChange={onShowSearchBarChange}
              showSidebar={showSidebar}
              onShowSidebarChange={onShowSidebarChange}
              defaultTrackers={defaultTrackers}
              onDefaultTrackersChange={onDefaultTrackersChange}
              diskProvider={diskProvider}
              onDiskProviderChange={onDiskProviderChange}
              diskQuotaGB={diskQuotaGB}
              onDiskQuotaGBChange={onDiskQuotaGBChange}
              theme={theme}
              onThemeChange={onThemeChange}
            />
          )}
          {tab === "remote" && (
            <RemoteTab isConnected={connected ?? false} />
          )}
          {tab === "ratio" && (
            <RatioTab isConnected={connected ?? false} capabilities={capabilities ?? null} />
          )}
          {tab === "scheduler" && (
            <SchedulerTab />
          )}
          {tab === "connection" && (
            <ConnectionTab
              onConnected={onConnected}
              onDisconnected={onDisconnected ?? (() => {})}
              isConnected={connected ?? false}
              initialProfile={initialProfile}
              initialAddMode={addMode}
            />
          )}
          {tab === "debug" && (
            <DebugTab capabilities={capabilities ?? null} />
          )}
          {tab === "about" && (
            <AboutTab isConnected={connected ?? false} />
          )}
        </div>
    </DialogShell>
  );
}
