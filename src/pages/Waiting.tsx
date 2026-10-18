import { fmtMoney, minutesLeft, useStore } from "../store";
import { Empty, PartyIcon, PartyName, Seal } from "../components/ui";
import { useApproval } from "../components/Approval";

export default function WaitingPage() {
  const { txs, agent, party } = useStore();
  const { open } = useApproval();
  const waiting = txs.filter((t) => t.status === "pending_approval");
  const recent = txs.filter((t) => t.status === "declined" || (t.status === "settled" && t.flags.length > 0)).slice(0, 8);

  return (
    <>
      <div className="page-h"><div><h1>Waiting on you</h1><div className="sub">Your helpers stop and ask when something is bigger or newer than usual. Nothing moves until you say so.</div></div></div>

      {waiting.length === 0 ? (
        <div className="card"><Empty title="Nothing waiting">You're all caught up. We'll nudge you when a helper needs an okay.</Empty></div>
      ) : (
        <div className="stack">
          {waiting.map((t) => {
            const a = agent(t.initiatedBy); const to = party(t.toPartyId); const mins = minutesLeft(t.expiresAt);
            return (
              <div key={t.id} className="card" style={{ cursor: "pointer" }} onClick={() => open(t)}>
                <div className="row" style={{ gap: 16, alignItems: "flex-start" }}>
                  <PartyIcon party={a} kind="warn" size="lg" />
                  <div className="grow">
                    <div className="ask" style={{ fontSize: 22 }}><em>{a?.name}</em> → {to?.name} <Seal state={to?.seal} kind={to?.kind} size="xs" /> · <span className="num">{fmtMoney(t.fiatAmount)}</span></div>
                    <div className="small muted" style={{ marginTop: 6 }}>{t.flags.map((f) => f.code === "over_auto_limit" ? "over its usual limit" : f.code === "new_payee" ? "first time here" : f.code === "unsealed_payee" ? "unsealed wallet" : f.code.replace(/_/g, " ")).join(" · ")}{mins !== null ? ` · expires in ${mins} min` : ""}</div>
                    {t.reason && <div className="small" style={{ marginTop: 10, color: "var(--ink-2)", fontStyle: "italic" }}>“{t.reason}”</div>}
                  </div>
                  <button className="btn sage">Review</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {recent.length > 0 && (
        <>
          <div className="sec">Decided recently</div>
          <div className="card" style={{ padding: "4px 22px" }}>
            {recent.map((t) => (
              <div key={t.id} className="li">
                <PartyIcon party={party(t.toPartyId)} />
                <div className="t grow"><b><PartyName id={t.initiatedBy} /> → <PartyName id={t.toPartyId} /></b><span>{t.status === "declined" ? "You declined" : "You approved"}</span></div>
                <div className="amt num" style={{ color: t.status === "declined" ? "var(--ink-3)" : undefined, textDecoration: t.status === "declined" ? "line-through" : undefined }}>{fmtMoney(t.fiatAmount)}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
