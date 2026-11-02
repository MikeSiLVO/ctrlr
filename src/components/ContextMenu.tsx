import { useState, useEffect, useRef } from "react";
import { ChevronIcon } from "./icons";
import { useClickOutside, useEscapeClose, useKeepInViewport } from "./ui";

/** Clickable context menu row. */
export interface MenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  separator?: never;
  children?: never;
}

/** Divider line between context menu groups. */
export interface MenuSeparator {
  separator: true;
}

/** Context menu row opening a nested menu on hover. */
export interface SubMenuItem {
  label: string;
  children: MenuEntry[];
  separator?: never;
  onClick?: never;
}

/** Any row a context menu can hold. */
export type MenuEntry = MenuItem | MenuSeparator | SubMenuItem;

/** Whether the entry opens a nested menu. */
function isSubmenu(entry: MenuEntry): entry is SubMenuItem {
  return "children" in entry && Array.isArray(entry.children);
}

/** Props for a context menu opened at a screen point. */
interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuEntry[];
  onClose: () => void;
}

/** Submenu row whose panel opens after a short hover, flipping left near the screen edge. */
function SubMenuPanel({
  entry,
  onClose,
}: {
  entry: SubMenuItem;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [subPos, setSubPos] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  function handleEnter() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (ref.current) {
        const rect = ref.current.getBoundingClientRect();
        const spaceRight = window.innerWidth - rect.right;
        const subWidth = 180;
        const xPos = spaceRight >= subWidth ? rect.right - 2 : rect.left - subWidth + 2;
        const yPos = rect.top;
        setSubPos({ x: xPos, y: yPos });
      }
      setOpen(true);
    }, 120);
  }

  function handleLeave() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setOpen(false), 200);
  }

  return (
    <div
      ref={ref}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      <div
        className="w-full px-3 py-1.5 text-left text-xs hover:bg-[var(--bg-tertiary)] flex items-center justify-between cursor-default"
        style={{ color: "var(--text-primary)" }}
      >
        <span>{entry.label}</span>
        <ChevronIcon direction="right" className="shrink-0" style={{ color: "var(--text-secondary)", marginLeft: "8px" }} />
      </div>
      {open && subPos && (
        <div
          className="fixed z-[101] py-1 rounded shadow-lg min-w-[140px]"
          style={{
            left: subPos.x,
            top: subPos.y,
            background: "var(--bg-secondary)",
            border: "1px solid var(--border)",
          }}
          onMouseEnter={() => {
            if (timerRef.current) clearTimeout(timerRef.current);
          }}
          onMouseLeave={handleLeave}
        >
          <MenuItems items={entry.children} onClose={onClose} />
        </div>
      )}
    </div>
  );
}

/** Rows of one menu level; an enabled item runs its action and closes the whole menu. */
function MenuItems({
  items,
  onClose,
}: {
  items: MenuEntry[];
  onClose: () => void;
}) {
  return (
    <>
      {items.map((item, i) => {
        if ("separator" in item && item.separator) {
          return (
            <div
              key={i}
              className="my-1"
              style={{ height: 1, background: "var(--border)" }}
            />
          );
        }
        if (isSubmenu(item)) {
          return <SubMenuPanel key={i} entry={item} onClose={onClose} />;
        }
        const mi = item as MenuItem;
        return (
          <button
            key={i}
            onClick={() => {
              if (!mi.disabled) {
                mi.onClick();
                onClose();
              }
            }}
            disabled={mi.disabled}
            className="w-full px-3 py-1.5 text-left text-xs hover:bg-[var(--bg-tertiary)] disabled:opacity-40 disabled:cursor-default"
            style={{
              color: mi.danger ? "var(--danger)" : "var(--text-primary)",
            }}
          >
            {mi.label}
          </button>
        );
      })}
    </>
  );
}

/** Context menu at a screen point, closed by outside click or Escape and kept in the viewport. */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEscapeClose(onClose);
  useClickOutside([ref], onClose);
  useKeepInViewport(ref, x, y);

  return (
    <div
      ref={ref}
      className="fixed z-[100] py-1 rounded shadow-lg min-w-[160px]"
      style={{
        left: x,
        top: y,
        background: "var(--bg-secondary)",
        border: "1px solid var(--border)",
      }}
    >
      <MenuItems items={items} onClose={onClose} />
    </div>
  );
}
