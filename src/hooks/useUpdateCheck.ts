import { useCallback, useEffect, useState } from "react";
import * as api from "../api";
import { loadString, savePref } from "../prefs";
import type { UpdateInfo } from "../types";

/** Time between checks while the app runs. */
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Storage key for the version whose notice was dismissed. */
const DISMISSED_KEY = "ctrlr:update-dismissed";

/** Newer release to announce, checked at launch and daily while on, dismissible per version. */
export function useUpdateCheck(enabled: boolean) {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(() => loadString(DISMISSED_KEY, ""));

  useEffect(() => {
    setUpdate(null);
    if (!enabled) return;
    let alive = true;
    const check = () => {
      api.checkForUpdate()
        .then((u) => { if (alive) setUpdate(u); })
        .catch(() => {});
    };

    check();
    const timer = setInterval(check, CHECK_INTERVAL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [enabled]);

  const dismiss = useCallback(() => {
    if (!update) return;
    savePref(DISMISSED_KEY, update.version);
    setDismissed(update.version);
  }, [update]);

  return { update: update?.version === dismissed ? null : update, dismiss };
}
