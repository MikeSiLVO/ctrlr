import { useState, useRef, useEffect, useCallback, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useClickOutside, useEscapeClose } from "./ui";

/** Close callback of the open list, called when another list opens. */
let activeClose: (() => void) | null = null;

/** Value and label of one Select row. */
export interface SelectOption {
  value: string;
  label: string;
}

/** Props for the themed Select dropdown. */
interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  compact?: boolean;
  /** Shown when the value matches no option, without becoming a pickable row. */
  placeholder?: string;
}

/** Tallest the option list grows before it scrolls, in pixels. */
const MAX_LIST_HEIGHT = 200;

/** Themed replacement for `<select>`, with its list portaled out of any scroll container. */
export function Select({ value, onChange, options, disabled, className, style, compact, placeholder }: SelectProps) {
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(-1);
  const [rect, setRect] = useState<{ left: number; top: number; width: number; up: boolean; fontSize: string } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);

  const close = useCallback(() => {
    setOpen(false);
    setFocusIdx(-1);
  }, []);

  const position = useCallback(() => {
    const btn = containerRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const up = below < MAX_LIST_HEIGHT && r.top > below;
    setRect({
      left: r.left,
      top: up ? r.top - 2 : r.bottom + 2,
      width: r.width,
      up,
      fontSize: window.getComputedStyle(btn).fontSize,
    });
  }, []);

  useLayoutEffect(() => {
    if (open) position();
  }, [open, position]);

  useEscapeClose(close, open);

  useEffect(() => {
    if (!open) return;
    activeClose?.();
    activeClose = close;
    return () => {
      if (activeClose === close) activeClose = null;
    };
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    const onScroll = (e: Event) => {
      const btn = containerRef.current;
      const target = e.target;
      // fixed list is never clipped and would hang over other rows once the anchor leaves its pane
      if (btn && target instanceof Element && !listRef.current?.contains(target)) {
        const b = btn.getBoundingClientRect();
        const c = target.getBoundingClientRect();
        if (b.bottom < c.top || b.top > c.bottom) {
          close();
          return;
        }
      }
      position();
    };
    const onResize = () => position();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, position, close]);

  useClickOutside([containerRef, listRef], close, open);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        setOpen(true);
        setFocusIdx(options.findIndex((o) => o.value === value));
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setFocusIdx((i) => Math.min(i + 1, options.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setFocusIdx((i) => Math.max(i - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (focusIdx >= 0 && focusIdx < options.length) {
          onChange(options[focusIdx].value);
        }
        close();
        break;
    }
  };

  useEffect(() => {
    if (!open || focusIdx < 0 || !listRef.current) return;
    const el = listRef.current.children[focusIdx] as HTMLElement;
    el?.scrollIntoView({ block: "nearest" });
  }, [focusIdx, open]);

  return (
    <div ref={containerRef} className={`relative ${className ?? ""}`} style={style}>
      <button
        type="button"
        onClick={() => !disabled && (open ? close() : setOpen(true))}
        onKeyDown={onKeyDown}
        disabled={disabled}
        className="w-full flex items-center justify-between gap-2 rounded outline-none"
        style={{
          background: "var(--bg-secondary)",
          color: disabled ? "var(--text-secondary)" : "var(--text-primary)",
          border: "1px solid var(--border)",
          padding: compact ? "2px 6px" : "5px 8px",
          fontSize: "inherit",
          cursor: disabled ? "default" : "pointer",
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <span className="truncate text-left">{selected?.label ?? placeholder ?? value}</span>
        <svg width="14" height="8" viewBox="0 0 10 6" fill="none" className="shrink-0" style={{ opacity: 0.7 }}>
          <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && rect && createPortal(
        <div
          ref={listRef}
          className="fixed rounded overflow-auto"
          style={{
            left: rect.left,
            width: rect.width,
            ...(rect.up ? { bottom: window.innerHeight - rect.top } : { top: rect.top }),
            background: "var(--bg-tertiary)",
            border: "1px solid var(--border)",
            boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
            zIndex: 200,
            maxHeight: `${MAX_LIST_HEIGHT}px`,
            fontSize: rect.fontSize,
          }}
          onKeyDown={onKeyDown}
        >
          {options.map((opt, i) => (
            <div
              key={opt.value}
              onClick={() => {
                onChange(opt.value);
                close();
              }}
              onMouseEnter={() => setFocusIdx(i)}
              className="px-2 py-1.5 cursor-pointer truncate"
              style={{
                background: i === focusIdx ? "var(--accent-dim)" : opt.value === value ? "rgba(56,189,248,0.1)" : "transparent",
                color: i === focusIdx ? "white" : "var(--text-primary)",
              }}
            >
              {opt.label}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
