import { useState } from "react";
import { Copy, ShieldCheck, Bell, Globe, LogOut, QrCode } from "lucide-react";
import { isMock } from "../api";
import { fmtMoney, useStore } from "../store";
import { Pill, Seal, Toggle } from "../components/ui";

export default function YouPage() {
  const { me, wallets, agents, notify } = useStore();
  const mine = wallets.find((w) => w.ownerId === me?.id);
  const [push, setPush] = useState(true);
  const [big, setBig] = useState(false);
  if (!me) return null;
  return (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      <div className="page-h">
        <div className="row" style={{ gap: 16 }}>
          <Seal size="lg" />
          <div><h1 className="row" style={{ gap: 10 }}>{me.name} <Pill tone="sage"><ShieldCheck size={12} /> sealed</Pill></h1><div className="sub">{me.email} · verified {me.verification.at ? new Date(me.verification.at).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : ""} with a {me.verification.method === "passkey" ? "passkey" : "photo ID"}</div></div>
        </div>
      </div>

      <div className="card dark">
        <div className="small muted">Receive money · your main wallet</div>
        <div className="row" style={{ marginTop: 10, gap: 14 }}>
          <div className="ic" style={{ background: "#fff", width: 72, height: 72, borderRadius: 16 }}><QrCode size={40} color="#1f2321" /></div>
          <div className="grow">
            <div className="serif" style={{ fontSize: 22 }}>{mine?.address}</div>
            <div className="muted small">Anyone sealed can also just search your name.</div>
          </div>
          <button className="btn" onClick={() => { navigator.clipboard?.writeText(mine?.address ?? ""); notify("Address copied."); }}><Copy /> Copy</button>
        </div>
      </div>

      <div className="sec">Your seal</div>
      <div className="card" style={{ padding: "6px 22px" }}>
        <div className="kv"><span>Status</span><b className="row" style={{ gap: 6 }}><Seal size="xs" /> Sealed · verified person</b></div>
        <div className="kv"><span>Vouching for</span><b>{agents.length} helper{agents.length !== 1 ? "s" : ""}</b></div>
        <div className="kv"><span>Sign-in</span><b>Passkey (Face ID / Touch ID)</b></div>
        <div className="kv"><span>Recovery</span><b style={{ color: "var(--sage)" }}>Set up ✓</b></div>
      </div>

      <div className="sec">How Sigil talks to you</div>
      <div className="card" style={{ padding: "6px 22px" }}>
        <div className="kv"><span className="row"><Bell size={15} /> Buzz me when a helper needs an okay</span><Toggle on={push} onChange={setPush} /></div>
        <div className="kv"><span className="row"><Globe size={15} /> Show money in</span><b>USD</b></div>
        <div className="kv"><span>Bigger text</span><Toggle on={big} onChange={(v) => { setBig(v); document.documentElement.style.fontSize = v ? "112%" : ""; }} /></div>
      </div>

      <div className="sec">Totals</div>
      <div className="card" style={{ padding: "6px 22px" }}>
        {wallets.map((w) => <div key={w.id} className="kv"><span>{w.label}</span><b className="num">{fmtMoney(w.fiatBalance)}</b></div>)}
      </div>

      <div style={{ marginTop: 28 }} className="row">
        <button className="btn ghost danger"><LogOut /> Sign out</button>
        {isMock && <span className="faint small" style={{ marginLeft: "auto" }}>Running on sample data · set VITE_API_URL to use the real backend</span>}
      </div>
    </div>
  );
}
