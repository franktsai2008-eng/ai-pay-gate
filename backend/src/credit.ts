/**
 * Credit inputs that come from the money graph (SPEC chapter 4):
 * - independence: is the buyer the seller's own sock puppet? Traced back through who funded whom.
 * - buyer trust: trust that flows out from audited seed accounts through real spending (EigenTrust-style).
 * Pure reads of the state; engine.ts calls these when an order closes and in the nightly recompute.
 */
import { state, usd } from "./store.js";
import type { Agent, WalletInfo } from "./types.js";

const M = 1_000_000;
/** Funding is traced this many hops back. */
const MAX_HOPS = 3;
/** A shared funder only counts if it is this close to both sides. */
const SHARED_HOPS = 2;
/** Trust units for half trust: roughly 1.5 trusted sellers with a few dollars spent at each. */
const HALF_TRUST = 1.5;
/** Buyers whose owner has not verified identity (level 0) never weigh more than this. */
export const UNVERIFIED_TRUST_CAP = 0.2;
const TRUST_ROUNDS = 4;

// ---------- funding graph ----------

function walletOf(address: string): WalletInfo | undefined {
  return state.wallets[address] ?? state.wallets[address.toLowerCase()];
}

export interface FundingHop {
  hops: number;
  /** from the funder down to the wallet we started at */
  path: string[];
}

/** Every wallet that funded this one, directly or up to MAX_HOPS back. */
export function fundingAncestors(address: string, maxHops = MAX_HOPS): Map<string, FundingHop> {
  const start = address.toLowerCase();
  const found = new Map<string, FundingHop>();
  let frontier: { addr: string; path: string[] }[] = [{ addr: start, path: [start] }];
  for (let hop = 1; hop <= maxHops && frontier.length; hop++) {
    const next: typeof frontier = [];
    for (const { addr, path } of frontier) {
      for (const funder of walletOf(addr)?.fundedBy ?? []) {
        const f = funder.toLowerCase();
        if (f === start || found.has(f)) continue;
        const p = [f, ...path];
        found.set(f, { hops: hop, path: p });
        next.push({ addr: f, path: p });
      }
    }
    frontier = next;
  }
  return found;
}

const hopsText = (n: number) => (n === 1 ? "directly" : `${n} hops back`);

/** On a scam or sanctions list. */
export function isKnownBad(address: string): boolean {
  const w = walletOf(address);
  return Boolean(w?.scamList || w?.sanctioned);
}

/** Wallets this one sent money to (the graph only stores "funded by", so look the other way). */
export function fundedWallets(address: string): WalletInfo[] {
  const a = address.toLowerCase();
  return Object.values(state.wallets).filter((w) => w.fundedBy.some((f) => f.toLowerCase() === a));
}

/** New wallet with a single source of money that already passed it on: typical of a pass-through or mule. */
export function looksPassThrough(w: WalletInfo, at: number): boolean {
  return at - w.createdAt < 7 * 86_400_000 && w.fundedBy.length === 1 && fundedWallets(w.address).length > 0;
}

// ---------- purchases (who spent how much at which seller) ----------

export interface Purchase {
  buyer: string;
  seller: string;
  amountMicro: number;
  at: number;
}

function sellerAt(address: string): Agent | undefined {
  const a = address.toLowerCase();
  const byWallet = Object.values(state.agents).find((x) => x.seller && x.walletAddress.toLowerCase() === a);
  if (byWallet) return byWallet;
  const listing = Object.values(state.listings).find((l) => l.payTo.toLowerCase() === a);
  return listing ? state.agents[listing.sellerAgentId] : undefined;
}

/** Paid payments to sellers, plus pre-demo trades that have no payment record. */
export function purchases(): Purchase[] {
  const out: Purchase[] = [];
  for (const p of Object.values(state.payments)) {
    if (p.status !== "paid") continue;
    const seller = sellerAt(p.payTo);
    if (seller && seller.id !== p.agentId) out.push({ buyer: p.agentId, seller: seller.id, amountMicro: p.amountMicro, at: p.createdAt });
  }
  for (const t of state.trades) if (!t.orderId) out.push({ buyer: t.buyerAgentId, seller: t.sellerAgentId, amountMicro: t.amountMicro, at: t.at });
  return out;
}

/**
 * The buyer only trades inside a small closed group: it buys from at most 3 sellers, at least 3 buyers
 * buy from those sellers, none of those buyers buys anywhere else, and none of those sellers has
 * customers outside (audited, or history from before what we see here).
 */
export function inClosedGroup(buyerId: string, ps: Purchase[]): boolean {
  const sellersOf = (b: string) => new Set(ps.filter((p) => p.buyer === b).map((p) => p.seller));
  const group = sellersOf(buyerId);
  if (group.size === 0 || group.size > 3) return false;
  for (const sellerId of group) {
    const seller = state.agents[sellerId];
    if (!seller || seller.preTrusted || (seller.seller?.baselineDistinctBuyers ?? 0) > 0) return false;
  }
  const buyers = new Set(ps.filter((p) => group.has(p.seller)).map((p) => p.buyer));
  if (buyers.size < 3) return false;
  for (const b of buyers) for (const s of sellersOf(b)) if (!group.has(s)) return false;
  return true;
}

// ---------- independence ----------

export type IndependenceCode =
  | "SAME_OWNER"
  | "FUNDED_BY_SELLER"
  | "FUNDED_THE_SELLER"
  | "SHARED_FUNDING"
  | "RING"
  | "CLOSED_GROUP"
  | "CLEAN_FUNDING"
  | "FUNDING_UNKNOWN";

export interface IndependenceDetail {
  value: 0 | 0.3 | 1;
  code: IndependenceCode;
  reason: string;
  /** wallets along the funding link, for the graph view; never shown on the public page */
  path?: string[];
}

/** SPEC 4: checked in this order; the first match decides. */
export function independenceDetail(buyer: Agent, seller: Agent, ps: Purchase[] = purchases()): IndependenceDetail {
  if (buyer.ownerId === seller.ownerId) return { value: 0, code: "SAME_OWNER", reason: "Buyer and seller belong to the same verified owner." };

  const b = buyer.walletAddress.toLowerCase();
  const s = seller.walletAddress.toLowerCase();
  const buyerFunders = fundingAncestors(b);
  const sellerFunders = fundingAncestors(s);

  const viaSeller = buyerFunders.get(s);
  if (viaSeller) return { value: 0, code: "FUNDED_BY_SELLER", reason: `The buyer's wallet was funded by the seller (${hopsText(viaSeller.hops)}).`, path: viaSeller.path };
  const viaBuyer = sellerFunders.get(b);
  if (viaBuyer) return { value: 0, code: "FUNDED_THE_SELLER", reason: `The buyer funded the seller's wallet (${hopsText(viaBuyer.hops)}).`, path: viaBuyer.path };

  // Exchanges fund almost everyone, so a shared exchange says nothing.
  for (const [funder, fromBuyer] of buyerFunders) {
    if (fromBuyer.hops > SHARED_HOPS || walletOf(funder)?.exchange) continue;
    const fromSeller = sellerFunders.get(funder);
    if (fromSeller && fromSeller.hops <= SHARED_HOPS)
      return { value: 0, code: "SHARED_FUNDING", reason: "Buyer and seller were funded from the same wallet.", path: [...fromBuyer.path].reverse().concat(fromSeller.path.slice(1)) };
  }

  if (walletOf(b)?.ring) return { value: 0, code: "RING", reason: "The buyer's wallet is part of a known rating ring." };
  if (inClosedGroup(buyer.id, ps)) return { value: 0, code: "CLOSED_GROUP", reason: "The buyer has only bought inside a small group of accounts with no outside customers." };

  // Clean: an exchange, or the buyer's OWN owner's verified wallet (someone else's verified wallet proves nothing).
  const ownWallet = state.owners[buyer.ownerId]?.withdrawAddress.toLowerCase();
  const isOwn = (address: string, w: WalletInfo) => (w.ownerId ? w.ownerId === buyer.ownerId : address === ownWallet);
  for (const [funder, info] of buyerFunders) {
    if (info.hops > SHARED_HOPS) continue;
    const w = walletOf(funder);
    if (w?.exchange) return { value: 1, code: "CLEAN_FUNDING", reason: "The buyer's money comes from an exchange, with no link to the seller." };
    if (w?.verifiedOwnerWallet && isOwn(funder, w))
      return { value: 1, code: "CLEAN_FUNDING", reason: "The buyer's money comes from its owner's verified wallet, with no link to the seller." };
  }
  return { value: 0.3, code: "FUNDING_UNKNOWN", reason: "We can't tell where the buyer's money came from." };
}

// ---------- buyer trust ----------

export interface TrustDetail {
  value: number;
  trustedSellers: number;
  trustedSpendMicro: number;
  reason: string;
}

/** Saturates after a few dollars at one seller, so breadth across trusted sellers matters more than size. */
const perSeller = (spendMicro: number) => 1 - Math.pow(0.5, spendMicro / M);
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export interface Trust {
  /** each AI's overall buyer trust */
  buyers: Map<string, TrustDetail>;
  sellers: Map<string, number>;
  /**
   * Trust used when this buyer rates this seller: spending at that seller, or at any other seller
   * with the same owner, doesn't count, so a seller can't make its puppets' ratings matter by selling to them.
   */
  forRating(buyerId: string, sellerId: string): TrustDetail;
}

/**
 * Trust starts at audited seed accounts (agent.preTrusted) and spreads through real spending:
 * buyers who spent at trusted sellers become trusted; new sellers bought from by trusted, independent
 * buyers become trusted; repeat. A group that only trades with itself never connects to a seed, so
 * its trust stays near 0. Wallet age plays no part, so buying an old wallet doesn't help.
 */
export function computeTrust(ps: Purchase[] = purchases()): Trust {
  const agents = Object.values(state.agents);
  const spend = new Map<string, Map<string, number>>();
  for (const p of ps) {
    const m = spend.get(p.buyer) ?? new Map<string, number>();
    m.set(p.seller, (m.get(p.seller) ?? 0) + p.amountMicro);
    spend.set(p.buyer, m);
  }

  const independent = new Map<string, number>();
  const indep = (buyerId: string, sellerId: string) => {
    const key = `${buyerId}>${sellerId}`;
    if (!independent.has(key)) independent.set(key, independenceDetail(state.agents[buyerId], state.agents[sellerId], ps).value);
    return independent.get(key)!;
  };

  const sellerTrust = new Map<string, number>(agents.filter((a) => a.seller).map((a) => [a.id, a.preTrusted ? 1 : 0]));
  const capOf = (a: Agent) => (state.owners[a.ownerId]?.badgeLevel === 0 ? UNVERIFIED_TRUST_CAP : 1);
  const toTrust = (a: Agent, units: number) => (a.preTrusted ? 1 : Math.min(1 - Math.pow(0.5, units / HALF_TRUST), capOf(a)));
  /** trust units a buyer earned at each seller */
  const unitsAt = (buyerId: string) => {
    const out = new Map<string, number>();
    for (const [sellerId, micro] of spend.get(buyerId) ?? []) out.set(sellerId, (sellerTrust.get(sellerId) ?? 0) * perSeller(micro));
    return out;
  };
  /** Sellers run by the same owner as `sellerId`: none of them count when that seller is rated. */
  const sameOwner = (sellerId?: string) => {
    const owner = sellerId ? state.agents[sellerId]?.ownerId : undefined;
    return (id: string) => Boolean(owner) && state.agents[id]?.ownerId === owner;
  };
  const sum = (m: Map<string, number>, skipSeller?: string) => {
    const skip = sameOwner(skipSeller);
    return [...m].reduce((acc, [k, v]) => (skip(k) ? acc : acc + v), 0);
  };

  for (let round = 0; round < TRUST_ROUNDS; round++) {
    const units = new Map(agents.map((a) => [a.id, unitsAt(a.id)]));
    for (const s of agents) {
      if (!s.seller || s.preTrusted) continue;
      let earned = 0;
      for (const [buyerId, m] of spend) {
        const micro = m.get(s.id);
        const buyer = state.agents[buyerId];
        if (micro && buyer) earned += toTrust(buyer, sum(units.get(buyerId)!, s.id)) * perSeller(micro) * indep(buyerId, s.id);
      }
      sellerTrust.set(s.id, 1 - Math.pow(0.5, earned / HALF_TRUST));
    }
  }

  const detail = (buyerId: string, skipSeller?: string): TrustDetail => {
    const a = state.agents[buyerId];
    if (!a) return { value: 0, trustedSellers: 0, trustedSpendMicro: 0, reason: "Unknown buyer." };
    const value = round3(toTrust(a, sum(unitsAt(buyerId), skipSeller)));
    let trustedSellers = 0;
    let trustedSpendMicro = 0;
    const skip = sameOwner(skipSeller);
    for (const [sellerId, micro] of spend.get(buyerId) ?? []) {
      if (!skip(sellerId) && (sellerTrust.get(sellerId) ?? 0) >= 0.5) {
        trustedSellers += 1;
        trustedSpendMicro += micro;
      }
    }
    const other = skipSeller ? " other" : "";
    const capped = capOf(a) < 1 && value >= UNVERIFIED_TRUST_CAP;
    const reason = a.preTrusted
      ? "Audited account: one of the trust seeds."
      : value === 0
        ? `Has not spent money at any${other} trusted seller yet.`
        : `Spent ${usd(trustedSpendMicro)} at ${trustedSellers}${other} trusted seller${trustedSellers === 1 ? "" : "s"}.` +
          (capped ? ` Capped at ${UNVERIFIED_TRUST_CAP} until the owner verifies their identity.` : "");
    return { value, trustedSellers, trustedSpendMicro, reason };
  };

  return {
    buyers: new Map(agents.map((a) => [a.id, detail(a.id)])),
    sellers: new Map([...sellerTrust].map(([k, v]) => [k, round3(v)])),
    forRating: (buyerId, sellerId) => detail(buyerId, sellerId),
  };
}
