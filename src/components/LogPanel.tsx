import { useState, useEffect, useRef, Fragment } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import * as api from "../api";
import type { LogEntry } from "../types";

/** Panel entry cap, the same as the backend buffer's. */
const MAX_ENTRIES = 500;

/** Activity log panel, live from backend events and pinned to the bottom unless scrolled up. */
export function LogPanel() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  useEffect(() => {
    api.getActivityLog().then(setEntries);
  }, []);

  useEffect(() => {
    const unlisten = listen<LogEntry>("activity-log", (event) => {
      setEntries((prev) => {
        const next = [...prev, event.payload];
        if (next.length > MAX_ENTRIES) next.splice(0, next.length - MAX_ENTRIES);
        return next;
      });
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  useEffect(() => {
    if (autoScrollRef.current && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [entries]);

  function handleScroll() {
    if (!listRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = listRef.current;
    autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 30;
  }

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
    <div className="flex flex-col h-full" style={{ background: "var(--bg-primary)" }}>
      <div
        className="flex items-center justify-between px-3 py-1 shrink-0"
        style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-secondary)" }}
      >
        <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
          {t("log.title")} ({entries.length})
        </span>
        <button
          className="text-xs px-2 py-0.5 rounded"
          style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)" }}
          onClick={() => { api.clearActivityLog(); setEntries([]); }}
        >
          {t("common.clear")}
        </button>
      </div>
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto overflow-x-hidden font-mono"
        style={{ fontSize: "12px" }}
        onScroll={handleScroll}
      >
        {entries.length === 0 ? (
          <div className="px-3 py-4 text-center" style={{ color: "var(--text-secondary)", fontSize: "12px" }}>
            {t("log.noEntries")}
          </div>
        ) : (
          entries.map((entry, i) => (
            <Fragment key={`${entry.timestamp}-${i}`}>
              {(i === 0 || !sameDay(entries[i - 1].timestamp, entry.timestamp)) && (
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
    </div>
  );
}
