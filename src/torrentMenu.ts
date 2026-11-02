import type { TFunction } from "i18next";
import type { Torrent, ServerCapabilities } from "./types";
import { torrentStatus, isAnyPaused } from "./torrent";
import type { MenuEntry } from "./components/ContextMenu";
import { loadRatioGroupNames } from "./components/settings/RatioTab";
import * as api from "./api";

/** App state and callbacks the torrent context menu reads and calls. */
interface ContextMenuDeps {
  displayed: Torrent[];
  allThrottles: string[];
  allLabels: string[];
  capabilities: ServerCapabilities | null;
  confirmRemove: boolean;
  t: TFunction;
  handleAction: (action: () => Promise<void>) => void;
  dialog: { confirm: (msg: string) => Promise<boolean>; prompt: (msg: string) => Promise<string | null> };
  setMoveHashes: (hashes: string[]) => void;
  setPropsHash: (hash: string) => void;
}

/** Build the torrent context menu for the clicked rows, empty when none are displayed. */
export function buildContextMenuItems(hashes: string[], deps: ContextMenuDeps): MenuEntry[] {
  const { displayed, allThrottles, allLabels, capabilities, confirmRemove, t, handleAction, dialog, setMoveHashes, setPropsHash } = deps;
  const targets = displayed.filter((tor) => hashes.includes(tor.hash));
  if (targets.length === 0) return [];

  const multi = targets.length > 1;
  const anyPaused = isAnyPaused(targets);
  const anyActive = !targets.every((tor) => {
    const s = torrentStatus(tor);
    return s === "status.stopped" || s === "status.paused";
  });

  const items: MenuEntry[] = [];

  if (anyPaused) {
    items.push({
      label: t("context.resume"),
      onClick: () => handleAction(() => api.resumeTorrents(hashes)),
    });
  }
  if (anyActive) {
    items.push({
      label: t("context.pause"),
      onClick: () => handleAction(() => api.pauseTorrents(hashes)),
    });
  }

  items.push(
    { separator: true as const },
    {
      label: t("context.recheck"),
      onClick: () => handleAction(() => api.recheckTorrents(hashes)),
    },
    {
      label: t("context.reannounce"),
      onClick: () => handleAction(() => api.reannounceTorrents(hashes)),
    },
  );

  const currentPriority = !multi ? targets[0].priority : null;
  items.push(
    { separator: true as const },
    {
      label: t("context.priority"),
      children: [
        { label: `${t("priority.off")}${currentPriority === 0 ? " *" : ""}`, onClick: () => handleAction(() => api.setTorrentsPriority(hashes, 0)) },
        { label: `${t("priority.low")}${currentPriority === 1 ? " *" : ""}`, onClick: () => handleAction(() => api.setTorrentsPriority(hashes, 1)) },
        { label: `${t("priority.normal")}${currentPriority === 2 ? " *" : ""}`, onClick: () => handleAction(() => api.setTorrentsPriority(hashes, 2)) },
        { label: `${t("priority.high")}${currentPriority === 3 ? " *" : ""}`, onClick: () => handleAction(() => api.setTorrentsPriority(hashes, 3)) },
      ],
    },
  );

  if (allThrottles.length > 0) {
    const currentThrottle = !multi ? targets[0].throttle_name : null;
    items.push({
      label: t("context.throttle"),
      children: [
        ...allThrottles.map((name) => ({
          label: `${name}${currentThrottle === name ? " *" : ""}`,
          onClick: () => handleAction(() => api.setTorrentsThrottle(hashes, name)),
        })),
        { separator: true as const },
        {
          label: t("common.none") + (currentThrottle === "" ? " *" : ""),
          onClick: () => handleAction(() => api.setTorrentsThrottle(hashes, "")),
        },
      ],
    });
  }

  {
    const currentGroup = !multi ? targets[0].ratio_group : null;
    const ratioTargets = targets.map((tor) => ({ hash: tor.hash, old_group: tor.ratio_group }));
    const ratioNames = loadRatioGroupNames();
    items.push({
      label: t("context.ratioGroup"),
      children: [
        ...Array.from({ length: 8 }, (_, i) => ({
          label: `${ratioNames[i]}${currentGroup === i ? " *" : ""}`,
          onClick: () => handleAction(() => api.setTorrentsRatioGroup(ratioTargets, i)),
        })),
        { separator: true as const },
        {
          label: t("common.none") + (currentGroup === -1 ? " *" : ""),
          onClick: () => handleAction(() => api.setTorrentsRatioGroup(ratioTargets, -1)),
        },
      ],
    });
  }

  const currentLabels = !multi && targets[0].tags.length > 0 ? targets[0].tags : null;
  const labelChildren: MenuEntry[] = [
    {
      label: t("context.newLabel"),
      onClick: async () => {
        const name = await dialog.prompt(t("dialog.enterLabel"));
        if (!name?.trim()) return;
        const tag = name.trim();
        handleAction(async () => {
          await Promise.all(targets.map((tor) => {
            const updated = [...new Set([...tor.tags, tag])];
            return api.setTags(tor.hash, updated);
          }));
        });
      },
    },
    {
      label: t("context.removeLabel"),
      disabled: !targets.some((tor) => tor.tags.length > 0),
      onClick: () => {
        const withTags = targets.filter((tor) => tor.tags.length > 0);
        if (withTags.length === 0) return;
        handleAction(async () => {
          await Promise.all(withTags.map((tor) => api.setTags(tor.hash, [])));
        });
      },
    },
  ];
  if (allLabels.length > 0) {
    labelChildren.push(
      { separator: true as const },
      ...allLabels.map((lbl) => ({
        label: `${lbl}${currentLabels?.includes(lbl) ? " *" : ""}`,
        onClick: () => {
          handleAction(async () => {
            await Promise.all(targets.map((tor) => {
              const updated = [...new Set([...tor.tags, lbl])];
              return api.setTags(tor.hash, updated);
            }));
          });
        },
      })),
    );
  }
  items.push({ label: t("context.labels"), children: labelChildren });

  items.push(
    { separator: true as const },
    {
      label: t("context.copy"),
      children: [
        {
          label: t("context.hash"),
          onClick: () => navigator.clipboard.writeText(targets.map((tor) => tor.hash).join("\n")),
        },
        {
          label: t("context.name"),
          onClick: () => navigator.clipboard.writeText(targets.map((tor) => tor.name).join("\n")),
        },
        {
          label: t("context.magnetLink"),
          onClick: () => {
            const magnets = targets.map((tor) =>
              `magnet:?xt=urn:btih:${tor.hash}&dn=${encodeURIComponent(tor.name)}`
            );
            navigator.clipboard.writeText(magnets.join("\n"));
          },
        },
      ],
    },
    { separator: true as const },
    {
      label: t("context.moveTo"),
      onClick: () => setMoveHashes(hashes),
    },
    {
      label: t("context.getTorrent"),
      disabled: multi || !capabilities?.has_session_path || !capabilities?.has_execute_capture,
      onClick: () => handleAction(async () => {
        const bytes = await api.getTorrentFile(targets[0].hash);
        await api.saveTorrentAs(bytes, targets[0].name);
      }),
    },
    {
      label: t("context.properties"),
      disabled: multi || !capabilities?.has_d_uploads_max,
      onClick: () => setPropsHash(targets[0].hash),
    },
    { separator: true as const },
    {
      label: t("context.remove"),
      danger: true,
      onClick: async () => {
        const msg = multi
          ? t("dialog.removeMultiple", { count: targets.length })
          : t("dialog.removeOne", { name: targets[0].name });
        if (confirmRemove && !(await dialog.confirm(msg))) return;
        handleAction(() => api.removeTorrents(hashes, false));
      },
    },
    {
      label: t("context.removeDeleteData"),
      danger: true,
      onClick: async () => {
        const msg = multi
          ? t("dialog.removeDeleteMultiple", { count: targets.length })
          : t("dialog.removeDeleteOne", { name: targets[0].name });
        if (!(await dialog.confirm(msg))) return;
        handleAction(() => api.removeTorrents(hashes, true));
      },
    },
  );

  return items;
}
