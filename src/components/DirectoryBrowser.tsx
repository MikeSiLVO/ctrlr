import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { DialogShell } from "./ui";
import * as api from "../api";

/** Props for the remote directory picker. */
interface DirectoryBrowserProps {
  initialPath?: string;
  onSelect: (path: string) => void;
  onCancel: () => void;
}

/** Remote directory picker with breadcrumbs, opening at the server default when given no path. */
export function DirectoryBrowser({
  initialPath,
  onSelect,
  onCancel,
}: DirectoryBrowserProps) {
  const { t } = useTranslation();
  const [currentPath, setCurrentPath] = useState(initialPath || "");
  const [dirs, setDirs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!initialPath) {
      api.getDefaultDirectory().then((dir) => {
        setCurrentPath(dir || "/");
      }).catch((e) => {
        setError(String(e));
        setLoading(false);
      });
    }
  }, [initialPath]);

  useEffect(() => {
    if (!currentPath) return;
    setLoading(true);
    setError(null);
    api
      .listRemoteDirectory(currentPath)
      .then(setDirs)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [currentPath]);

  function navigateTo(dir: string) {
    const next = currentPath.endsWith("/")
      ? `${currentPath}${dir}`
      : `${currentPath}/${dir}`;
    setCurrentPath(next);
  }

  function navigateUp() {
    const parts = currentPath.replace(/\/+$/, "").split("/");
    if (parts.length <= 1) {
      setCurrentPath("/");
    } else {
      parts.pop();
      setCurrentPath(parts.join("/") || "/");
    }
  }

  const pathParts = currentPath.split("/").filter(Boolean);

  return (
    <DialogShell
      onClose={onCancel}
      zIndex={60}
      panelClassName="rounded-lg p-4 flex flex-col"
      panelStyle={{ width: "500px", maxHeight: "70vh" }}
    >
        <h2 className="text-sm font-semibold mb-2">{t("directory.title")}</h2>

        <div
          className="flex items-center gap-0.5 text-xs px-2 py-1.5 rounded mb-2 overflow-x-auto"
          style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}
        >
          <button
            onClick={() => setCurrentPath("/")}
            className="hover:underline shrink-0"
            style={{ color: "var(--accent)" }}
          >
            /
          </button>
          {pathParts.map((part, i) => (
            <span key={i} className="flex items-center gap-0.5 shrink-0">
              <span style={{ color: "var(--text-secondary)" }}>/</span>
              <button
                onClick={() =>
                  setCurrentPath("/" + pathParts.slice(0, i + 1).join("/"))
                }
                className="hover:underline"
                style={{
                  color:
                    i === pathParts.length - 1
                      ? "var(--text-primary)"
                      : "var(--accent)",
                }}
              >
                {part}
              </button>
            </span>
          ))}
        </div>

        <div
          className="flex-1 overflow-auto min-h-0 rounded"
          style={{
            border: "1px solid var(--border)",
            maxHeight: "350px",
          }}
        >
          {loading ? (
            <div
              className="flex items-center justify-center py-8 text-xs"
              style={{ color: "var(--text-secondary)" }}
            >
              {t("common.loading")}
            </div>
          ) : error ? (
            <div className="px-3 py-2 text-xs" style={{ color: "var(--danger)" }}>
              {error}
            </div>
          ) : (
            <div className="text-xs">
              {currentPath !== "/" && (
                <div
                  onClick={navigateUp}
                  className="flex items-center gap-2 px-3 py-1.5 cursor-pointer"
                  style={{ borderBottom: "1px solid var(--border)" }}
                  onMouseEnter={(e) =>
                    ((e.currentTarget as HTMLElement).style.background =
                      "var(--bg-tertiary)")
                  }
                  onMouseLeave={(e) =>
                    ((e.currentTarget as HTMLElement).style.background = "")
                  }
                >
                  <span style={{ color: "var(--text-secondary)" }}>..</span>
                </div>
              )}

              {dirs.length === 0 && !loading && (
                <div
                  className="px-3 py-4 text-center"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {t("directory.noSubdirs")}
                </div>
              )}

              {dirs.map((dir) => (
                <div
                  key={dir}
                  onClick={() => navigateTo(dir)}
                  className="flex items-center gap-2 px-3 py-1.5 cursor-pointer"
                  style={{ borderBottom: "1px solid var(--border)" }}
                  onMouseEnter={(e) =>
                    ((e.currentTarget as HTMLElement).style.background =
                      "var(--bg-tertiary)")
                  }
                  onMouseLeave={(e) =>
                    ((e.currentTarget as HTMLElement).style.background = "")
                  }
                >
                  <span style={{ color: "var(--accent)" }}>{dir}/</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between mt-3">
          <span
            className="text-xs truncate mr-4"
            style={{ color: "var(--text-secondary)" }}
          >
            {currentPath}
          </span>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={onCancel}
              className="px-3 py-1.5 rounded text-xs"
              style={{
                background: "var(--bg-tertiary)",
                color: "var(--text-primary)",
              }}
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={() => onSelect(currentPath)}
              className="px-3 py-1.5 rounded text-xs font-medium"
              style={{
                background: "var(--accent-dim)",
                color: "white",
              }}
            >
              {t("common.select")}
            </button>
          </div>
        </div>
    </DialogShell>
  );
}
