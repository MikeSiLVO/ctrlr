import { useState, useEffect } from "react";
import { getTheme, applyTheme, type ThemeId } from "../theme";
import * as api from "../api";
import { loadBool, loadNumber, loadString, savePref } from "../prefs";

/** Preferences from localStorage with setters that persist them; applies the theme on mount. */
export function usePreferences() {
  const [closeToTray, setCloseToTray] = useState(() => loadBool("ctrlr:close-to-tray", false));
  const [startMinimized, setStartMinimized] = useState(() => loadBool("ctrlr:start-minimized", false));
  const [autostart, setAutostart] = useState(() => loadBool("ctrlr:autostart", false));
  const [pollInterval, setPollInterval] = useState(() => loadNumber("ctrlr:poll-interval", 2000));
  const [confirmRemove, setConfirmRemove] = useState(() => loadBool("ctrlr:confirm-remove", true));
  const [checkUpdates, setCheckUpdates] = useState(() => loadBool("ctrlr:check-updates", true));
  const [notifyComplete, setNotifyComplete] = useState(() => loadBool("ctrlr:notify-complete", true));
  const [notifyRatio, setNotifyRatio] = useState(() => loadBool("ctrlr:notify-ratio", false));
  const [ratioTarget, setRatioTarget] = useState(() => loadNumber("ctrlr:ratio-target", 1.0));
  const [showSpeedInTitle, setShowSpeedInTitle] = useState(() => loadBool("ctrlr:speed-in-title", false));
  const [diskProvider, setDiskProvider] = useState(() => loadString("ctrlr:disk-provider", "auto"));
  const [diskQuotaGB, setDiskQuotaGB] = useState(() => loadNumber("ctrlr:disk-quota-gb", 0));
  const [showSearchBar, setShowSearchBar] = useState(() => loadBool("ctrlr:show-search", true));
  const [showSidebar, setShowSidebar] = useState(() => loadBool("ctrlr:show-sidebar", true));
  const [defaultTrackers, setDefaultTrackers] = useState(() => loadString("ctrlr:default-trackers", ""));
  const [theme, setTheme] = useState<ThemeId>(getTheme);

  useEffect(() => { applyTheme(theme); }, []);

  const settingsProps = {
    closeToTray,
    onCloseToTrayChange: (v: boolean) => { setCloseToTray(v); savePref("ctrlr:close-to-tray", v); },
    startMinimized,
    onStartMinimizedChange: (v: boolean) => { setStartMinimized(v); savePref("ctrlr:start-minimized", v); api.setStartMinimized(v); },
    autostart,
    onAutostartChange: (v: boolean) => { setAutostart(v); savePref("ctrlr:autostart", v); api.setAutostart(v); },
    pollInterval,
    onPollIntervalChange: (ms: number) => { setPollInterval(ms); savePref("ctrlr:poll-interval", ms); },
    confirmRemove,
    onConfirmRemoveChange: (v: boolean) => { setConfirmRemove(v); savePref("ctrlr:confirm-remove", v); },
    checkUpdates,
    onCheckUpdatesChange: (v: boolean) => { setCheckUpdates(v); savePref("ctrlr:check-updates", v); },
    notifyComplete,
    onNotifyCompleteChange: (v: boolean) => { setNotifyComplete(v); savePref("ctrlr:notify-complete", v); },
    notifyRatio,
    onNotifyRatioChange: (v: boolean) => { setNotifyRatio(v); savePref("ctrlr:notify-ratio", v); },
    ratioTarget,
    onRatioTargetChange: (v: number) => { setRatioTarget(v); savePref("ctrlr:ratio-target", v); },
    showSpeedInTitle,
    onShowSpeedInTitleChange: (v: boolean) => { setShowSpeedInTitle(v); savePref("ctrlr:speed-in-title", v); },
    showSearchBar,
    onShowSearchBarChange: (v: boolean) => { setShowSearchBar(v); savePref("ctrlr:show-search", v); },
    showSidebar,
    onShowSidebarChange: (v: boolean) => { setShowSidebar(v); savePref("ctrlr:show-sidebar", v); },
    diskProvider,
    onDiskProviderChange: (v: string) => { setDiskProvider(v); savePref("ctrlr:disk-provider", v); },
    diskQuotaGB,
    onDiskQuotaGBChange: (v: number) => { setDiskQuotaGB(v); savePref("ctrlr:disk-quota-gb", v); },
    defaultTrackers,
    onDefaultTrackersChange: (v: string) => { setDefaultTrackers(v); savePref("ctrlr:default-trackers", v); },
    theme,
    onThemeChange: (v: ThemeId) => { setTheme(v); applyTheme(v); },
  };

  return {
    closeToTray,
    pollInterval,
    confirmRemove,
    checkUpdates,
    notifyComplete,
    notifyRatio,
    ratioTarget,
    showSpeedInTitle,
    showSearchBar,
    showSidebar,
    diskProvider,
    diskQuotaGB,
    defaultTrackers,
    theme,
    settingsProps,
  };
}
