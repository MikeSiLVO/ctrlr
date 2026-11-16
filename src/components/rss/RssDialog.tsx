import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api";
import { SidebarTab, DialogShell } from "../ui";
import { FeedsTab } from "./FeedsTab";
import { HistoryTab } from "./HistoryTab";
import { RulesTab } from "./RulesTab";

/** Tabs of the RSS dialog. */
type Tab = "feeds" | "rules" | "history";

/** RSS dialog: feeds, rules and history tabs, plus the global auto-download switch. */
export function RssDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("feeds");
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    api.rssIsEnabled().then(setEnabled).catch(() => {});
  }, []);

  async function toggleEnabled() {
    try {
      const next = !enabled;
      await api.rssSetEnabled(next);
      setEnabled(next);
    } catch {
      // checkbox keeps the server's state
    }
  }

  return (
    <DialogShell
      onClose={onClose}
      title={t("rss.title")}
      headerExtra={
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={toggleEnabled}
            className="accent-sky-500"
          />
          <span
            className="text-xs"
            style={{ color: enabled ? "var(--text-primary)" : "var(--text-secondary)" }}
          >
            {t("rss.autoDownload")}
          </span>
        </label>
      }
      bodyClassName="flex"
      size="full"
    >
        <div
          className="flex flex-col gap-1 p-3 shrink-0 w-[130px]"
          style={{ borderRight: "1px solid var(--border)" }}
        >
          <SidebarTab
            label={t("rss.feeds")}
            active={tab === "feeds"}
            onClick={() => setTab("feeds")}
          />
          <SidebarTab
            label={t("rss.rules")}
            active={tab === "rules"}
            onClick={() => setTab("rules")}
          />
          <SidebarTab
            label={t("rss.history")}
            active={tab === "history"}
            onClick={() => setTab("history")}
          />
        </div>

        <div className="flex-1 p-4 overflow-auto min-h-0">
          {tab === "feeds" && <FeedsTab />}
          {tab === "rules" && <RulesTab />}
          {tab === "history" && <HistoryTab />}
        </div>
    </DialogShell>
  );
}
