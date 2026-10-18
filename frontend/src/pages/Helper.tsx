import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, Pause, Play, SlidersHorizontal, Trash2, Copy } from "lucide-react";
import { api } from "../api";
import type { AgentPolicy } from "../api";
import { fmtMoney, fmtWhen, useStore } from "../store";
import { Empty, PartyIcon, PartyName, Pill, Seal, Sheet, StatusPill, Toggle } from "../components/ui";
import { useApproval } from "../components/Approval";
import { LineChart, Ranges, type Point } from "../components/Chart";
import { spendSeries, startOfWeek } from "../series";
import { provName } from "../components/Shell";

export default function HelperPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { agent, wallets, txs, parties, pause, removeAgent, refresh, notify } = useStore();
  const { open } = useApproval();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [span, setSpan] = useState<"This week" | "Last 4 weeks">("This week");
  const [scrub, setScrub] = useState<Point | null>(null);
  const spend = useMemo(() => (id ? spendSeries(txs, id, span === "This week" ? startOfWeek() : startOfWeek() - 21 * 864e5) : []), [txs, id, span]);
  const a = id ? agent(id) : undefined;
  if (!a) return <Empty title="Can't find that helper">It may have been removed.</Empty>;

  const w = wallets.find((x) => x.id === a.walletId);
  const mine = txs.filter((t) => t.initiatedBy === a.id);
  const pct = Math.min(100, (Number(a.spentThisWeek.amount) / Number(a.policy.weeklyAllowance.amount)) * 100);
  const payees = a.policy.allowedPayees.map((p) => parties.find((x) => x.id === p)?.name).filter(Boolean);

  const savePolicy = async (p: AgentPolicy) => { await api.updateAgentPolicy(a.id, p); await refresh(); setEditing(false); notify("Limits updated."); };

  return (
    <>
      <button className="btn ghost" style={{ marginLeft: -12, marginBottom: 8 }} onClick={() => nav("/helpers")}><ChevronLeft /> Helpers</button>
      <div className="page-h">
        <div className="row" style={{ gap: 16 }}>
          <PartyIcon party={a} size="lg" />
          <div>
            <h1 className="row" style={{ gap: 10 }}>{a.name} <Pill tone={a.seal === "sealed" ? "sage" : undefined} live={a.seal === "sealed"}>{a.seal === "sealed" ? "live" : "paused"}</Pill></h1>
            <div className="sub">{provName(a.provider)} · {a.purpose}</div>
          </div>
        </div>
        <div className="row">
          <button className="btn" onClick={() => pause(a.id, a.seal === "sealed")}>{a.seal === "sealed" ? <><Pause /> Pause</> : <><Play /> Resume</>}</button>
          <button className="btn" onClick={() => setEditing(true)}><SlidersHorizontal /> Change limits</button>
          <button className="btn ghost danger" onClick={() => setRemoving(true)}><Trash2 /></button>
        </div>
      </div>

      <div className="grid2" style={{ alignItems: "start" }}>
        <div className="card hero">
          <div className="lbl">{scrub ? `Spent by ${fmtWhen(new Date(scrub.t).toISOString())}` : `Spent ${span.toLowerCase()}`}</div>
          <div className="big">{fmtMoney({ amount: (scrub ? scrub.v : Number(a.spentThisWeek.amount)).toFixed(2), currency: "USD" })} <span style={{ fontFamily: "var(--sans)", fontSize: 14, color: "var(--ink-2)", letterSpacing: 0 }}>of {fmtMoney(a.policy.weeklyAllowance)}</span></div>
          <div className={"chg" + (pct > 85 ? " down" : "")}>{pct > 85 ? "Close to its allowance" : `${Math.round(100 - pct)}% of its allowance left`} · in its wallet {w ? fmtMoney(w.fiatBalance) : "—"}</div>
          <LineChart points={spend} height={120} dashedAt={Number(a.policy.weeklyAllowance.amount)} dashedLabel={`allowance ${fmtMoney(a.policy.weeklyAllowance)}`} onScrub={setScrub} format={(v) => fmtMoney({ amount: v.toFixed(2), currency: "USD" })} formatTime={(t) => fmtWhen(new Date(t).toISOString())} />
          <Ranges value={span} onChange={setSpan} options={["This week", "Last 4 weeks"]} />
        </div>

        <div className="card" style={{ padding: "6px 22px" }}>
          <div className="kv"><span>Runs on</span><b>{provName(a.provider)} · via MCP {a.mcp.connected ? <Pill tone="sage">connected</Pill> : <Pill tone="clay">not connected yet</Pill>}</b></div>
          <div className="kv"><span>Can pay without asking</span><b className="num">up to {fmtMoney(a.policy.autoApproveUpTo)}</b></div>
          <div className="kv"><span>Can pay</span><b>{payees.length ? payees.join(", ") : "asks you every time"}</b></div>
          <div className="kv"><span>Can never</span><b>{[!a.policy.canWithdraw && "withdraw to cash", !a.policy.canAddPayees && "add new places"].filter(Boolean).join(", ") || "—"}</b></div>
          <div className="kv"><span>Sealed</span><b className="row" style={{ gap: 6 }}><Seal kind="agent" size="xs" /> by you · {a.sealedAt ? new Date(a.sealedAt).toLocaleDateString("en-US", { day: "numeric", month: "short" }) : ""}</b></div>
        </div>
      </div>

      {!a.mcp.connected && (
        <div className="card" style={{ marginTop: 18 }}>
          <h3>Finish connecting {a.name}</h3>
          <div className="sub" style={{ marginBottom: 12 }}>Paste this where {provName(a.provider)} keeps its tools. The key ending in {a.mcp.keyHint} was shown when you created it.</div>
          <div className="code">{`{ "mcpServers": { "sigil": { "url": "${a.mcp.url}", "key": "sk_live_…${a.mcp.keyHint}" } } }`}<button className="btn ghost" style={{ position: "absolute", right: 6, top: 6, padding: 6 }} onClick={() => { navigator.clipboard?.writeText(a.mcp.url); notify("Copied."); }}><Copy /></button></div>
        </div>
      )}

      <div className="sec">What {a.name} has done</div>
      <div className="card" style={{ padding: "4px 22px" }}>
        {mine.length === 0 && <Empty title="Nothing yet">When {a.name} moves money, it shows up here.</Empty>}
        {mine.map((t) => (
          <div key={t.id} className="li click" onClick={() => t.status === "pending_approval" && open(t)}>
            <PartyIcon party={parties.find((p) => p.id === t.toPartyId)} kind={t.status === "pending_approval" ? "warn" : undefined} />
            <div className="t grow"><b><PartyName id={t.toPartyId} /></b><span>{[fmtWhen(t.createdAt), t.status === "settled" ? (t.flags.length === 0 ? "auto-approved" : "you approved") : t.status === "declined" ? (t.memo?.startsWith("Blocked") ? "blocked" : "you declined") : t.status === "failed" ? "failed" : t.status === "expired" ? "expired" : "waiting for you", t.memo].filter(Boolean).join(" · ")}</span></div>
            <StatusPill tx={t} />
            <div className="amt num" style={{ minWidth: 80 }}>{fmtMoney(t.fiatAmount)}</div>
          </div>
        ))}
      </div>

      {editing && <PolicySheet agentName={a.name} policy={a.policy} onClose={() => setEditing(false)} onSave={savePolicy} />}

      {removing && (
        <Sheet onClose={() => setRemoving(false)}>
          <div className="ask">Remove <em>{a.name}</em>?</div>
          <p className="plain">Its MCP key stops working immediately. The {w ? fmtMoney(w.fiatBalance) : ""} in its wallet goes back to your main wallet. You can always add it again later.</p>
          <div className="row" style={{ gap: 10 }}>
            <button className="btn lg grow" onClick={() => setRemoving(false)}>Keep it</button>
            <button className="btn lg grow primary" style={{ background: "var(--red)" }} onClick={async () => { await removeAgent(a.id); nav("/helpers"); }}>Remove</button>
          </div>
        </Sheet>
      )}
    </>
  );
}

export function PolicySheet({ agentName, policy, onClose, onSave }: { agentName: string; policy: AgentPolicy; onClose: () => void; onSave: (p: AgentPolicy) => Promise<void> | void }) {
  const [p, setP] = useState<AgentPolicy>(policy);
  const [busy, setBusy] = useState(false);
  const money = (k: "autoApproveUpTo" | "weeklyAllowance") => (
    <div className="row" style={{ gap: 6 }}>
      <span className="muted">$</span>
      <input className="input num" style={{ width: 120, textAlign: "right" }} inputMode="decimal" value={p[k].amount} onChange={(e) => setP({ ...p, [k]: { ...p[k], amount: e.target.value.replace(/[^\d.]/g, "") } })} />
    </div>
  );
  return (
    <Sheet onClose={onClose}>
      <div className="ask">What <em>{agentName}</em> is allowed to do</div>
      <p className="plain">Anything outside these lines comes to you first.</p>
      <div className="kv"><span>Can pay without asking, up to</span>{money("autoApproveUpTo")}</div>
      <div className="kv"><span>Weekly allowance</span>{money("weeklyAllowance")}</div>
      <div className="kv"><span>Look at balances</span><Toggle on={p.canViewBalances} onChange={(v) => setP({ ...p, canViewBalances: v })} /></div>
      <div className="kv"><span>Pay new places without asking</span><Toggle on={p.canAddPayees} onChange={(v) => setP({ ...p, canAddPayees: v })} /></div>
      <div className="kv"><span>Withdraw to cash</span><Toggle on={p.canWithdraw} onChange={(v) => setP({ ...p, canWithdraw: v })} /></div>
      <div className="row" style={{ gap: 10, marginTop: 18 }}>
        <button className="btn lg grow" onClick={onClose}>Cancel</button>
        <button className="btn lg grow primary" disabled={busy} onClick={async () => { setBusy(true); await onSave({ ...p, autoApproveUpTo: { ...p.autoApproveUpTo, amount: Number(p.autoApproveUpTo.amount || 0).toFixed(2) }, weeklyAllowance: { ...p.weeklyAllowance, amount: Number(p.weeklyAllowance.amount || 0).toFixed(2) } }); setBusy(false); }}>{busy ? "Saving…" : "Save"}</button>
      </div>
    </Sheet>
  );
}
