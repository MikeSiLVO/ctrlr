import { useTranslation } from "react-i18next";
import type { Torrent, StatusFilter } from "../types";
import { matchesFilter } from "../torrent";

/** Props for the filter sidebar. */
interface SidebarProps {
  filter: StatusFilter;
  labelFilter: string | null;
  throttleFilter: string | null;
  labels: string[];
  throttles: string[];
  torrents: Torrent[];
  collapsed: boolean;
  onFilterChange: (f: StatusFilter) => void;
  onLabelFilter: (label: string | null) => void;
  onThrottleFilter: (throttle: string | null) => void;
  onToggle: () => void;
}

/** Status filters in sidebar order, with their label keys. */
const STATUS_FILTERS: { key: string; value: StatusFilter }[] = [
  { key: "status.all", value: "all" },
  { key: "status.downloading", value: "downloading" },
  { key: "status.seeding", value: "seeding" },
  { key: "status.active", value: "active" },
  { key: "status.stopped", value: "stopped" },
  { key: "status.hashing", value: "hashing" },
];

/** Count the torrents a status filter matches. */
function countByFilter(torrents: Torrent[], f: StatusFilter): number {
  if (f === "all") return torrents.length;
  return torrents.filter((t) => matchesFilter(t, f)).length;
}

/** Collapsible sidebar of status filters with counts, plus label and throttle filters. */
export function Sidebar({
  filter,
  labelFilter,
  throttleFilter,
  labels,
  throttles,
  torrents,
  collapsed,
  onFilterChange,
  onLabelFilter,
  onThrottleFilter,
  onToggle,
}: SidebarProps) {
  const { t } = useTranslation();

  return (
    <div
      className="flex flex-col shrink-0 overflow-hidden"
      style={{
        width: collapsed ? 24 : 170,
        background: "var(--bg-secondary)",
        borderRight: "1px solid var(--border)",
        transition: "width 150ms ease",
      }}
    >
      {collapsed ? (
        <button
          onClick={onToggle}
          className="w-full py-2 text-lg leading-none flex items-center justify-center"
          style={{ color: "var(--text-secondary)" }}
          title={t("sidebar.showSidebar")}
        >
          {"\u00bb"}
        </button>
      ) : (
        <div className="flex justify-end px-2 py-1" style={{ borderBottom: "1px solid var(--border)" }}>
          <button
            onClick={onToggle}
            className="px-2 py-0.5 rounded text-xs font-medium"
            style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)" }}
            title={t("sidebar.hide")}
          >
            {t("sidebar.hide")}
          </button>
        </div>
      )}

      {!collapsed && (
        <div className="flex flex-col overflow-y-auto">
          <div
            className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--text-secondary)" }}
          >
            {t("sidebar.status")}
          </div>
          {STATUS_FILTERS.map(({ key, value }) => {
            const active = labelFilter === null && throttleFilter === null && filter === value;
            const count = countByFilter(torrents, value);
            return (
              <button
                key={value}
                onClick={() => onFilterChange(value)}
                className="flex items-center justify-between px-3 py-1 text-left text-xs"
                style={{
                  background: active ? "var(--bg-tertiary)" : "transparent",
                  color: active ? "var(--accent)" : "var(--text-primary)",
                }}
              >
                <span>{t(key)}</span>
                <span style={{ color: "var(--text-secondary)" }}>{count}</span>
              </button>
            );
          })}

          {labels.length > 0 && (
            <>
              <div
                className="px-3 py-1 mt-3 text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: "var(--text-secondary)" }}
              >
                {t("sidebar.labels")}
              </div>
              {labels.map((label) => {
                const active = labelFilter === label;
                const count = torrents.filter((t) =>
                  t.tags.includes(label),
                ).length;
                return (
                  <button
                    key={label}
                    onClick={() => onLabelFilter(active ? null : label)}
                    className="flex items-center justify-between px-3 py-1 text-left text-xs"
                    style={{
                      background: active ? "var(--bg-tertiary)" : "transparent",
                      color: active ? "var(--accent)" : "var(--text-primary)",
                    }}
                  >
                    <span>{label}</span>
                    <span style={{ color: "var(--text-secondary)" }}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </>
          )}

          {throttles.length > 0 && (
            <>
              <div
                className="px-3 py-1 mt-3 text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: "var(--text-secondary)" }}
              >
                {t("sidebar.throttles")}
              </div>
              {throttles.map((name) => {
                const active = throttleFilter === name;
                const count = torrents.filter((t) =>
                  t.throttle_name === name,
                ).length;
                return (
                  <button
                    key={name}
                    onClick={() => onThrottleFilter(active ? null : name)}
                    className="flex items-center justify-between px-3 py-1 text-left text-xs"
                    style={{
                      background: active ? "var(--bg-tertiary)" : "transparent",
                      color: active ? "var(--accent)" : "var(--text-primary)",
                    }}
                  >
                    <span>{name}</span>
                    <span style={{ color: "var(--text-secondary)" }}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}
