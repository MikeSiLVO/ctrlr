import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ServerCapabilities } from "../../types";
import { INPUT_STYLE, SectionLabel } from "../ui";

/** Debug tab: detected server capability flags and a filterable, copyable RPC method list. */
export function DebugTab({ capabilities }: { capabilities: ServerCapabilities | null }) {
  const { t } = useTranslation();
  const [filterText, setFilterText] = useState("");

  if (!capabilities) {
    return (
      <div className="text-xs py-4 text-center" style={{ color: "var(--text-secondary)" }}>
        {t("settings.debug.connectFirst")}
      </div>
    );
  }

  const flags = Object.entries(capabilities)
    .filter(([key, val]) => key !== "methods" && typeof val === "boolean")
    .map(([key, val]) => ({ key, enabled: val as boolean }))
    .sort((a, b) => a.key.localeCompare(b.key));

  const methods = capabilities.methods ?? [];
  const filtered = filterText
    ? methods.filter((m) => m.toLowerCase().includes(filterText.toLowerCase()))
    : methods;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <SectionLabel>{t("settings.debug.capabilities")} ({flags.filter((f) => f.enabled).length}/{flags.length})</SectionLabel>
        <div className="flex flex-wrap gap-1">
          {flags.map(({ key, enabled }) => (
            <span
              key={key}
              className="px-1.5 py-0.5 rounded text-[10px] font-mono"
              style={{
                background: enabled ? "var(--accent-dim)" : "var(--bg-tertiary)",
                color: enabled ? "white" : "var(--text-secondary)",
                opacity: enabled ? 1 : 0.5,
              }}
            >
              {key.replace(/^has/, "").replace(/([A-Z])/g, ".$1").toLowerCase().replace(/^\./, "")}
            </span>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <SectionLabel>{t("settings.debug.rpcMethods")} ({methods.length})</SectionLabel>
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(methods.join("\n"))}
            className="px-2 py-0.5 rounded text-[10px]"
            style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
          >
            {t("settings.debug.copyToClipboard")}
          </button>
        </div>
        <input
          type="text"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          placeholder={t("settings.debug.filterMethods")}
          className="px-2 py-1 rounded text-xs outline-none"
          style={INPUT_STYLE}
        />
        <div
          className="overflow-auto rounded text-[10px] font-mono leading-relaxed p-2"
          style={{ background: "var(--bg-secondary)", maxHeight: "200px", color: "var(--text-primary)" }}
        >
          {filtered.length > 0
            ? filtered.map((m) => <div key={m}>{m}</div>)
            : <span style={{ color: "var(--text-secondary)" }}>{t("settings.debug.noMatches")}</span>
          }
        </div>
      </div>
    </div>
  );
}
