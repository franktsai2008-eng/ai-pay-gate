import { Check, AlertCircle, Bot, Building2, User as UserIcon, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Check as CheckIcon, Delete } from "lucide-react";
import type { Party, SealState, Transaction } from "../api";
import { useStore } from "../store";

/** The seal tile. Letter S, state by colour. The one brand element. */
export function Seal({ state = "sealed", kind = "person", size = "sm", light = false, title }: { state?: SealState; kind?: Party["kind"]; size?: "xs" | "sm" | "md" | "lg"; light?: boolean; title?: string }) {
  const cls = ["seal", size, state === "unsealed" ? "unsealed" : state === "paused" ? "paused" : kind === "agent" ? "agent" : "", light ? "light" : ""].join(" ");
  const label = title ?? (state === "sealed" ? `Sealed ${kind}` : state === "paused" ? "Paused" : "Not sealed");
  return <span className={cls} title={label} aria-label={label}>{state === "unsealed" ? "" : "S"}</span>;
}

/** The Sigil mark: the seal tile with the dissolving edge. One SVG file, any size. */
export function Mark({ size = 24, stamp = false, className = "" }: { size?: number; stamp?: boolean; className?: string }) {
  return <img src="/sigil-mark.svg" alt="" width={size} height={size} className={["mark", stamp ? "stamp" : "", className].filter(Boolean).join(" ")} draggable={false} />;
}

/** The moment something gets sealed: the mark lands, a ring goes out. */
export function Sealed({ children, size = 96 }: { children?: ReactNode; size?: number }) {
  return <div className="sealed-moment"><span className="ring" /><Mark size={size} stamp />{children && <div className="sealed-line">{children}</div>}</div>;
}

/** A party name with its seal, as it appears everywhere. */
export function PartyName({ id, bold = true }: { id: string; bold?: boolean }) {
  const { party } = useStore();
  const p = party(id);
  if (!p) return <span className="muted">Unknown</span>;
  return (
    <span className="row" style={{ gap: 6, display: "inline-flex", fontWeight: bold ? 500 : 400, color: p.seal === "unsealed" ? "var(--ink-3)" : undefined }}>
      {p.name} <Seal state={p.seal} kind={p.kind} size="xs" />
    </span>
  );
}

export function PartyIcon({ party, kind: k, size }: { party?: Party; kind?: "in" | "out" | "warn"; size?: "lg" }) {
  const cls = ["ic", size ?? "", party?.kind === "agent" ? "agent" : party?.kind === "person" ? "person" : "", k === "in" ? "in" : k === "warn" ? "warn" : ""].join(" ");
  const Icon = k === "warn" ? AlertCircle : k === "in" ? ArrowDownLeft : party?.kind === "agent" ? Bot : party?.kind === "person" ? UserIcon : party?.kind === "business" ? Building2 : ArrowUpRight;
  if (party?.kind === "agent" && k !== "warn" && k !== "in") return <div className={cls + " mark-ic"}><Mark size={size === "lg" ? 44 : 30} /></div>;
  return <div className={cls}><Icon /></div>;
}

export function Pill({ children, tone, live }: { children: ReactNode; tone?: "sage" | "clay" | "red"; live?: boolean }) {
  return <span className={["pill", tone ?? "", live ? "live" : ""].join(" ")}>{children}</span>;
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return <button type="button" className={"toggle" + (on ? " on" : "")} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />;
}

export function CheckLine({ ok = true, children }: { ok?: boolean; children: ReactNode }) {
  return <div className="check"><i className={ok ? "" : "warn"}>{ok ? <Check /> : <AlertCircle />}</i><span>{children}</span></div>;
}

export function Sheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <div className="scrim" onClick={onClose} role="dialog" aria-modal>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        {children}
      </div>
    </div>
  );
}

export function Toast() {
  const { toast } = useStore();
  if (!toast) return null;
  return <div className="toast"><Seal size="xs" light />{toast}</div>;
}

export function StatusPill({ tx }: { tx: Transaction }) {
  switch (tx.status) {
    case "pending_approval": return <Pill tone="clay">Waiting on you</Pill>;
    case "declined": return <Pill tone="red">Declined</Pill>;
    case "failed": return <Pill tone="red">Failed</Pill>;
    case "expired": return <Pill>Expired</Pill>;
    default: return <Pill tone="sage">Sealed</Pill>;
  }
}

export function Bars({ values, pale }: { values: number[]; pale?: number[] }) {
  const max = Math.max(...values, ...(pale ?? [1]));
  return (
    <div className="chart">
      {values.map((v, i) => (
        <i key={i} style={{ height: `${(v / max) * 100}%` }} className={pale ? "" : undefined} />
      )).flatMap((el, i) => (pale ? [el, <i key={"p" + i} className="pale" style={{ height: `${(pale[i] / max) * 100}%` }} />] : [el]))}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><div className="serif">{title}</div><div className="small">{children}</div></div>;
}


/** Robinhood's "swipe to submit": drag the knob to the end to confirm. Keyboard: Enter/Space. */
export function Swipe({ label, doneLabel = "Done", onDone, disabled }: { label: string; doneLabel?: string; onDone: () => void | Promise<void>; disabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [x, setX] = useState(0);
  const [done, setDone] = useState(false);
  const drag = useRef<{ start: number; max: number } | null>(null);
  const finish = async () => { setDone(true); await onDone(); };
  const onDown = (e: React.PointerEvent) => {
    if (disabled || done) return;
    const r = ref.current!.getBoundingClientRect();
    drag.current = { start: e.clientX - x, max: r.width - 60 };
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => { if (!drag.current) return; setX(Math.max(0, Math.min(drag.current.max, e.clientX - drag.current.start))); };
  const onUp = () => {
    if (!drag.current) return;
    const { max } = drag.current; drag.current = null;
    if (x > max * 0.82) { setX(max); finish(); } else setX(0);
  };
  return (
    <div ref={ref} className={"swipe" + (done ? " done" : "")} role="button" tabIndex={0} aria-label={label} aria-disabled={disabled}
      onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !disabled && !done) { e.preventDefault(); finish(); } }} style={{ opacity: disabled ? .5 : 1 }}>
      <div className="fill" style={{ width: x + 55 }} />
      <span className="lbl" style={{ opacity: done ? 1 : Math.max(0, 1 - x / 120) }}>{done ? doneLabel : label}</span>
      <div className="knob" style={{ transform: `translateX(${x}px)`, transition: drag.current ? "none" : "transform .2s" }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        {done ? <CheckIcon /> : <ArrowRight />}
      </div>
    </div>
  );
}

/** Amount keypad. Keeps a decimal string with at most two decimals. */
export function Keypad({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const press = (k: string) => {
    if (k === "⌫") return onChange(value.slice(0, -1));
    if (k === ".") return onChange(value.includes(".") ? value : (value || "0") + ".");
    const [, dec] = value.split(".");
    if (dec !== undefined && dec.length >= 2) return;
    if (value === "0") return onChange(k);
    if (value.replace(".", "").length >= 7) return;
    onChange(value + k);
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => { const tag = (e.target as HTMLElement)?.tagName; if (tag === "INPUT" || tag === "TEXTAREA") return; if (/^[0-9.]$/.test(e.key)) press(e.key); else if (e.key === "Backspace") press("⌫"); };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  });
  return (
    <div className="keypad">
      {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"].map((k) => (
        <button key={k} className={k === "." || k === "⌫" ? "soft" : ""} onClick={() => press(k)} aria-label={k === "⌫" ? "Delete" : k}>{k === "⌫" ? <Delete /> : k}</button>
      ))}
    </div>
  );
}

/** Big amount display for the Send screen. */
export function AmountBig({ value, sub }: { value: string; sub?: ReactNode }) {
  const [int, dec] = (value || "0").split(".");
  return (
    <div className="amt-big">
      <div className={"v" + (value ? "" : " empty")}><small>$</small>{Number(int || 0).toLocaleString("en-US")}{dec !== undefined && <span style={{ color: "var(--ink-3)" }}>.{dec}</span>}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

/** Full-screen moment: first seal, first helper, a quiet week. */
export function Celebrate({ title, children, primary, secondary, foot }: { title: ReactNode; children?: ReactNode; primary: { label: string; onClick: () => void }; secondary?: { label: string; onClick: () => void }; foot?: ReactNode }) {
  const bits = Array.from({ length: 18 }, (_, i) => ({ left: `${(i * 37) % 100}%`, delay: `${(i % 6) * 0.18}s`, bg: ["#fff", "#e3ece6", "#c9cdc8"][i % 3], rot: (i * 53) % 90 }));
  return (
    <div className="celebrate" role="dialog" aria-modal>
      <div className="confetti" aria-hidden>{bits.map((b, i) => <i key={i} style={{ left: b.left, top: 0, background: b.bg, animationDelay: b.delay, transform: `rotate(${b.rot}deg)` }} />)}</div>
      <Mark size={88} />
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      <div className="acts">
        <button className="btn lg primary" onClick={primary.onClick}>{primary.label}</button>
        {secondary && <button className="btn lg" onClick={secondary.onClick}>{secondary.label}</button>}
      </div>
      {foot && <div className="foot">{foot}</div>}
    </div>
  );
}
