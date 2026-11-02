import { useState, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { ProfileInfo } from "../api";
import { useClickOutside, useEscapeClose } from "./ui";

/** Props for the toolbar connection switcher. */
interface ConnectionPopoverProps {
  activeProfile: string | null;
  profiles: ProfileInfo[];
  isConnected: boolean;
  onSwitch: (name: string) => void;
  onDisconnect: () => void;
  onEdit: (name: string) => void;
  onAdd: () => void;
}

/** Toolbar button showing the active profile, opening a menu to switch, edit, add or disconnect. */
export function ConnectionPopover({
  activeProfile,
  profiles,
  isConnected,
  onSwitch,
  onDisconnect,
  onEdit,
  onAdd,
}: ConnectionPopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);
  useClickOutside([ref], close, open);
  useEscapeClose(close, open);

  const connLabel = profiles.find((p) => p.name === activeProfile)?.conn_type;
  const buttonText = activeProfile
    ? `${activeProfile}${connLabel ? ` (${connLabel})` : ""}`
    : t("connection.notConnected");

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-colors"
        style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)" }}
      >
        <span
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ background: isConnected ? "var(--success, #4ade80)" : "var(--text-secondary)" }}
        />
        {buttonText}
        <span style={{ color: "var(--text-secondary)", fontSize: "10px", marginLeft: "2px" }}>
          {open ? "\u25B4" : "\u25BE"}
        </span>
      </button>

      {open && (
        <div
          className="absolute right-0 mt-1 rounded-lg py-1 z-50"
          style={{
            background: "var(--bg-primary)",
            border: "1px solid var(--border)",
            minWidth: "220px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
          }}
        >
          {profiles.map((p) => {
            const isActive = p.name === activeProfile && isConnected;
            return (
              <div
                key={p.name}
                className="flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer"
                style={{
                  color: "var(--text-primary)",
                  background: isActive ? "var(--bg-tertiary)" : "transparent",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-tertiary)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = isActive ? "var(--bg-tertiary)" : "transparent")}
                onClick={() => {
                  if (!isActive) {
                    onSwitch(p.name);
                    close();
                  }
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: isActive ? "var(--success, #4ade80)" : "transparent" }}
                />
                <span className="flex-1 truncate">{p.name}</span>
                <span style={{ color: "var(--text-secondary)" }}>{p.conn_type}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(p.name);
                    close();
                  }}
                  className="ml-1 px-1 rounded hover:bg-[var(--bg-secondary)]"
                  style={{ color: "var(--text-secondary)" }}
                  title={t("connection.editProfile")}
                >
                  ✎
                </button>
              </div>
            );
          })}

          <div
            className="mx-2 my-1"
            style={{ height: "1px", background: "var(--border)" }}
          />

          {isConnected && (
            <button
              className="w-full text-left px-3 py-1.5 text-xs"
              style={{ color: "var(--danger)" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-tertiary)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              onClick={() => { onDisconnect(); close(); }}
            >
              {t("connection.disconnect")}
            </button>
          )}

          <button
            className="w-full text-left px-3 py-1.5 text-xs"
            style={{ color: "var(--text-primary)" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-tertiary)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            onClick={() => { onAdd(); close(); }}
          >
            {t("connection.addProfile")}
          </button>
        </div>
      )}
    </div>
  );
}
