import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Torrent, TorrentPeer, ServerCapabilities } from "../../types";
import { formatSize, formatRate } from "../../format";
import * as api from "../../api";
import { ContextMenu } from "../ContextMenu";

/** Peers tab: connected peers, with disconnect and ban where the server supports them. */
export function PeersTab({ peers, torrent, loading, capabilities }: { peers: TorrentPeer[]; torrent: Torrent; loading: boolean; capabilities: ServerCapabilities | null }) {
  const { t } = useTranslation();
  const [ctxPeer, setCtxPeer] = useState<{ x: number; y: number; peer: TorrentPeer } | null>(null);

  if (peers.length === 0) {
    return (
      <div style={{ color: "var(--text-secondary)" }}>
        {loading ? t("detail.peers.loading") : t("detail.peers.noPeers")}
      </div>
    );
  }

  function handleContextMenu(e: React.MouseEvent, peer: TorrentPeer) {
    e.preventDefault();
    if (!capabilities?.has_peer_disconnect && !capabilities?.has_peer_banned) return;
    setCtxPeer({ x: e.clientX, y: e.clientY, peer });
  }

  async function handleDisconnectPeer(peer: TorrentPeer) {
    try { await api.disconnectPeer(torrent.hash, peer.id_html); } catch { /* next poll */ }
  }

  async function handleBanPeer(peer: TorrentPeer) {
    try { await api.banPeer(torrent.hash, peer.id_html); } catch { /* next poll */ }
  }

  async function handleDisconnectSeeders() {
    try { await api.disconnectSeeders(torrent.hash); } catch { /* next poll */ }
  }

  return (
    <div className="flex flex-col gap-2">
      {capabilities?.has_disconnect_seeders && (
        <div className="flex gap-2">
          <button
            onClick={handleDisconnectSeeders}
            className="px-2 py-0.5 rounded text-xs"
            style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
          >
            {t("detail.peers.disconnectSeeders")}
          </button>
        </div>
      )}
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {[
              { key: "address", label: t("detail.peers.address") },
              { key: "client", label: t("detail.peers.client") },
              { key: "done", label: t("detail.peers.done") },
              { key: "down", label: t("detail.peers.down") },
              { key: "up", label: t("detail.peers.up") },
              { key: "uploaded", label: t("detail.peers.uploaded") },
              { key: "flags", label: t("detail.peers.flags") },
            ].map((h) => (
              <th
                key={h.key}
                className="text-left px-1 py-0.5"
                style={{ color: "var(--text-secondary)" }}
              >
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {peers.map((p) => {
            let flags = "";
            if (p.is_encrypted) flags += "E";
            if (p.is_incoming) flags += "I";
            if (p.is_obfuscated) flags += "O";
            if (p.is_snubbed) flags += "S";
            return (
              <tr key={p.address} onContextMenu={(e) => handleContextMenu(e, p)}>
                <td className="px-1 py-0.5">{p.address}</td>
                <td className="px-1 py-0.5 truncate max-w-[150px]">{p.client_version}</td>
                <td className="px-1 py-0.5">{p.completed_percent}%</td>
                <td className="px-1 py-0.5 whitespace-nowrap">{formatRate(p.down_rate)}</td>
                <td className="px-1 py-0.5 whitespace-nowrap">{formatRate(p.up_rate)}</td>
                <td className="px-1 py-0.5 whitespace-nowrap">{formatSize(p.up_total)}</td>
                <td className="px-1 py-0.5">{flags}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {ctxPeer && (
        <ContextMenu
          x={ctxPeer.x}
          y={ctxPeer.y}
          items={[
            ...(capabilities?.has_peer_disconnect
              ? [{ label: t("detail.peers.disconnect"), onClick: () => handleDisconnectPeer(ctxPeer.peer) }]
              : []),
            ...(capabilities?.has_peer_banned
              ? [{ label: t("detail.peers.ban"), danger: true, onClick: () => handleBanPeer(ctxPeer.peer) }]
              : []),
          ]}
          onClose={() => setCtxPeer(null)}
        />
      )}
    </div>
  );
}
