import { useState, useRef, useCallback } from "react";
import { loadNumber, savePref } from "../prefs";

/** Storage key, default height and clamp range for a resizable panel, in pixels. */
interface UseResizeHandleOptions {
  storageKey: string;
  defaultHeight: number;
  min?: number;
  max?: number;
}

/** Drag handle for a bottom panel's height, clamped and saved to localStorage on release. */
export function useResizeHandle({ storageKey, defaultHeight, min = 100, max = 600 }: UseResizeHandleOptions) {
  const [height, setHeight] = useState(() => loadNumber(storageKey, defaultHeight));
  const [dragging, setDragging] = useState(false);
  const heightRef = useRef(defaultHeight);
  const lineRef = useRef<HTMLDivElement>(null);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = heightRef.current;
    setDragging(true);
    document.body.style.cursor = "ns-resize";
    if (lineRef.current) lineRef.current.style.background = "var(--accent)";

    function onMouseMove(ev: MouseEvent) {
      const h = Math.max(min, Math.min(max, startHeight + startY - ev.clientY));
      heightRef.current = h;
      setHeight(h);
    }
    function onMouseUp() {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      setDragging(false);
      if (lineRef.current) lineRef.current.style.background = "var(--border)";
      savePref(storageKey, heightRef.current);
    }
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [storageKey, min, max]);

  // mousedown closure reads height from here, not from stale state
  heightRef.current = height;

  const onMouseEnter = useCallback(() => {
    if (lineRef.current && !dragging) lineRef.current.style.background = "var(--accent)";
  }, [dragging]);

  const onMouseLeave = useCallback(() => {
    if (lineRef.current && !dragging) lineRef.current.style.background = "var(--border)";
  }, [dragging]);

  return { height, dragging, lineRef, onMouseDown, onMouseEnter, onMouseLeave };
}
