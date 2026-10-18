import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, Search } from "lucide-react";
import { api } from "../api";
import { fmtMoney, useStore } from "../store";
import { AmountBig, CheckLine, Keypad, PartyIcon, Seal, Sheet, Swipe } from "../components/ui";

export default function SendPage() {
  const { parties, wallets, me, refresh, notify } = useStore();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [to, setTo] = useState<string | null>(null);
  const [amt, setAmt] = useState("");
  const [memo, setMemo] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const mine = wallets.find((w) => w.ownerId === me?.id);
  const people = parties.filter((p) => p.id !== me?.id && p.kind !== "agent" && p.name.toLowerCase().includes(q.toLowerCase()));
  const toParty = parties.find((p) => p.id === to);
  const isAddress = /^0x[0-9a-fA-F]{6,}$/.test(q);
  const n = Number(amt);
  const ok = (to || isAddress) && n > 0 && mine && n <= Number(mine.fiatBalance.amount);

  const send = async () => {
    setBusy(true);
    try {
      await api.send({ fromWalletId: mine!.id, to: to ? { partyId: to } : { address: q }, amount: { amount: n.toFixed(2), currency: "USDC" }, memo: memo || undefined });
      await refresh(); notify(`Sent ${fmtMoney({ amount: n.toFixed(2), currency: "USD" })} to ${toParty?.name ?? "that address"}.`); nav("/activity");
    } finally { setBusy(false); setConfirm(false); }
  };

  return (
    <div style={{ maxWidth: 560, margin: "0 auto" }}>
      <button className="btn ghost" style={{ marginLeft: -12, marginBottom: 8 }} onClick={() => nav(-1)}><ChevronLeft /> Back</button>
      <div className="page-h"><div><h1>Send money</h1><div className="sub">From your main wallet · {mine ? fmtMoney(mine.fiatBalance) : ""} available</div></div></div>

      {!to && (
        <div className="card">
          <div className="row input" style={{ gap: 10 }}><Search size={16} className="faint" /><input style={{ border: 0, outline: 0, flex: 1, fontSize: 15 }} placeholder="Name, or paste a wallet address" value={q} onChange={(e) => setQ(e.target.value)} autoFocus /></div>
          <div className="list" style={{ marginTop: 8 }}>
            {people.map((p) => (
              <div key={p.id} className="li click" onClick={() => setTo(p.id)}>
                <PartyIcon party={p} />
                <div className="t grow"><b className="row" style={{ gap: 6 }}>{p.name} <Seal state={p.seal} kind={p.kind} size="xs" /></b><span>{p.kind === "business" ? "Business" : "Person"} · {p.seal === "sealed" ? "sealed" : "not sealed"}</span></div>
              </div>
            ))}
            {isAddress && <div className="li click" onClick={() => setTo(null)}><div className="ic"><Seal state="unsealed" size="xs" /></div><div className="t grow"><b>Send to this address</b><span>Not sealed. Double-check it, we can't tell you who it is.</span></div></div>}
            {people.length === 0 && !isAddress && <div className="empty small">No one by that name. Paste an address to send anywhere.</div>}
          </div>
        </div>
      )}

      {(to || isAddress) && (
        <div className="card">
          <div className="between">
            <div className="row"><PartyIcon party={toParty} /><div><b style={{ fontWeight: 500 }} className="row" >{toParty?.name ?? q.slice(0, 8) + "…"} <Seal state={toParty?.seal ?? "unsealed"} kind={toParty?.kind} size="xs" /></b><div className="small muted">{toParty ? (toParty.seal === "sealed" ? "Sealed, we know who this is" : "Not sealed") : "Raw address, not sealed"}</div></div></div>
            <button className="btn ghost" onClick={() => { setTo(null); setQ(""); }}>Change</button>
          </div>
          <AmountBig value={amt} sub={mine && n > Number(mine.fiatBalance.amount) ? <span style={{ color: "var(--red)" }}>That's more than you have.</span> : <>You have {mine ? fmtMoney(mine.fiatBalance) : ""} · arrives in seconds</>} />
          <div className="quick">{[20, 50, 100, 200].map((v) => <button key={v} className={amt === String(v) ? "on" : ""} onClick={() => setAmt(String(v))}>${v}</button>)}</div>
          <input className="input" style={{ marginTop: 18 }} placeholder="What's it for? (optional)" value={memo} onChange={(e) => setMemo(e.target.value)} />
          <Keypad value={amt} onChange={setAmt} />
          <div className="pin"><button className="btn lg block sage" disabled={!ok} onClick={() => setConfirm(true)}>Review</button></div>
        </div>
      )}

      {confirm && (
        <Sheet onClose={() => setConfirm(false)}>
          <div className="ask">Send <em className="num">{fmtMoney({ amount: n.toFixed(2), currency: "USD" })}</em> to {toParty?.name ?? "this address"}?</div>
          <p className="plain">{memo ? `For ${memo}. ` : ""}It'll arrive in a few seconds and can't be undone.</p>
          {toParty?.seal === "sealed" ? <CheckLine>{toParty.name} is sealed. We know who they are.</CheckLine> : <CheckLine ok={false}>This wallet isn't sealed. Only send if you're sure.</CheckLine>}
          <CheckLine>Leaves you with {mine ? fmtMoney({ amount: (Number(mine.fiatBalance.amount) - n).toFixed(2), currency: "USD" }) : ""}</CheckLine>
          <div style={{ marginTop: 18 }}><Swipe label={`Swipe to send ${fmtMoney({ amount: n.toFixed(2), currency: "USD" })}`} doneLabel="Sent" disabled={busy} onDone={send} /></div>
          <button className="linkbtn" onClick={() => setConfirm(false)}>Not yet</button>
        </Sheet>
      )}
    </div>
  );
}
