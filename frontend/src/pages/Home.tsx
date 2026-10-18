import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowDownLeft, ArrowUpRight, MessageCircle, Plus } from "lucide-react";
import { fmtMoney, fmtWhen, useStore } from "../store";
import { PartyIcon, PartyName, Pill, Seal } from "../components/ui";
import { LineChart, Ranges, Sparkline, type Point, type Range } from "../components/Chart";
import { balanceSeries, sparkValues, spendSeries, startOfWeek } from "../series";
import { useApproval } from "../components/Approval";
import { provName } from "../components/Shell";

const usd = (n: number) => fmtMoney({ amount: n.toFixed(2), currency: "USD" });

export default function HomePage() {
  const { ready, me, wallets, agents, txs, party, agent } = useStore();
  const nav = useNavigate();
  const { open } = useApproval();
  const [range, setRange] = useState<Range>("1W");
  const [scrub, setScrub] = useState<Point | null>(null);

  const series = useMemo(() => balanceSeries(txs, wallets, range), [txs, wallets, range]);
  const weekStart = useMemo(() => startOfWeek(), []);

  if (!ready) return <div className="stack"><div className="skeleton" style={{ height: 40, width: 300 }} /><div className="skeleton" style={{ height: 320 }} /><div className="skeleton" style={{ height: 240 }} /></div>;

  const total = wallets.reduce((s, w) => s + Number(w.fiatBalance.amount), 0);
  const first = series[0]?.v ?? total;
  const shown = scrub ? scrub.v : total;
  const diff = shown - first;
  const pct = first ? (diff / first) * 100 : 0;
  const waiting = txs.filter((t) => t.status === "pending_approval");
  const live = agents.filter((a) => a.seal === "sealed").length;
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const mine = wallets.find((w) => w.ownerId === me?.id);
  const rangeWord = { "1D": "today", "1W": "this week", "1M": "this month", "3M": "in 3 months", "1Y": "this year", All: "all time" }[range];

  return (
    <>
      <div className="page-h">
        <div>
          <h1>{greet}, {me?.name}</h1>
          <div className="sub">{waiting.length ? `${waiting.length} thing${waiting.length > 1 ? "s" : ""} waiting on you.` : "Everything's quiet."} {live} helper{live !== 1 ? "s" : ""} working.</div>
        </div>
      </div>

      <div className="grid2" style={{ alignItems: "start" }}>
        <div className="card hero">
          <div className="lbl">{scrub ? fmtWhen(new Date(scrub.t).toISOString()) : "Yours and your helpers'"}</div>
          <div className="big">{usd(shown)}</div>
          <div className={"chg" + (diff < 0 ? " down" : Math.abs(diff) < 0.005 ? " flat" : "")}>
            {Math.abs(diff) < 0.005 ? `No change ${rangeWord}` : `${diff > 0 ? "▲" : "▼"} ${usd(Math.abs(diff))} (${Math.abs(pct).toFixed(2)}%) ${rangeWord}`}
          </div>
          <LineChart points={series} baseline={first} onScrub={setScrub} format={usd} formatTime={(t) => fmtWhen(new Date(t).toISOString())} />
          <Ranges value={range} onChange={setRange} />
          <div className="row" style={{ gap: 10, marginTop: 16 }}>
            <button className="btn lg primary grow" onClick={() => nav("/send")}><ArrowUpRight /> Send</button>
            <button className="btn lg grow" onClick={() => nav("/you")}><ArrowDownLeft /> Receive</button>
            <button className="btn lg grow" onClick={() => nav("/helpers")}><MessageCircle /> Ask Sigil</button>
          </div>
        </div>

        <div>
          {waiting.map((t) => {
            const a = agent(t.initiatedBy);
            return (
              <div key={t.id} className="notice" style={{ marginBottom: 14 }} onClick={() => open(t)}>
                <Seal kind="agent" size="sm" />
                <span><b style={{ fontWeight: 500 }}>{a?.name ?? "A helper"}</b> wants to pay {party(t.toPartyId)?.name} <b className="num" style={{ fontWeight: 500 }}>{fmtMoney(t.fiatAmount)}</b></span>
                <span className="arrow">Review →</span>
              </div>
            );
          })}
          <div className="card">
            <div className="between"><h3>Your helpers</h3><button className="btn ghost small" onClick={() => nav("/helpers")}>See all</button></div>
            <div className="list" style={{ marginTop: 6 }}>
              {mine && (
                <div className="li click" onClick={() => nav("/activity")}>
                  <PartyIcon party={me ?? undefined} />
                  <div className="t grow"><b>Me <Seal size="xs" /></b><span>Main wallet · {mine.address}</span></div>
                  <Sparkline values={sparkValues(balanceSeries(txs, [mine], "1W"))} color="var(--char)" />
                  <div className="amt num">{fmtMoney(mine.fiatBalance)}</div>
                </div>
              )}
              {agents.map((a) => {
                const w = wallets.find((x) => x.id === a.walletId);
                const paused = a.seal !== "sealed";
                return (
                  <div key={a.id} className="li click" onClick={() => nav(`/helpers/${a.id}`)}>
                    <PartyIcon party={a} />
                    <div className="t grow">
                      <b className="row" style={{ gap: 8 }}>{a.name} <Pill tone={paused ? undefined : "sage"} live={!paused}>{paused ? "paused" : "live"}</Pill></b>
                      <span>{provName(a.provider)} · {fmtMoney(a.spentThisWeek)} of {fmtMoney(a.policy.weeklyAllowance)} this week</span>
                    </div>
                    <Sparkline values={sparkValues(spendSeries(txs, a.id, weekStart))} flat={paused} />
                    <div className="amt num">{w ? fmtMoney(w.fiatBalance) : ""}<small>{paused ? "paused" : "live"}</small></div>
                  </div>
                );
              })}
              <button className="li click" style={{ color: "var(--sage)", fontWeight: 500 }} onClick={() => nav("/helpers/new")}><div className="ic agent"><Plus /></div>Add a helper</button>
            </div>
          </div>
        </div>
      </div>

      <div className="sec">Today & recent <a onClick={() => nav("/activity")} style={{ cursor: "pointer" }}>See all</a></div>
      <div className="card" style={{ padding: "4px 22px" }}>
        {txs.slice(0, 5).map((t) => {
          const incoming = t.toPartyId === me?.id;
          const by = party(t.initiatedBy);
          const to = party(t.toPartyId);
          const pending = t.status === "pending_approval";
          return (
            <div key={t.id} className="li click" onClick={() => pending ? open(t) : nav("/activity")}>
              <PartyIcon party={incoming ? by : to} kind={pending ? "warn" : incoming ? "in" : undefined} />
              <div className="t grow">
                <b className="ellipsis">{incoming ? `${by?.name} sent you money` : by?.kind === "agent" ? `${by.name} ${pending ? "wants to pay" : "paid"} ${to?.name}` : to?.name}</b>
                <span>{pending ? "Waiting for you · " : t.memo ? t.memo + " · " : ""}{fmtWhen(t.createdAt)}{by?.kind === "agent" && !pending && t.status === "settled" ? " · auto-approved" : ""}</span>
              </div>
              <div className={"amt num" + (incoming ? " in" : "")}>{incoming ? "+" : pending ? "" : "−"}{fmtMoney(t.fiatAmount)}{pending && <small>waiting</small>}</div>
            </div>
          );
        })}
      </div>

      <div className="sec" style={{ marginTop: 28 }}>Who you deal with most</div>
      <div className="card">
        <div className="small muted" style={{ marginBottom: 10 }}>Everyone here is sealed, so you know who they are.</div>
        {topParties(txs).map(([pid, n], _i, arr) => (
          <div key={pid} className="row" style={{ padding: "9px 0", gap: 14 }}>
            <div style={{ width: 120, flex: "none" }}><PartyName id={pid} /></div>
            <div className="bar grow"><i className={party(pid)?.kind === "agent" ? "sage" : ""} style={{ width: `${(n / arr[0][1]) * 100}%` }} /></div>
            <div className="small muted num" style={{ width: 56, textAlign: "right" }}>{n} txn{n > 1 ? "s" : ""}</div>
          </div>
        ))}
      </div>
    </>
  );
}

function topParties(txs: { toPartyId: string; initiatedBy: string; status: string }[]) {
  const m = new Map<string, number>();
  txs.filter((t) => t.status === "settled").forEach((t) => { m.set(t.toPartyId, (m.get(t.toPartyId) ?? 0) + 1); if (t.initiatedBy !== "p_me") m.set(t.initiatedBy, (m.get(t.initiatedBy) ?? 0) + 1); });
  m.delete("p_me");
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
}
