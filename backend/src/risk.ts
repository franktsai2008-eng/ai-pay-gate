/**
 * Risk score (SPEC chapter 5): "how likely is this account a fraudster or a fraudster's helper?"
 * Separate from credit, so a scam victim and a scam helper don't end up with the same number.
 * Risk only spreads out from confirmed bad accounts (banned by arbitration), never from suspicion.
 * Pure reads of the state; engine.ts applies the result (riskStatus feeds the gate's payee check).
 */
import { state } from "./store.js";
import type { Agent, RiskLevel, RiskReason } from "./types.js";
import { fundingAncestors, inClosedGroup, type Purchase } from "./credit.js";

const DAY = 86_400_000;

export function levelFor(points: number): RiskLevel {
  if (points >= 80) return "suspended";
  if (points >= 60) return "restricted";
  if (points >= 30) return "watch";
  return "none";
}

/** Every address money for this agent can arrive at: its wallet and its listings. */
function addressesOf(a: Agent): Set<string> {
  const out = new Set([a.walletAddress.toLowerCase()]);
  for (const l of Object.values(state.listings)) if (l.sellerAgentId === a.id) out.add(l.payTo.toLowerCase());
  return out;
}

const LOSS: ReadonlySet<string> = new Set(["failed", "refunded", "no_result"]);

/**
 * A victim complained about a bad account or lost money to it. For a victim, every link to that
 * account is wiped (and in the full product it is paid back from the bad account's deposit).
 */
function isVictim(a: Agent, badIds: Set<string>, badAddresses: Set<string>): boolean {
  const lost = state.trades.some((t) => t.buyerAgentId === a.id && badIds.has(t.sellerAgentId) && LOSS.has(t.outcome));
  const reported = state.reports.some((r) => {
    const p = state.payments[r.paymentId];
    return r.ownerId === a.ownerId && p?.agentId === a.id && badAddresses.has(p.payTo.toLowerCase());
  });
  return lost || reported;
}

export interface RiskResult {
  points: number;
  level: RiskLevel;
  reasons: RiskReason[];
}

export function riskOf(a: Agent, ps: Purchase[], at: number): RiskResult {
  const bad = Object.values(state.agents).filter((x) => x.banned && x.ownerId !== a.ownerId);
  if (a.banned || bad.length === 0) return { points: 0, level: "none", reasons: [] };
  const badIds = new Set(bad.map((x) => x.id));
  const badAddresses = new Set(bad.flatMap((x) => [...addressesOf(x)]));
  const linked: RiskReason[] = [];
  const add = (code: string, points: number, message: string) => linked.push({ code, points: Math.round(points * 10) / 10, message });

  // money: was this wallet opened with a bad account's money?
  let hops = Infinity;
  for (const [funder, info] of fundingAncestors(a.walletAddress, 2)) if (badAddresses.has(funder)) hops = Math.min(hops, info.hops);
  if (hops === 1) add("FUNDED_BY_BAD", 40, "Its wallet was funded by a banned account.");
  else if (hops === 2) add("FUNDED_NEAR_BAD", 20, "Its wallet was funded by a banned account, with one wallet in between.");

  // ratings: kept giving a bad seller good ratings and never complained
  const goodRatings = state.trades.filter((t) => t.buyerAgentId === a.id && badIds.has(t.sellerAgentId) && t.outcome === "accepted").length;
  if (goodRatings >= 10) add("RATED_BAD_OFTEN", 30, `It gave a banned seller ${goodRatings} good ratings and never complained.`);
  else if (goodRatings >= 3) add("RATED_BAD", 20, `It gave a banned seller ${goodRatings} good ratings and never complained.`);

  // share of its trades that were with bad accounts; too few trades to conclude much
  const mine = ps.filter((p) => p.buyer === a.id || p.seller === a.id);
  const withBad = mine.filter((p) => badIds.has(p.buyer) || badIds.has(p.seller));
  if (withBad.length) {
    const share = withBad.length / mine.length;
    const pts = mine.length < 3 ? Math.min(10, 30 * share) : 30 * share;
    add("TRADES_WITH_BAD", pts, `${Math.round(share * 100)}% of its trades were with banned accounts${mine.length < 3 ? " (few trades, so this counts less)" : ""}.`);
  }

  // took money from a bad account (it sold, the bad account bought)
  if (ps.some((p) => p.seller === a.id && badIds.has(p.buyer))) add("PAID_BY_BAD", 15, "It received money from a banned account.");

  // a small group that only trades inside itself, with a bad account in it
  if (inClosedGroup(a.id, ps)) {
    const groupSellers = new Set(ps.filter((p) => p.buyer === a.id).map((p) => p.seller));
    if ([...groupSellers].some((s) => badIds.has(s))) add("GROUP_WITH_BAD", 20, "It only trades inside a small closed group that includes a banned account.");
  }

  // showed up with a bad account and went quiet when it was banned
  const w = state.wallets[a.walletAddress.toLowerCase()];
  const quiet = (since: number) =>
    !Object.values(state.payments).some((p) => p.agentId === a.id && p.createdAt > since) &&
    !state.trades.some((t) => (t.buyerAgentId === a.id || t.sellerAgentId === a.id) && t.at > since);
  const twin = bad.find((b) => {
    const bw = state.wallets[b.walletAddress.toLowerCase()];
    return w && bw && Math.abs(w.createdAt - bw.createdAt) < 3 * DAY && quiet(b.banned!.at);
  });
  if (twin) add("CAME_AND_WENT_WITH_BAD", 15, "It appeared at the same time as a banned account and went quiet when that account was banned.");

  const reasons: RiskReason[] = [];
  let counted = linked;
  if (linked.length && isVictim(a, badIds, badAddresses)) {
    // A victim pays the scammer and then complains; a helper takes its money and praises it. Links are wiped,
    // except a wallet opened with the scammer's own money (Frank 10/18, 2A): a real victim's wallet never is,
    // so a scammer can't wash a helper by "failing" one small order to it.
    counted = linked.filter((r) => r.code === "FUNDED_BY_BAD");
    reasons.push({
      code: "VICTIM",
      points: 0,
      message: counted.length
        ? "It lost money to or complained about a banned account, so those links are ignored, except that its wallet was opened with that account's money."
        : "It lost money to or complained about a banned account, so it counts as a victim: those links are ignored.",
    });
  }
  reasons.push(...counted);
  // these only lower risk that comes from links; with no links there is nothing to offset
  if (counted.length) {
    const partners = new Set(mine.filter((p) => !withBad.includes(p)).map((p) => (p.buyer === a.id ? p.seller : p.buyer)).filter((id) => state.agents[id]?.ownerId !== a.ownerId));
    if (partners.size >= 5) reasons.push({ code: "NORMAL_PARTNERS", points: -20, message: `It also trades normally with ${partners.size} other accounts.` });
    if ((state.owners[a.ownerId]?.badgeLevel ?? 0) >= 2) reasons.push({ code: "VERIFIED_ID", points: -10, message: "Its owner verified with ID and selfie." });
  }
  let points = Math.max(0, reasons.reduce((s, r) => s + r.points, 0));

  // 30 days without a new signal: halve
  const lastSignal = Math.max(0, ...withBad.map((p) => p.at));
  if (points > 0 && lastSignal > 0 && at - lastSignal > 30 * DAY) {
    reasons.push({ code: "QUIET_30_DAYS", points: -Math.round((points / 2) * 10) / 10, message: "Nothing new in 30 days, so the points are halved." });
    points = points / 2;
  }
  points = Math.round(points * 10) / 10;
  return { points, level: levelFor(points), reasons };
}
