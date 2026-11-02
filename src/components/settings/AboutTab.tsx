import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import * as api from "../../api";
import type { UpdateInfo } from "../../types";
import { SectionLabel } from "../ui";

/** Result of the About tab's update check: the release found, or where the check stands. */
type UpdateCheck = { status: "idle" | "checking" | "current" | "failed" } | { status: "available"; update: UpdateInfo };

/** About tab: versions, update check and releases, plus server details when connected. */
export function AboutTab({ isConnected }: { isConnected: boolean }) {
  const { t } = useTranslation();
  const [version, setVersion] = useState<string | null>(null);
  const [tauriVersion, setTauriVersion] = useState<string | null>(null);
  const [updateCheck, setUpdateCheck] = useState<UpdateCheck>({ status: "idle" });
  const [sysInfo, setSysInfo] = useState<{ client_version: string; library_version: string; hostname: string } | null>(null);

  useEffect(() => {
    import("@tauri-apps/api/app").then(async (app) => {
      setVersion(await app.getVersion());
      setTauriVersion(await app.getTauriVersion());
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (isConnected) {
      api.getSystemInfo().then(setSysInfo).catch(() => {});
    }
  }, [isConnected]);

  return (
    <div className="flex flex-col items-center gap-4 py-4">
      <div className="text-center">
        <div className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>Ctrl+R</div>
        <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
          {t("settings.about.description")}
        </div>
      </div>

      <div
        className="w-full rounded p-3 flex flex-col gap-2 text-xs"
        style={{ background: "var(--bg-secondary)" }}
      >
        <div className="flex justify-between">
          <span style={{ color: "var(--text-secondary)" }}>{t("settings.about.version")}</span>
          <span style={{ color: "var(--text-primary)" }}>{version ?? t("settings.about.unknown")}</span>
        </div>
        <div className="flex justify-between">
          <span style={{ color: "var(--text-secondary)" }}>{t("settings.about.tauri")}</span>
          <span style={{ color: "var(--text-primary)" }}>{tauriVersion ?? t("settings.about.unknown")}</span>
        </div>
        <div className="flex justify-between">
          <span style={{ color: "var(--text-secondary)" }}>{t("settings.about.developer")}</span>
          <span style={{ color: "var(--text-primary)" }}>MikeSiLVO</span>
        </div>
      </div>

      {sysInfo && (
        <div
          className="w-full rounded p-3 flex flex-col gap-2 text-xs"
          style={{ background: "var(--bg-secondary)" }}
        >
          <SectionLabel>{t("settings.about.server")}</SectionLabel>
          <div className="flex justify-between">
            <span style={{ color: "var(--text-secondary)" }}>rTorrent</span>
            <span style={{ color: "var(--text-primary)" }}>{sysInfo.client_version}</span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: "var(--text-secondary)" }}>libtorrent</span>
            <span style={{ color: "var(--text-primary)" }}>{sysInfo.library_version}</span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: "var(--text-secondary)" }}>{t("settings.about.hostname")}</span>
            <span style={{ color: "var(--text-primary)" }}>{sysInfo.hostname}</span>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={updateCheck.status === "checking"}
          onClick={() => {
            setUpdateCheck({ status: "checking" });
            api.checkForUpdate()
              .then((u) => setUpdateCheck(u ? { status: "available", update: u } : { status: "current" }))
              .catch(() => setUpdateCheck({ status: "failed" }));
          }}
          className="text-xs px-3 py-1.5 rounded disabled:opacity-50"
          style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)" }}
        >
          {t("settings.about.checkUpdates")}
        </button>
        <button
          type="button"
          onClick={() => openUrl("https://github.com/MikeSiLVO/ctrlr/releases")}
          className="text-xs px-3 py-1.5 rounded"
          style={{ background: "var(--accent-dim)", color: "white" }}
        >
          {t("settings.about.releases")}
        </button>
      </div>

      {updateCheck.status === "available" ? (
        <button
          type="button"
          onClick={() => openUrl(updateCheck.update.url)}
          className="text-xs hover:underline"
          style={{ color: "var(--accent)" }}
        >
          {t("settings.about.updateAvailable", { version: updateCheck.update.version })}
        </button>
      ) : updateCheck.status !== "idle" && (
        <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
          {t(updateCheck.status === "checking" ? "settings.about.checking"
            : updateCheck.status === "current" ? "settings.about.upToDate"
            : "settings.about.checkFailed")}
        </div>
      )}

      <div className="text-[10px] mt-2" style={{ color: "var(--text-secondary)" }}>
        © 2026 MikeSiLVO. All rights reserved.
      </div>
    </div>
  );
}
