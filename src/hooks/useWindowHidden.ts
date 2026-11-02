import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** Whether the main window is hidden to the tray or minimized. */
export function useWindowHidden(): boolean {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let alive = true;
    const check = () => {
      Promise.all([win.isVisible(), win.isMinimized()])
        .then(([visible, minimized]) => { if (alive) setHidden(!visible || minimized); })
        .catch(() => {});
    };

    check();
    // hiding has no window event of its own; focus loss and resize come with every change
    const unlisten = [win.onFocusChanged(check), win.onResized(check)];
    document.addEventListener("visibilitychange", check);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", check);
      unlisten.forEach((p) => p.then((f) => f()));
    };
  }, []);

  return hidden;
}
