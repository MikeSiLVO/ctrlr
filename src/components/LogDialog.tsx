import { useState, useEffect, Fragment } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import * as api from "../api";
import type { LogEntry } from "../types";
import { DialogShell } from "./ui";

/** Dialog entry cap, the same as the backend buffer's. */
const MAX_ENTRIES = 500;

/** Activity log dialog, newest entry first, live from backend events. */
export function LogDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  // dropped keeps row keys stable as the oldest entries are trimmed
  const [log, setLog] = useState<{ entries: LogEntry[]; dropped: number }>({ entries: [], dropped: 0 });

  useEffect(() => {
    api.getActivityLog().then((entries) => setLog({ entries, dropped: 0 }));
  }, []);

  useEffect(() => {
    const unlisten = listen<LogEntry>("activity-log", (event) => {
      setLog((prev) => {
        const next = [...prev.entries, event.payload];
        const excess = Math.max(0, next.length - MAX_ENTRIES);
        return { entries: next.slice(excess), dropped: prev.dropped + excess };
      });
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  const entries = log.entries;
  const newestFirst = entries.map((entry, i) => ({ entry, key: log.dropped + i })).reverse();

  function formatTime(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function sameDay(a: number, b: number): boolean {
    return new Date(a).toDateString() === new Date(b).toDateString();
  }

  function formatDay(ts: number): string {
    const day = new Date(ts).toDateString();
    const now = new Date();
    if (day === now.toDateString()) return t("log.today");
    now.setDate(now.getDate() - 1);
    if (day === now.toDateString()) return t("log.yesterday");
    return new Date(ts).toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" });
  }

  const levelColor = (level: string) => {
    switch (level) {
      case "warn": return "var(--warning, #e5a00d)";
      case "error": return "var(--danger)";
      default: return "var(--text-secondary)";
    }
  };

  const categoryColor = (cat: string) => {
    switch (cat) {
      case "connection": return "#5b9bd5";
      case "torrent": return "#70c070";
      case "action": return "#c0a060";
      case "settings": return "#a080c0";
      default: return "var(--text-secondary)";
    }
  };

  return (
    <DialogShell
      onClose={onClose}
      title={`${t("log.title")} (${entries.length})`}
      headerExtra={
        <button
          type="button"
          className="px-2 py-1 rounded text-xs"
          style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)" }}
          onClick={() => { api.clearActivityLog(); setLog({ entries: [], dropped: 0 }); }}
        >
          {t("common.clear")}
        </button>
      }
      size="full"
    >
      <div
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden font-mono"
        style={{ fontSize: "12px" }}
      >
        {entries.length === 0 ? (
          <div className="px-3 py-4 text-center" style={{ color: "var(--text-secondary)", fontSize: "12px" }}>
            {t("log.noEntries")}
          </div>
        ) : (
          newestFirst.map(({ entry, key }, i) => (
            <Fragment key={key}>
              {(i === 0 || !sameDay(newestFirst[i - 1].entry.timestamp, entry.timestamp)) && (
                <div
                  className="sticky top-0 px-3 font-sans font-medium"
                  style={{
                    background: "var(--bg-secondary)",
                    borderBottom: "1px solid var(--border)",
                    color: "var(--text-secondary)",
                    fontSize: "11px",
                    lineHeight: "20px",
                  }}
                >
                  {formatDay(entry.timestamp)}
                </div>
              )}
              <div
                className="flex items-baseline gap-2 px-3 hover:bg-[var(--bg-secondary)]"
                style={{ lineHeight: "22px" }}
              >
                <span style={{ color: "var(--text-secondary)", minWidth: "70px" }}>
                  {formatTime(entry.timestamp)}
                </span>
                <span
                  className="uppercase font-semibold"
                  style={{
                    color: levelColor(entry.level),
                    minWidth: "38px",
                    fontSize: "10px",
                  }}
                >
                  {entry.level}
                </span>
                <span
                  style={{
                    color: categoryColor(entry.category),
                    minWidth: "80px",
                    fontSize: "11px",
                  }}
                >
                  {entry.category}
                </span>
                <span style={{ color: "var(--text-primary)" }}>
                  {entry.message}
                </span>
              </div>
            </Fragment>
          ))
        )}
      </div>
    </DialogShell>
  );
}
