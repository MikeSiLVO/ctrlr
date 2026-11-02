import React, { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

/** Overlay stack and small pieces shared by the dialogs and menus. */

/** Every open overlay, innermost last. */
const overlays: object[] = [];

/** True while any overlay is open, the cue for global shortcuts to stand down. */
export function overlayOpen() {
  return overlays.length > 0;
}

/** Register as the innermost overlay while shown; Escape closes only the topmost, when allowed. */
export function useEscapeClose(onClose: () => void, present = true, closeOnEscape = true) {
  const token = useRef({});
  const latest = useRef(onClose);
  useEffect(() => {
    latest.current = onClose;
  });

  useEffect(() => {
    if (!present) return;
    const self = token.current;
    overlays.push(self);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || overlays[overlays.length - 1] !== self) return;
      if (!closeOnEscape) return;
      e.preventDefault();
      latest.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const i = overlays.lastIndexOf(self);
      if (i >= 0) overlays.splice(i, 1);
    };
  }, [present, closeOnEscape]);
}

/** Close on a mousedown outside all the given elements, while shown. */
export function useClickOutside(
  inside: React.RefObject<HTMLElement | null>[], onClose: () => void, present = true,
) {
  const latest = useRef({ inside, onClose });
  useEffect(() => {
    latest.current = { inside, onClose };
  });

  useEffect(() => {
    if (!present) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (latest.current.inside.some((r) => r.current?.contains(target))) return;
      latest.current.onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [present]);
}

/** Keep a panel opened at a point in the window, flipping it left or up where it would overflow. */
export function useKeepInViewport(ref: React.RefObject<HTMLElement | null>, x: number, y: number) {
  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    if (rect.right > window.innerWidth) ref.current.style.left = `${Math.max(0, x - rect.width)}px`;
    if (rect.bottom > window.innerHeight) ref.current.style.top = `${Math.max(0, y - rect.height)}px`;
  }, [ref, x, y]);
}

/** Themed text input colors; inputs are otherwise plain elements. */
export const INPUT_STYLE = {
  background: "var(--bg-secondary)",
  border: "1px solid var(--border)",
  color: "var(--text-primary)",
};

/** Left-hand nav entry used by the settings and RSS dialogs. */
export function SidebarTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-3 py-2 text-xs font-medium text-left rounded"
      style={{
        color: active ? "var(--text-primary)" : "var(--text-secondary)",
        background: active ? "var(--bg-tertiary)" : "transparent",
      }}
    >
      {label}
    </button>
  );
}

/** Centered dialog panel on a backdrop; Escape or backdrop click closes it, when allowed. */
export function DialogShell({
  onClose,
  dismissible = true,
  zIndex = 50,
  backdropOpacity = 0.7,
  panelStyle,
  panelClassName = "rounded-lg flex flex-col",
  children,
}: {
  onClose: () => void;
  dismissible?: boolean;
  zIndex?: number;
  backdropOpacity?: number;
  panelStyle: React.CSSProperties;
  panelClassName?: string;
  children: React.ReactNode;
}) {
  useEscapeClose(onClose, true, dismissible);

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: `rgba(0,0,0,${backdropOpacity})`, zIndex }}
      onClick={dismissible ? onClose : undefined}
    >
      <div
        className={panelClassName}
        style={{
          background: "var(--bg-primary)",
          border: "1px solid var(--border)",
          ...panelStyle,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

/** Muted heading over a group of settings. */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
      {children}
    </span>
  );
}

/** Labeled settings checkbox. */
export function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-sky-500"
      />
      <span className="text-xs" style={{ color: "var(--text-primary)" }}>{label}</span>
    </label>
  );
}

/** Labeled settings text input. */
export function Input({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  width,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  width?: string;
}) {
  return (
    <div className="flex flex-col gap-1" style={width ? { width } : undefined}>
      <label className="text-xs" style={{ color: "var(--text-secondary)" }}>
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="px-2 py-1.5 rounded text-sm outline-none"
        style={INPUT_STYLE}
      />
    </div>
  );
}

/** Labeled settings number input; empty or invalid input reads as 0. */
export function NumInput({
  label,
  value,
  onChange,
  width = "80px",
  min,
  max,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  width?: string;
  min?: number;
  max?: number;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1" style={{ width }}>
      <label className="text-xs whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
        {label}{hint && <span style={{ opacity: 0.5 }}> ({hint})</span>}
      </label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="px-2 py-1.5 rounded text-sm outline-none"
        style={INPUT_STYLE}
      />
    </div>
  );
}

/** Muted centered note standing in for a settings tab, such as loading or connect first. */
export function TabNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs py-4 text-center" style={{ color: "var(--text-secondary)" }}>
      {children}
    </div>
  );
}

/** Red note standing in for a settings tab whose data failed to load. */
export function TabError({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs py-4" style={{ color: "var(--danger)" }}>
      {children}
    </div>
  );
}

/** Footer of a settings tab: any error, then the save button with its saved note. */
export function SaveFooter({ error, saved, saving, onSave }: {
  error: string | null;
  saved: boolean;
  saving: boolean;
  onSave: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {error && (
        <div className="text-xs" style={{ color: "var(--danger)" }}>{error}</div>
      )}

      <div className="flex justify-end items-center gap-2">
        {saved && (
          <span className="text-xs" style={{ color: "var(--success)" }}>{t("common.saved")}</span>
        )}
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="px-4 py-1.5 rounded text-xs font-medium disabled:opacity-40"
          style={{ background: "var(--accent-dim)", color: "white" }}
        >
          {saving ? t("common.saving") : t("common.save")}
        </button>
      </div>
    </>
  );
}
