import { useNavigate } from "react-router-dom";
import { Plus, ChevronRight } from "lucide-react";
import { fmtMoney, fmtWhen, useStore } from "../store";
import { Empty, PartyIcon, Pill, Toggle } from "../components/ui";
import { provName } from "../components/Shell";

export default function HelpersPage() {
  const { agents, wallets, txs, pause } = useStore();
  const nav = useNavigate();
  const waiting = txs.filter((t) => t.status === "pending_approval");

  return (
    <>
      <div className="page-h">
        <div><h1>Your helpers</h1><div className="sub">AIs you've given a wallet and some rules. Pause any of them with one tap.</div></div>
        <button className="btn primary" onClick={() => nav("/helpers/new")}><Plus /> Add a helper</button>
      </div>

      {agents.length === 0 && <div className="card"><Empty title="No helpers yet">Connect Claude, ChatGPT or Gemini and give it its own wallet with limits you choose.</Empty></div>}

      <div className="stack">
        {agents.map((a) => {
          const w = wallets.find((x) => x.id === a.walletId);
          const pct = Math.min(100, (Number(a.spentThisWeek.amount) / Number(a.policy.weeklyAllowance.amount)) * 100);
          const asking = waiting.filter((t) => t.initiatedBy === a.id).length;
          return (
            <div key={a.id} className="card">
              <div className="row" style={{ gap: 16, alignItems: "flex-start" }}>
                <PartyIcon party={a} size="lg" />
                <div className="grow">
                  <div className="between">
                    <div className="row" style={{ gap: 8 }}>
                      <h3 style={{ cursor: "pointer" }} onClick={() => nav(`/helpers/${a.id}`)}>{a.name}</h3>
                      <Pill tone={a.seal === "sealed" ? "sage" : undefined} live={a.seal === "sealed"}>{a.seal === "sealed" ? "live" : "paused"}</Pill>
                      {asking > 0 && <Pill tone="clay">asking you</Pill>}
                    </div>
                    <Toggle on={a.seal === "sealed"} onChange={(v) => pause(a.id, !v)} label={`Pause ${a.name}`} />
                  </div>
                  <div className="sub">{provName(a.provider)} · {a.purpose}</div>
                  <div className="row" style={{ marginTop: 14, gap: 24, flexWrap: "wrap" }}>
                    <div><div className="faint small">In its wallet</div><div className="num" style={{ fontWeight: 500 }}>{w ? fmtMoney(w.fiatBalance) : "—"}</div></div>
                    <div><div className="faint small">Can spend alone</div><div className="num" style={{ fontWeight: 500 }}>up to {fmtMoney(a.policy.autoApproveUpTo)}</div></div>
                    <div><div className="faint small">Last active</div><div style={{ fontWeight: 500 }}>{a.lastActiveAt ? fmtWhen(a.lastActiveAt) : "never"}</div></div>
                  </div>
                  <div style={{ marginTop: 14 }}>
                    <div className="between small"><span className="muted">This week</span><span className="num">{fmtMoney(a.spentThisWeek)} of {fmtMoney(a.policy.weeklyAllowance)}</span></div>
                    <div className="bar" style={{ marginTop: 6 }}><i className={pct > 85 ? "clay" : "sage"} style={{ width: `${pct}%` }} /></div>
                  </div>
                </div>
                <button className="btn ghost" onClick={() => nav(`/helpers/${a.id}`)}><ChevronRight /></button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
