import { useId, useRef, useState } from "react";

export type Point = { t: number; v: number };
export type Range = "1D" | "1W" | "1M" | "3M" | "1Y" | "All";
export const RANGES: Range[] = ["1D", "1W", "1M", "3M", "1Y", "All"];
export const rangeMs: Record<Range, number> = { "1D": 864e5, "1W": 7 * 864e5, "1M": 30 * 864e5, "3M": 90 * 864e5, "1Y": 365 * 864e5, All: Infinity };

/**
 * Robinhood-style line chart: one series, a soft fill, a dashed baseline,
 * and a finger/mouse scrub that reports the point under the pointer.
 */
export function LineChart({ points, height = 150, color = "var(--sage)", downColor = "var(--clay)", baseline, dashedAt, dashedLabel, onScrub, format, formatTime }: {
  points: Point[]; height?: number; color?: string; downColor?: string; baseline?: number; dashedAt?: number; dashedLabel?: string;
  onScrub?: (p: Point | null) => void; format: (v: number) => string; formatTime: (t: number) => string;
}) {
  const id = useId();
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = 600, H = height;
  if (points.length < 2) return <div style={{ height }} className="chart-empty small muted">Not enough history yet.</div>;
  const t0 = points[0].t, t1 = points[points.length - 1].t;
  const vs = points.map((p) => p.v).concat(dashedAt !== undefined ? [dashedAt] : []).concat(baseline !== undefined ? [baseline] : []);
  let min = Math.min(...vs), max = Math.max(...vs);
  if (max === min) { max += 1; min -= 1; }
  const pad = (max - min) * 0.12; min -= pad; max += pad;
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * W;
  const y = (v: number) => H - ((v - min) / (max - min)) * (H - 22) - 6;
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");
  const up = baseline === undefined ? points[points.length - 1].v >= points[0].v : points[points.length - 1].v >= baseline;
  const stroke = up ? color : downColor;
  const hp = hover !== null ? points[hover] : null;

  const pick = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    const t = t0 + ((clientX - r.left) / r.width) * (t1 - t0);
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(points[i].t - t) < Math.abs(points[best].t - t)) best = i;
    setHover(best); onScrub?.(points[best]);
  };
  const clear = () => { setHover(null); onScrub?.(null); };

  return (
    <div className="line-wrap" style={{ position: "relative" }}>
    {dashedAt !== undefined && dashedLabel && <span className="chart-label" style={{ top: `${(y(dashedAt) / H) * 100}%` }}>{dashedLabel}</span>}
    <svg ref={ref} className="line" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height }}
      onPointerMove={(e) => pick(e.clientX)} onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); pick(e.clientX); }} onPointerUp={clear} onPointerLeave={clear} onPointerCancel={clear}>
      <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={stroke} stopOpacity=".16" /><stop offset="1" stopColor={stroke} stopOpacity="0" /></linearGradient></defs>
      <path d={`${d} L${W} ${H} L0 ${H}Z`} fill={`url(#${id})`} />
      {baseline !== undefined && <line x1="0" x2={W} y1={y(baseline)} y2={y(baseline)} stroke="var(--pale)" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />}
      {dashedAt !== undefined && <>
        <line x1="0" x2={W} y1={y(dashedAt)} y2={y(dashedAt)} stroke="var(--clay)" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />
      </>}
      <path d={d} fill="none" stroke={stroke} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {hp && <>
        <line x1={x(hp.t)} x2={x(hp.t)} y1="0" y2={H} stroke={stroke} strokeOpacity=".35" vectorEffect="non-scaling-stroke" />
        <circle cx={x(hp.t)} cy={y(hp.v)} r="5" fill={stroke} stroke="#fff" strokeWidth="2" vectorEffect="non-scaling-stroke" className="chart-dot" />
      </>}
      <text style={{ display: "none" }}>{format(points[points.length - 1].v)} {formatTime(t1)}</text>
    </svg>
    </div>
  );
}

export function Ranges<T extends string>({ value, onChange, options = RANGES as unknown as T[] }: { value: T; onChange: (r: T) => void; options?: T[] }) {
  return <div className="ranges">{options.map((r) => <button key={r} className={r === value ? "on" : ""} onClick={() => onChange(r)}>{r}</button>)}</div>;
}

/** Tiny trend line for list rows. */
export function Sparkline({ values, color = "var(--sage)", flat = false }: { values: number[]; color?: string; flat?: boolean }) {
  const W = 64, H = 26;
  if (values.length < 2 || flat) return <svg className="spark" viewBox={`0 0 ${W} ${H}`}><line x1="0" x2={W} y1={H / 2} y2={H / 2} stroke="var(--pale)" strokeWidth="1.8" /></svg>;
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const d = values.map((v, i) => `${i ? "L" : "M"}${(i / (values.length - 1)) * W} ${H - 3 - ((v - min) / span) * (H - 6)}`).join(" ");
  return <svg className="spark" viewBox={`0 0 ${W} ${H}`}><path d={d} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" /></svg>;
}
