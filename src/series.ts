import type { Transaction, Wallet } from "./api";
import { rangeMs, type Point, type Range } from "./components/Chart";

/**
 * History is derived on the client from settled transactions, so no extra
 * endpoint is needed yet. If the backend later adds GET /wallets/:id/history
 * these helpers are the only place to swap.
 */

const amt = (t: Transaction) => Number(t.fiatAmount.amount);
const settledIn = (txs: Transaction[], walletIds: Set<string>, ownerIds: Set<string>) =>
  txs.filter((t) => t.status === "settled").map((t) => {
    const out = walletIds.has(t.fromWalletId) ? amt(t) : 0;
    const inn = ownerIds.has(t.toPartyId) ? amt(t) : 0;
    return { t: new Date(t.settledAt ?? t.createdAt).getTime(), delta: inn - out };
  }).sort((a, b) => a.t - b.t);

/** Balance over time for a set of wallets, walking backwards from the current total. */
export function balanceSeries(txs: Transaction[], wallets: Wallet[], range: Range, now = Date.now()): Point[] {
  const walletIds = new Set(wallets.map((w) => w.id));
  const ownerIds = new Set(wallets.map((w) => w.ownerId));
  const total = wallets.reduce((s, w) => s + Number(w.fiatBalance.amount), 0);
  const moves = settledIn(txs, walletIds, ownerIds);
  const from = range === "All" ? (moves[0]?.t ?? now - 30 * 864e5) - 864e5 : now - rangeMs[range];
  // balance at each move, backwards
  const pts: Point[] = [{ t: now, v: total }];
  let v = total;
  for (let i = moves.length - 1; i >= 0; i--) {
    pts.push({ t: moves[i].t, v });
    v -= moves[i].delta;
    pts.push({ t: moves[i].t - 1, v });
  }
  pts.push({ t: from, v });
  const inRange = pts.filter((p) => p.t >= from).reverse();
  // make sure there's a start point at `from`
  if (inRange[0]?.t !== from) inRange.unshift({ t: from, v: inRange[0]?.v ?? total });
  return inRange;
}

/** Cumulative spend by one agent since `start`, as a step series. */
export function spendSeries(txs: Transaction[], agentId: string, start: number, now = Date.now()): Point[] {
  const moves = txs.filter((t) => t.status === "settled" && t.initiatedBy === agentId && new Date(t.settledAt ?? t.createdAt).getTime() >= start)
    .map((t) => ({ t: new Date(t.settledAt ?? t.createdAt).getTime(), a: amt(t) })).sort((a, b) => a.t - b.t);
  const pts: Point[] = [{ t: start, v: 0 }];
  let v = 0;
  for (const m of moves) { pts.push({ t: m.t - 1, v }); v += m.a; pts.push({ t: m.t, v }); }
  pts.push({ t: now, v });
  return pts;
}

/** Last N day-end values for a sparkline. */
export function sparkValues(points: Point[], n = 12): number[] {
  if (points.length < 2) return [];
  const t0 = points[0].t, t1 = points[points.length - 1].t;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = t0 + ((t1 - t0) * i) / (n - 1);
    let v = points[0].v;
    for (const p of points) { if (p.t <= t) v = p.v; else break; }
    out.push(v);
  }
  return out;
}

export const startOfWeek = (now = Date.now()) => { const d = new Date(now); const day = (d.getDay() + 6) % 7; d.setHours(0, 0, 0, 0); return d.getTime() - day * 864e5; };
