import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { Torrent } from "../../types";
import { formatSize } from "../../format";

/** Speed graph sample: rates in bytes per second, time in epoch milliseconds. */
export type SpeedPoint = { dl: number; ul: number; ts: number };

/** Chart ceiling: the value rounded up to 1, 2, 5 or 10 times a power of ten. */
function niceMax(value: number): number {
  if (value <= 0) return 1024;
  const exp = Math.floor(Math.log10(value));
  const base = Math.pow(10, exp);
  const m = value / base;
  if (m <= 1) return base;
  if (m <= 2) return 2 * base;
  if (m <= 5) return 5 * base;
  return 10 * base;
}

/** Draw the speed chart over a two-minute window, or a placeholder until two samples exist. */
function drawChart(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  points: SpeedPoint[],
  labels: { collecting: string; download: string; upload: string; now: string },
) {
  const padL = 55, padR = 10, padT = 20, padB = 20;
  const cw = w - padL - padR;
  const ch = h - padT - padB;

  ctx.clearRect(0, 0, w, h);

  if (points.length < 2) {
    ctx.fillStyle = "#94a3b8";
    ctx.font = "11px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(labels.collecting, w / 2, h / 2);
    return;
  }

  const now = points[points.length - 1].ts;
  const span = 120_000;
  // last sample before the window draws the line's entry at the left edge
  const first = Math.max(0, points.findIndex((p) => p.ts >= now - span) - 1);
  const shown = points.slice(first);

  let max = 0;
  for (const p of shown) {
    if (p.dl > max) max = p.dl;
    if (p.ul > max) max = p.ul;
  }
  max = niceMax(max || 1024);

  ctx.strokeStyle = "rgba(71, 85, 105, 0.3)";
  ctx.lineWidth = 1;
  ctx.font = "10px system-ui";
  ctx.fillStyle = "#94a3b8";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= 4; i++) {
    const y = padT + (ch * i) / 4;
    const val = max * (1 - i / 4);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + cw, y);
    ctx.stroke();
    ctx.fillText(formatSize(val) + "/s", padL - 6, y);
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const s of [120, 90, 60, 30, 0]) {
    const x = padL + cw * (1 - s / 120);
    ctx.fillText(s === 0 ? labels.now : `${s}s`, x, padT + ch + 4);
  }

  function line(key: "dl" | "ul", color: string) {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    for (let i = 0; i < shown.length; i++) {
      const p = shown[i];
      const x = padL + cw * ((p.ts - (now - span)) / span);
      const y = padT + ch * (1 - p[key] / max);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(padL, 0, cw, h);
  ctx.clip();
  line("dl", "#38bdf8");
  line("ul", "#22c55e");
  ctx.restore();

  ctx.font = "10px system-ui";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const lx = padL + 8, ly = padT + 10;
  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + 12, ly); ctx.stroke();
  ctx.fillStyle = "#94a3b8";
  ctx.fillText(labels.download, lx + 16, ly);
  ctx.strokeStyle = "#22c55e";
  ctx.beginPath(); ctx.moveTo(lx + 90, ly); ctx.lineTo(lx + 102, ly); ctx.stroke();
  ctx.fillStyle = "#94a3b8";
  ctx.fillText(labels.upload, lx + 106, ly);
}

/** Speed tab: download and upload graph of the samples the panel collected. */
export function SpeedTab({ torrent, buffer }: { torrent: Torrent; buffer: SpeedPoint[] }) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w === 0 || size.h === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    drawChart(ctx, size.w, size.h, buffer, {
      collecting: t("detail.speed.collecting"),
      download: t("detail.speed.download"),
      upload: t("detail.speed.upload"),
      now: t("detail.speed.now"),
    });
  }, [torrent, size, buffer]);

  return (
    <div ref={containerRef} className="w-full h-full" style={{ minHeight: "120px" }}>
      <canvas ref={canvasRef} style={{ display: "block", width: size.w, height: size.h }} />
    </div>
  );
}
