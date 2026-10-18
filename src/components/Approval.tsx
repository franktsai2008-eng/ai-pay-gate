import { createContext, useContext, useState, type ReactNode } from "react";
import type { Transaction } from "../api";
import { explainFlag, fmtMoney, minutesLeft, useStore } from "../store";
import { CheckLine, Pill, Seal, Sealed, Sheet, Swipe } from "./ui";

/**
 * The approval sheet. Opened from anywhere with useApproval().open(tx).
 * Says who, how much, to whom, why it needs you, then two buttons.
 */
const Ctx = createContext<{ open: (tx: Transaction) => void }>({ open: () => {} });
export const useApproval = () => useContext(Ctx);

let setter: ((tx: Transaction | null) => void) | null = null;

export function ApprovalHost() {
  const [tx, setTx] = useState<Transaction | null>(null);
  setter = setTx;
  const { party, agent, approve, decline, txs, wallets } = useStore();
  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);
  const [showWhy, setShowWhy] = useState(false);

  // keep sheet in sync with live updates
  const live = tx ? txs.find((t) => t.id === tx.id) ?? tx : null;
  if (!live) return null;

  const a = agent(live.initiatedBy);
  const to = party(live.toPartyId);
  const name = a?.name ?? party(live.initiatedBy)?.name ?? "A helper";
  const mins = minutesLeft(live.expiresAt);
  const done = live.status !== "pending_approval";
  const w = wallets.find((x) => x.id === live.fromWalletId);

  const act = async (kind: "approve" | "decline") => {
    setBusy(kind);
    try { kind === "approve" ? await approve(live.id) : await decline(live.id); setTimeout(() => setTx(null), kind === "approve" ? 2600 : 900); }
    finally { setBusy(null); }
  };

  return (
    <Sheet onClose={() => setTx(null)}>
      <Pill tone={done ? (live.status === "settled" ? "sage" : "red") : "clay"}>{done ? (live.status === "settled" ? "Approved and sealed" : "Declined") : "Needs your okay"}</Pill>
      <div className="ask" style={{ marginTop: 12 }}>
        <em>{name}</em> would like to send <em className="num">{fmtMoney(live.fiatAmount)}</em> to {to?.name ?? "someone"}
        {to && <> <Seal state={to.seal} kind={to.kind} size="xs" /></>}
      </div>
      <p className="plain">
        {live.flags.length ? "Here's why it stopped to ask you. Nothing moves until you say so." : "Everything about this looks normal. Nothing moves until you say so."}
      </p>
      <div>
        {live.flags.map((f, i) => <CheckLine key={i} ok={false}>{explainFlag(f, name)}</CheckLine>)}
        {to?.seal === "sealed" && <CheckLine>{to.name} is a sealed {to.kind}. We know who they are.</CheckLine>}
        {a && <CheckLine>Within {name}'s weekly allowance ({fmtMoney(a.policy.weeklyAllowance)})</CheckLine>}
      </div>

      {live.reason && (
        <div style={{ marginTop: 10 }}>
          <button className="btn ghost" style={{ padding: "6px 0" }} onClick={() => setShowWhy(!showWhy)}>{showWhy ? "Hide" : "Ask"} {name} why</button>
          {showWhy && <div className="card tint" style={{ padding: 14, fontSize: 14, marginTop: 6 }}><span className="row" style={{ marginBottom: 6 }}><Seal kind="agent" size="xs" /> <b style={{ fontWeight: 500 }}>{name}</b></span>{live.reason}</div>}
        </div>
      )}

      {!done && (
        <>
          {w && <div className="kv" style={{ marginTop: 10 }}><span>From {name}'s wallet</span><b className="num">{fmtMoney(w.fiatBalance)} → {fmtMoney({ amount: (Number(w.fiatBalance.amount) - Number(live.fiatAmount.amount)).toFixed(2), currency: w.fiatBalance.currency })}</b></div>}
          <div style={{ marginTop: 18 }}>
            <Swipe label="Swipe to approve" doneLabel="Approved and sealed" disabled={!!busy} onDone={() => act("approve")} />
          </div>
          <button className="linkbtn" disabled={!!busy} onClick={() => act("decline")}>{busy === "decline" ? "Declining…" : "Decline"}</button>
          {mins !== null && <div className="hint" style={{ textAlign: "center" }}>Expires in {mins} min. Nothing moves if you do nothing.</div>}
        </>
      )}
      {done && live.status === "settled" && <Sealed><em className="num">{fmtMoney(live.fiatAmount)}</em> to {to?.name ?? "them"}, sealed.</Sealed>}
      {done && <button className="btn lg block" style={{ marginTop: 18 }} onClick={() => setTx(null)}>Done</button>}
    </Sheet>
  );
}

export function ApprovalProvider({ children }: { children: ReactNode }) {
  return <Ctx.Provider value={{ open: (tx) => setter?.(tx) }}>{children}</Ctx.Provider>;
}
