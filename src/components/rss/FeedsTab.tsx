import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api";
import type { RssFeedEntry, RssFeedItem } from "../../types";
import { formatDate } from "../../format";
import { useDialog } from "../AppDialog";
import { Checkbox, INPUT_STYLE, Input, NumInput } from "../ui";
import { SmallButton } from "./SmallButton";

/** Feeds tab: feed list with edit, delete and preview. */
export function FeedsTab() {
  const { t } = useTranslation();
  const dialog = useDialog();
  const [feeds, setFeeds] = useState<RssFeedEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<RssFeedEntry | null>(null);
  const [originalKey, setOriginalKey] = useState<string | null>(null);
  const [preview, setPreview] = useState<RssFeedItem[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api.rssListFeeds().then(setFeeds).catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function handleAdd() {
    const key = `feed-${Date.now()}`;
    const newFeed: RssFeedEntry = {
      key,
      url: "",
      poll_secs: 300,
      enabled: true,
      cookie: "",
    };
    setEditing(newFeed);
    setOriginalKey(null);
    setSelected(key);
    setPreview(null);
  }

  function handleEdit(feed: RssFeedEntry) {
    setEditing({ ...feed });
    setOriginalKey(feed.key);
    setSelected(feed.key);
    setPreview(null);
  }

  async function handleSave() {
    if (!editing) return;
    if (!editing.url.trim()) {
      setError(t("rss.feeds.urlRequired"));
      return;
    }
    try {
      setError(null);
      await api.rssSaveFeed(editing, originalKey ?? undefined);
      refresh();
      setEditing(null);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleDelete(key: string) {
    if (!(await dialog.confirm(t("dialog.deleteFeed")))) return;
    try {
      setError(null);
      await api.rssDeleteFeed(key);
      if (selected === key) {
        setSelected(null);
        setEditing(null);
      }
      refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handlePreview(key: string) {
    try {
      setError(null);
      setPreviewLoading(true);
      const items = await api.rssPreviewFeed(key);
      setPreview(items);
    } catch (e) {
      setError(String(e));
    } finally {
      setPreviewLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex items-center gap-2">
        <span
          className="text-sm font-medium"
          style={{ color: "var(--text-primary)" }}
        >
          {t("rss.feeds")}
        </span>
        <div className="flex-1" />
        <SmallButton label={t("rss.feeds.add")} onClick={handleAdd} />
      </div>

      {error && (
        <div className="text-xs" style={{ color: "var(--danger)" }}>
          {error}
        </div>
      )}

      <div className="flex gap-3 flex-1 min-h-0">
        <div
          className="flex flex-col gap-1 w-[200px] shrink-0 overflow-auto"
          style={{
            borderRight: "1px solid var(--border)",
            paddingRight: "8px",
          }}
        >
          {feeds.map((f) => (
            <div
              key={f.key}
              className="flex items-center gap-1 px-2 py-1.5 rounded cursor-pointer text-xs"
              style={{
                background:
                  selected === f.key ? "var(--bg-tertiary)" : "transparent",
                color: f.enabled
                  ? "var(--text-primary)"
                  : "var(--text-secondary)",
                opacity: f.enabled ? 1 : 0.6,
              }}
              onClick={() => handleEdit(f)}
            >
              <span className="truncate flex-1">{f.key}</span>
            </div>
          ))}
          {feeds.length === 0 && (
            <div
              className="text-xs px-2 py-4 text-center"
              style={{ color: "var(--text-secondary)" }}
            >
              {t("rss.feeds.noFeeds")}
            </div>
          )}
        </div>

        {editing ? (
          <div className="flex-1 flex flex-col gap-3 overflow-auto">
            <Input
              label={t("rss.feeds.name")}
              value={editing.key}
              onChange={(v) => setEditing({ ...editing, key: v })}
              placeholder="my-tracker"
            />
            <Input
              label={t("rss.feeds.url")}
              value={editing.url}
              onChange={(v) => setEditing({ ...editing, url: v })}
              placeholder="https://tracker.example.com/rss?passkey=..."
            />
            <div className="flex gap-3">
              <NumInput
                label={t("rss.feeds.pollSec")}
                value={editing.poll_secs}
                onChange={(v) => setEditing({ ...editing, poll_secs: v || 300 })}
                min={60}
                width="100px"
              />
              <div className="flex flex-col gap-1 flex-1">
                <label
                  className="text-xs"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {t("rss.feeds.cookie")}
                </label>
                <input
                  value={editing.cookie}
                  onChange={(e) =>
                    setEditing({ ...editing, cookie: e.target.value })
                  }
                  className="px-2 py-1.5 rounded text-sm outline-none"
                  style={INPUT_STYLE}
                  placeholder={t("rss.feeds.cookiePlaceholder")}
                />
              </div>
            </div>
            <Checkbox
              checked={editing.enabled}
              onChange={(v) => setEditing({ ...editing, enabled: v })}
              label={t("common.enabled")}
            />
            <div className="flex gap-2 mt-1">
              <SmallButton label={t("common.save")} onClick={handleSave} variant="accent" />
              <SmallButton
                label={t("rss.feeds.preview")}
                onClick={() => originalKey && handlePreview(originalKey)}
                disabled={originalKey === null}
              />
              <div className="flex-1" />
              <SmallButton
                label={t("common.delete")}
                onClick={() => originalKey && handleDelete(originalKey)}
                variant="danger"
                disabled={originalKey === null}
              />
            </div>

            {previewLoading && (
              <div
                className="text-xs"
                style={{ color: "var(--text-secondary)" }}
              >
                {t("common.loading")}
              </div>
            )}
            {preview && (
              <div
                className="flex-1 min-h-0 overflow-auto rounded text-xs"
                style={{
                  border: "1px solid var(--border)",
                  maxHeight: "200px",
                }}
              >
                <table className="w-full">
                  <thead>
                    <tr
                      style={{
                        background: "var(--bg-secondary)",
                        color: "var(--text-secondary)",
                      }}
                    >
                      <th className="text-left px-2 py-1 font-medium">
                        {t("rss.feeds.previewTitle")}
                      </th>
                      <th className="text-left px-2 py-1 font-medium w-[130px]">
                        {t("rss.feeds.published")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((item, i) => (
                      <tr
                        key={i}
                        style={{
                          borderTop: "1px solid var(--border)",
                          color: "var(--text-primary)",
                        }}
                      >
                        <td className="px-2 py-1 truncate max-w-0">
                          {item.title}
                        </td>
                        <td className="px-2 py-1 whitespace-nowrap">
                          {item.published ? formatDate(item.published) : "-"}
                        </td>
                      </tr>
                    ))}
                    {preview.length === 0 && (
                      <tr>
                        <td
                          colSpan={2}
                          className="px-2 py-4 text-center"
                          style={{ color: "var(--text-secondary)" }}
                        >
                          {t("rss.feeds.noItems")}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <div
            className="flex-1 flex items-center justify-center text-xs"
            style={{ color: "var(--text-secondary)" }}
          >
            {t("rss.feeds.selectOrAdd")}
          </div>
        )}
      </div>
    </div>
  );
}
