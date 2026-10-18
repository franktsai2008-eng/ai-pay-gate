import { useState } from "react";
import { fmtMoney, fmtWhen, useStore } from "../store";
import { Empty, PartyIcon, PartyName, StatusPill } from "../components/ui";
import { LearnRail } from "../components/Learn";
import { useApproval } from "../components/Approval";

type Filter = "all" | "me" | "helpers" | "in";

export default function ActivityPage() {
  const { txs, me, party, agents } = useStore();
  const { open } = useApproval();
  const [f, setF] = useState<Filter>("all");
  const agentIds = new Set(agents.map((a) => a.id));
  const list = txs.filter((t) => f === "all" || (f === "me" && t.initiatedBy === me?.id) || (f === "helpers" && agentIds.has(t.initiatedBy)) || (f === "in" && t.toPartyId === me?.id));
  const groups = group(list);
  const weekAgo = Date.now() - 7 * 864e5;
  const week = txs.filter((t) => new Date(t.createdAt).getTime() >= weekAgo);
  const moved = week.filter((t) => t.status === "settled").reduce((s, t) => s + Number(t.fiatAmount.amount), 0);
  const auto = week.filter((t) => t.status === "settled" && agentIds.has(t.initiatedBy) && t.flags.length === 0).length;
  const approved = week.filter((t) => t.status === "settled" && agentIds.has(t.initiatedBy) && t.flags.length > 0).length;
  const declined = week.filter((t) => t.status === "declined").length;

  return (
    <>
      <div className="page-h">
        <div><h1>Activity</h1><div className="sub">Every move, by you or your helpers, with who approved it.</div></div>
        <div className="row" style={{ gap: 6 }}>
          {(["all", "me", "helpers", "in"] as Filter[]).map((k) => <button key={k} className={"btn" + (f === k ? " primary" : "")} style={{ padding: "8px 12px" }} onClick={() => setF(k)}>{{ all: "All", me: "By me", helpers: "By helpers", in: "Received" }[k]}</button>)}
        </div>
      </div>
      <div className="hero" style={{ marginBottom: 6 }}>
        <div className="lbl">Moved this week</div>
        <div className="big" style={{ fontSize: 40 }}>{fmtMoney({ amount: moved.toFixed(2), currency: "USD" })}</div>
        <div className="chg flat">{week.length} payment{week.length !== 1 ? "s" : ""} · {auto} auto, {approved} you approved, {declined} declined</div>
      </div>
      <div className="sec">Learn Sigil</div>
      <LearnRail />
      {groups.length === 0 && <div className="card"><Empty title="Nothing here yet" /></div>}
      {groups.map(([day, items]) => (
        <div key={day}>
          <div className="sec">{day}</div>
          <div className="card" style={{ padding: "4px 22px" }}>
            {items.map((t) => {
              const incoming = t.toPartyId === me?.id; const by = party(t.initiatedBy); const to = party(t.toPartyId);
              return (
                <div key={t.id} className={"li" + (t.status === "pending_approval" ? " click" : "")} onClick={() => t.status === "pending_approval" && open(t)}>
                  <PartyIcon party={incoming ? by : to} kind={t.status === "pending_approval" ? "warn" : incoming ? "in" : undefined} />
                  <div className="t grow">
                    <b className="ellipsis">{incoming ? <PartyName id={t.initiatedBy} /> : <PartyName id={t.toPartyId} />}</b>
                    <span>{[by?.kind === "agent" ? by.name : incoming ? "" : "You", t.memo, fmtWhen(t.createdAt)].filter(Boolean).join(" · ")}</span>
                  </div>
                  <StatusPill tx={t} />
                  <div className={"amt num" + (incoming ? " in" : "")} style={{ minWidth: 86, textDecoration: t.status === "declined" ? "line-through" : undefined, color: t.status === "declined" ? "var(--ink-3)" : undefined }}>{incoming ? "+" : t.status === "pending_approval" ? "" : "−"}{fmtMoney(t.fiatAmount)}</div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}

function group<T extends { createdAt: string }>(list: T[]): [string, T[]][] {
  const m = new Map<string, T[]>();
  const today = new Date().toDateString(), y = new Date(Date.now() - 864e5).toDateString();
  for (const t of list) {
    const d = new Date(t.createdAt).toDateString();
    const k = d === today ? "Today" : d === y ? "Yesterday" : new Date(t.createdAt).toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "short" });
    m.set(k, [...(m.get(k) ?? []), t]);
  }
  return [...m.entries()];
}
