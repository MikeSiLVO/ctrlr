import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api";
import type { RssFeedEntry, RssRuleEntry, RssMatchResult } from "../../types";
import { formatEpisode } from "../../format";
import { useDialog } from "../AppDialog";
import { Select } from "../Select";
import { Checkbox, INPUT_STYLE, Input } from "../ui";
import { SmallButton } from "./SmallButton";

/** Rules tab: download rules with edit, delete and a test run against a feed. */
export function RulesTab() {
  const { t } = useTranslation();
  const dialog = useDialog();
  const [rules, setRules] = useState<RssRuleEntry[]>([]);
  const [feeds, setFeeds] = useState<RssFeedEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<RssRuleEntry | null>(null);
  // the quality list re-joined on each keystroke would eat a comma as it is typed
  const [qualityText, setQualityText] = useState("");
  const [testResults, setTestResults] = useState<RssMatchResult[] | null>(null);
  const [testFeed, setTestFeed] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api.rssListRules().then(setRules).catch((e) => setError(String(e)));
    api.rssListFeeds().then(setFeeds).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function handleAdd() {
    const key = `rule-${Date.now()}`;
    const newRule: RssRuleEntry = {
      key,
      name: "",
      pattern: "",
      exclude: "",
      feeds: [],
      directory: "",
      label: "",
      throttle: "",
      smart_episode: false,
      quality: [],
      start_season: 1,
      start_episode: 1,
      enabled: true,
    };
    setEditing(newRule);
    setQualityText("");
    setSelected(key);
    setTestResults(null);
  }

  function handleEdit(rule: RssRuleEntry) {
    setEditing({ ...rule });
    setQualityText(rule.quality.join(", "));
    setSelected(rule.key);
    setTestResults(null);
  }

  async function handleSave() {
    if (!editing) return;
    if (!editing.pattern.trim()) {
      setError(t("rss.rules.patternRequired"));
      return;
    }
    if (!editing.name.trim()) {
      setError(t("rss.rules.nameRequired"));
      return;
    }
    try {
      setError(null);
      await api.rssSaveRule(editing);
      refresh();
      setEditing(null);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleDelete(key: string) {
    if (!(await dialog.confirm(t("dialog.deleteRule")))) return;
    try {
      setError(null);
      await api.rssDeleteRule(key);
      if (selected === key) {
        setSelected(null);
        setEditing(null);
      }
      refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleTest() {
    if (!editing || !testFeed) return;
    try {
      setError(null);
      const results = await api.rssTestRule(editing, testFeed);
      setTestResults(results);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex items-center gap-2">
        <span
          className="text-sm font-medium"
          style={{ color: "var(--text-primary)" }}
        >
          {t("rss.rules")}
        </span>
        <div className="flex-1" />
        <SmallButton label={t("rss.rules.add")} onClick={handleAdd} />
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
          {rules.map((r) => (
            <div
              key={r.key}
              className="flex items-center gap-1 px-2 py-1.5 rounded cursor-pointer text-xs"
              style={{
                background:
                  selected === r.key ? "var(--bg-tertiary)" : "transparent",
                color: r.enabled
                  ? "var(--text-primary)"
                  : "var(--text-secondary)",
                opacity: r.enabled ? 1 : 0.6,
              }}
              onClick={() => handleEdit(r)}
            >
              <span className="truncate flex-1">
                {r.name || r.key}
                {r.smart_episode && (
                  <span style={{ color: "var(--accent)", marginLeft: 4 }}>
                    SE
                  </span>
                )}
              </span>
            </div>
          ))}
          {rules.length === 0 && (
            <div
              className="text-xs px-2 py-4 text-center"
              style={{ color: "var(--text-secondary)" }}
            >
              {t("rss.rules.noRules")}
            </div>
          )}
        </div>

        {editing ? (
          <div className="flex-1 flex flex-col gap-2 overflow-auto">
            <Input
              label={t("rss.rules.name")}
              value={editing.name}
              onChange={(v) => setEditing({ ...editing, name: v })}
              placeholder="Breaking Bad"
            />
            <div className="flex gap-3">
              <div className="flex flex-col gap-1 flex-1">
                <label
                  className="text-xs"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {t("rss.rules.pattern")}{" "}
                  <span style={{ opacity: 0.5 }}>({t("rss.rules.patternHint")})</span>
                </label>
                <input
                  value={editing.pattern}
                  onChange={(e) =>
                    setEditing({ ...editing, pattern: e.target.value })
                  }
                  className="px-2 py-1.5 rounded text-sm outline-none font-mono"
                  style={INPUT_STYLE}
                  placeholder="breaking.bad"
                />
              </div>
              <div className="flex flex-col gap-1 flex-1">
                <label
                  className="text-xs"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {t("rss.rules.exclude")}
                </label>
                <input
                  value={editing.exclude}
                  onChange={(e) =>
                    setEditing({ ...editing, exclude: e.target.value })
                  }
                  className="px-2 py-1.5 rounded text-sm outline-none font-mono"
                  style={INPUT_STYLE}
                  placeholder="spanish|dubbed"
                />
              </div>
            </div>
            <div className="flex gap-3">
              <div className="flex flex-col gap-1 flex-1">
                <label
                  className="text-xs"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {t("rss.rules.directory")}
                </label>
                <input
                  value={editing.directory}
                  onChange={(e) =>
                    setEditing({ ...editing, directory: e.target.value })
                  }
                  className="px-2 py-1.5 rounded text-sm outline-none"
                  style={INPUT_STYLE}
                  placeholder="/data/tv/show-name"
                />
              </div>
              <Input
                label={t("rss.rules.label")}
                value={editing.label}
                onChange={(v) => setEditing({ ...editing, label: v })}
                placeholder="tv"
                width="120px"
              />
              <Input
                label={t("rss.rules.throttle")}
                value={editing.throttle}
                onChange={(v) => setEditing({ ...editing, throttle: v })}
                placeholder="slow"
                width="120px"
              />
            </div>

            <label className="flex items-center gap-2 cursor-pointer mt-1">
              <input
                type="checkbox"
                checked={editing.smart_episode}
                onChange={(e) =>
                  setEditing({ ...editing, smart_episode: e.target.checked })
                }
                className="accent-sky-500"
              />
              <span
                className="text-xs"
                style={{ color: "var(--text-primary)" }}
              >
                {t("rss.rules.smartEpisode")}
              </span>
            </label>

            {editing.smart_episode && (
              <div className="flex gap-3 pl-5">
                <Input
                  label={t("rss.rules.qualityPrefs")}
                  value={qualityText}
                  onChange={(v) => {
                    setQualityText(v);
                    setEditing({
                      ...editing,
                      quality: v.split(",").map((s) => s.trim()).filter(Boolean),
                    });
                  }}
                  placeholder="1080p, 720p"
                  width="140px"
                />
                <div
                  className="flex flex-col gap-1"
                  style={{ width: "80px" }}
                >
                  <label
                    className="text-xs"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {t("rss.rules.startS")}
                  </label>
                  <input
                    type="number"
                    value={editing.start_season}
                    min={0}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        start_season: Number(e.target.value) || 0,
                      })
                    }
                    className="px-2 py-1.5 rounded text-sm outline-none"
                    style={INPUT_STYLE}
                  />
                </div>
                <div
                  className="flex flex-col gap-1"
                  style={{ width: "80px" }}
                >
                  <label
                    className="text-xs"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {t("rss.rules.startE")}
                  </label>
                  <input
                    type="number"
                    value={editing.start_episode}
                    min={0}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        start_episode: Number(e.target.value) || 0,
                      })
                    }
                    className="px-2 py-1.5 rounded text-sm outline-none"
                    style={INPUT_STYLE}
                  />
                </div>
              </div>
            )}

            <Checkbox
              checked={editing.enabled}
              onChange={(v) => setEditing({ ...editing, enabled: v })}
              label={t("common.enabled")}
            />

            <div className="flex gap-2 mt-1 items-end">
              <SmallButton label={t("common.save")} onClick={handleSave} variant="accent" />
              <div className="flex flex-col gap-1" style={{ width: "130px" }}>
                <label
                  className="text-xs"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {t("rss.rules.testAgainst")}
                </label>
                <Select
                  value={testFeed}
                  onChange={setTestFeed}
                  options={[
                    { value: "", label: t("rss.rules.selectFeed") },
                    ...feeds.map((f) => ({ value: f.key, label: f.key })),
                  ]}
                  className="text-xs"
                />
              </div>
              <SmallButton
                label={t("rss.rules.test")}
                onClick={handleTest}
                disabled={!testFeed || !editing.pattern}
              />
              <div className="flex-1" />
              <SmallButton
                label={t("common.delete")}
                onClick={() => handleDelete(editing.key)}
                variant="danger"
                disabled={!rules.some((r) => r.key === editing.key)}
              />
            </div>

            {testResults && (
              <div
                className="flex-1 min-h-0 overflow-auto rounded text-xs mt-1"
                style={{
                  border: "1px solid var(--border)",
                  maxHeight: "160px",
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
                        {t("rss.rules.testTitle")}
                      </th>
                      <th className="text-left px-2 py-1 font-medium w-[60px]">
                        {t("rss.rules.ep")}
                      </th>
                      <th className="text-left px-2 py-1 font-medium w-[80px]">
                        {t("rss.rules.statusCol")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {testResults.map((r, i) => (
                      <tr
                        key={i}
                        style={{
                          borderTop: "1px solid var(--border)",
                          color: r.skipped
                            ? "var(--text-secondary)"
                            : "var(--text-primary)",
                          opacity: r.skipped ? 0.6 : 1,
                        }}
                      >
                        <td className="px-2 py-1 truncate max-w-0">
                          {r.title}
                        </td>
                        <td className="px-2 py-1 whitespace-nowrap">
                          {r.episode_info
                            ? formatEpisode(r.episode_info.season, r.episode_info.episode)
                            : "-"}
                        </td>
                        <td className="px-2 py-1 whitespace-nowrap">
                          {r.skipped ? (
                            <span style={{ color: "var(--text-secondary)" }}>
                              {r.skip_reason ?? t("rss.rules.skip")}
                            </span>
                          ) : (
                            <span style={{ color: "var(--accent)" }}>
                              {t("rss.rules.match")}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {testResults.length === 0 && (
                      <tr>
                        <td
                          colSpan={3}
                          className="px-2 py-4 text-center"
                          style={{ color: "var(--text-secondary)" }}
                        >
                          {t("rss.rules.noMatches")}
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
            {t("rss.rules.selectOrAdd")}
          </div>
        )}
      </div>
    </div>
  );
}
