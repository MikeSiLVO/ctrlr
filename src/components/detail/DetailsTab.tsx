import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { Torrent, TorrentDetails } from "../../types";
import { formatDate } from "../../format";
import * as api from "../../api";
import { InfoRow } from "./InfoRow";

/** Details tab: hash, directory, dates and metadata, with the added date editable on the server. */
export function DetailsTab({ torrent: tor, details }: { torrent: Torrent; details: TorrentDetails | null }) {
  const { t } = useTranslation();
  const [editingAdded, setEditingAdded] = useState(false);
  const escapedRef = useRef(false);
  const createdDate = formatDate(tor.date_created);
  const finishedDate = formatDate(tor.date_finished);
  const loadedDate = details?.load_date ? formatDate(details.load_date) : null;

  function toLocalDatetime(epoch: number): string {
    if (!epoch) return "";
    const d = new Date(epoch * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  async function handleDateSave(value: string) {
    setEditingAdded(false);
    if (!value) return;
    const epoch = Math.floor(new Date(value).getTime() / 1000);
    if (epoch > 0) {
      await api.setDateAdded(tor.hash, epoch).catch(() => {});
    }
  }

  return (
    <div>
      <InfoRow label={t("detail.details.hash")} value={tor.hash} />
      <InfoRow label={t("detail.details.directory")} value={tor.directory} />
      <div className="flex py-0.5">
        <span className="w-24 shrink-0" style={{ color: "var(--text-secondary)" }}>{t("detail.details.added")}</span>
        {editingAdded ? (
          <input
            type="datetime-local"
            autoFocus
            defaultValue={toLocalDatetime(tor.date_added)}
            onBlur={(e) => { if (!escapedRef.current) handleDateSave(e.target.value); escapedRef.current = false; }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") { escapedRef.current = true; setEditingAdded(false); }
            }}
            className="text-xs px-1 rounded"
            style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--accent)" }}
          />
        ) : (
          <span
            className="cursor-pointer hover:underline"
            style={{ color: "var(--accent)" }}
            onClick={() => setEditingAdded(true)}
            title={t("detail.details.clickToEdit")}
          >
            {formatDate(tor.date_added)}
          </span>
        )}
      </div>
      {loadedDate && <InfoRow label={t("detail.details.loaded")} value={loadedDate} />}
      <InfoRow label={t("detail.details.created")} value={createdDate} />
      <InfoRow label={t("detail.details.finished")} value={finishedDate} />
      {details && <InfoRow label={t("detail.details.private")} value={details.is_private ? t("common.yes", "Yes") : t("common.no", "No")} />}
      {tor.tags.length > 0 && (
        <InfoRow label={t("detail.details.tags")} value={tor.tags.join(", ")} />
      )}
      {tor.message && <InfoRow label={t("detail.details.message")} value={tor.message} />}
      {tor.comment && <InfoRow label={t("detail.details.comment")} value={tor.comment} />}
    </div>
  );
}
