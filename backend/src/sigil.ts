/**
 * Sigil adapter: serves the frontend's contract (frontend/contract/openapi.yaml, frontend/src/api/types.ts)
 * on top of the gate engine. Nothing here decides anything; every payment still goes through evaluate(),
 * the approvals are the same approvals, and the owner token is the same owner token.
 *
 * Mounted at /v1 (frontend: VITE_API_URL=<backend>/v1).
 */
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import type { Agent, FeedEvent, Owner, Payment, PaymentStatus, Reason, Rules, SigilSend } from "./types.js";
import { markDirty, nextId, now, randomToken, shortAddr, state } from "./store.js";
import { ApiError, approve, getAgent, ownerOf, pauseAgent, payeeAgentFor, reject, spentSince } from "./engine.js";
import { addr } from "./seed.js";
import { checkPasscode } from "./routes.js";

const DAY = 86_400_000;
const M = 1_000_000;
/** the owner's main wallet starts here (simulated, like every balance) */
const MAIN_START_MICRO = 3000 * M;

type Money = { amount: string; currency: "USD" | "USDC" };
type SealState = "sealed" | "unsealed" | "paused";
type TxStatus = "pending_approval" | "approved" | "declined" | "settled" | "failed" | "expired";
type Flag =
  | { code: "over_auto_limit"; limit: Money }
  | { code: "new_payee" }
  | { code: "unsealed_payee" }
  | { code: "over_weekly_allowance"; remaining: Money }
  | { code: "unusual_time" };

const usd = (micro: number): Money => ({ amount: (micro / M).toFixed(2), currency: "USD" });
const usdc = (micro: number): Money => ({ amount: (micro / M).toFixed(2), currency: "USDC" });
const iso = (t: number) => new Date(t).toISOString();

function toMicro(m: unknown, field: string): number {
  const raw = typeof m === "object" && m !== null && "amount" in m ? (m as { amount: unknown }).amount : m;
  const n = Number(raw);
  if (typeof raw !== "string" && typeof raw !== "number") throw new ApiError(400, "BAD_REQUEST", `${field} must be money like { "amount": "20.00", "currency": "USD" }.`);
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) throw new ApiError(400, "BAD_REQUEST", `${field} must be a non-negative decimal string.`);
  return Math.round(n * M);
}

/** Where the MCP server should point. The deployed URL comes from the environment. */
function apiBase(c: Context): string {
  if (process.env.PUBLIC_API_BASE) return process.env.PUBLIC_API_BASE;
  const url = new URL(c.req.url);
  return `${url.protocol}//${url.host}/api/v1`;
}

// ---------- auth ----------

function bearer(c: Context): string {
  const h = c.req.header("Authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}

function ownerByToken(token: string): Owner {
  const owner = Object.values(state.owners).find((o) => o.token === token);
  if (!token || !owner) throw new ApiError(401, "UNAUTHORIZED", "Please sign in again.");
  return owner;
}

const ownerAuth = (c: Context) => ownerByToken(bearer(c));

async function body<T>(c: Context): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    return {} as T;
  }
}

// ---------- views ----------

function ownerAgents(owner: Owner): Agent[] {
  return Object.values(state.agents).filter((a) => a.ownerId === owner.id && a.rules && !a.removedAt);
}

function ownedAgent(owner: Owner, id: string): Agent {
  const a = state.agents[id];
  if (!a || a.ownerId !== owner.id || !a.rules || a.removedAt) throw new ApiError(404, "NOT_FOUND", "No such helper.");
  return a;
}

const sealOf = (badge: number): SealState => (badge >= 1 ? "sealed" : "unsealed");

function personView(o: Owner) {
  const wallet = state.wallets[o.withdrawAddress];
  const at = iso(wallet?.createdAt ?? now());
  return {
    id: o.id,
    kind: "person" as const,
    name: o.name,
    seal: sealOf(o.badgeLevel),
    sealedAt: o.badgeLevel >= 1 ? at : undefined,
    email: o.email,
    displayCurrency: "USD" as const,
    verification: o.badgeLevel >= 1 ? { status: "verified" as const, method: o.badgeLevel >= 2 ? ("id" as const) : ("passkey" as const), at } : { status: "none" as const },
  };
}

function businessView(a: Agent) {
  return {
    id: a.id,
    kind: "business" as const,
    name: a.name,
    seal: a.banned ? ("unsealed" as const) : sealOf(ownerOf(a).badgeLevel),
    sealedAt: iso(state.wallets[a.walletAddress]?.createdAt ?? now()),
  };
}

const addrPartyId = (address: string) => `addr:${address.toLowerCase()}`;

function addrParty(address: string) {
  return { id: addrPartyId(address), kind: "business" as const, name: shortAddr(address), seal: "unsealed" as const };
}

/** A payee as the UI knows it: a seller we know, an agent, or a raw address. */
function partyIdFor(address: string): string {
  return payeeAgentFor(address)?.id ?? addrPartyId(address);
}

function addressForParty(partyId: string): string {
  if (partyId.startsWith("addr:")) {
    const a = partyId.slice(5);
    if (!/^0x[a-f0-9]{40}$/.test(a)) throw new ApiError(400, "BAD_REQUEST", "That address is not valid.");
    return a;
  }
  const agent = state.agents[partyId];
  if (agent) return agent.walletAddress;
  const owner = state.owners[partyId];
  if (owner) return owner.withdrawAddress;
  throw new ApiError(404, "NOT_FOUND", "No such party.");
}

function mainBalance(o: Owner): number {
  return o.mainBalanceMicro ?? MAIN_START_MICRO;
}

function sends(o: Owner): SigilSend[] {
  return (state.sigilSends ?? []).filter((s) => s.ownerId === o.id);
}

function mainWallet(o: Owner) {
  const t = now();
  const out24h = sends(o).filter((s) => s.at >= t - DAY).reduce((sum, s) => sum + s.amountMicro, 0);
  const bal = mainBalance(o);
  // addresses are shown, not pasted (the UI's own sample data shortens them too)
  return { id: `w_${o.id}`, ownerId: o.id, label: "Main", address: shortAddr(o.withdrawAddress), balance: usdc(bal), fiatBalance: usd(bal), change24h: usd(-out24h) };
}

function agentWallet(a: Agent) {
  return {
    id: `w_${a.id}`,
    ownerId: a.id,
    label: a.name,
    address: shortAddr(a.walletAddress),
    balance: usdc(a.balanceMicro),
    fiatBalance: usd(a.balanceMicro),
    change24h: usd(-spentSince(a.id, now() - DAY)),
  };
}

/** Monday 00:00 in the server's local time, same formula as the UI's series.ts. */
export function startOfWeek(t: number): number {
  const d = new Date(t);
  const day = (d.getDay() + 6) % 7;
  d.setHours(0, 0, 0, 0);
  return d.getTime() - day * DAY;
}

function agentSeal(a: Agent): SealState {
  if (a.banned || a.status === "paused") return "paused";
  return sealOf(ownerOf(a).badgeLevel);
}

function policyView(r: Rules) {
  return {
    autoApproveUpTo: usd(r.autonomy === "ask_always" ? 0 : r.autoLimitMicro),
    // The gate's cap is per 24 hours; the UI calls it a weekly allowance. Same number, shorter window.
    weeklyAllowance: usd(r.dailyCapMicro),
    allowedPayees: r.allowlist.map((x) => partyIdFor(x.address)),
    canAddPayees: false,
    canWithdraw: false,
    canViewBalances: true,
  };
}

function agentView(a: Agent, c?: Context) {
  const pays = Object.values(state.payments).filter((p) => p.agentId === a.id);
  const last = pays.reduce((m, p) => Math.max(m, p.createdAt), 0);
  const created = a.createdAt ?? state.wallets[a.walletAddress]?.createdAt ?? now();
  return {
    id: a.id,
    kind: "agent" as const,
    name: a.name,
    seal: agentSeal(a),
    sealedAt: iso(created),
    ownerId: a.ownerId,
    provider: a.provider ?? (/claude/i.test(a.name) ? "claude" : "other"),
    purpose: a.purpose ?? "Pays for things on its owner's behalf",
    walletId: `w_${a.id}`,
    policy: policyView(a.rules!),
    spentThisWeek: usd(spentSince(a.id, startOfWeek(now()))),
    lastActiveAt: last ? iso(last) : undefined,
    mcp: { url: c ? apiBase(c) : "", keyHint: a.token.slice(-4), connected: Boolean(a.mcpConnected) },
  };
}

const STATUS: Record<PaymentStatus, TxStatus> = {
  paid: "settled",
  sending: "approved",
  awaiting_owner: "pending_approval",
  blocked: "declined",
  rejected: "declined",
  cancelled: "expired",
  failed: "failed",
};

/** Reasons that mean "we don't know who is behind this address". */
const UNSEALED_CODES = new Set(["PAYEE_UNVERIFIED", "UNKNOWN_ORIGIN", "YOUNG_WALLET", "NEAR_BAD", "RING", "PASS_THROUGH", "DIRECT_BAD_LINK", "PAYEE_SCAM_LIST", "PAYEE_SANCTIONED"]);
const ALLOWANCE_CODES = new Set(["CAP_DAILY", "AUTO_TOTAL_24H", "BUDGET_EMPTY", "CAP_PER_TX"]);

/** The gate's reasons, in the five words the UI knows. Reasons with no equivalent go into the memo. */
export function flagsFor(p: Payment, a: Agent): Flag[] {
  const r = a.rules!;
  const out: Flag[] = [];
  const have = new Set<string>();
  const push = (f: Flag) => {
    if (have.has(f.code)) return;
    have.add(f.code);
    out.push(f);
  };
  for (const x of p.reasons) {
    if (x.code === "AUTONOMY_OVER_AUTO_LIMIT" || x.code === "AUTONOMY_ASK_ALWAYS") push({ code: "over_auto_limit", limit: usd(r.autonomy === "ask_always" ? 0 : r.autoLimitMicro) });
    else if (x.code === "NEW_PAYEE") push({ code: "new_payee" });
    else if (ALLOWANCE_CODES.has(x.code)) push({ code: "over_weekly_allowance", remaining: usd(Math.max(0, r.dailyCapMicro - spentSince(a.id, now() - DAY, false, p.id))) });
    else if (UNSEALED_CODES.has(x.code)) push({ code: "unsealed_payee" });
  }
  return out;
}

/** Short enough for one line on a phone. The full sentence is in the gate's own API and in the MCP reply. */
function blockedMemo(hard: Reason | undefined): string {
  switch (hard?.code) {
    case "OUTSIDE_INSTRUCTION":
      return "Blocked: address came from the seller's text";
    case "AGENT_PAUSED":
      return "Blocked: helper is paused";
    case "CAP_PER_TX":
    case "CAP_DAILY":
    case "BUDGET_EMPTY":
      return "Blocked: over its limit";
    case "PAYEE_SCAM_LIST":
    case "PAYEE_SANCTIONED":
    case "DIRECT_BAD_LINK":
    case "PAYEE_SUSPENDED":
      return "Blocked: flagged wallet";
    case "CATEGORY_BLOCKED":
      return "Blocked: category not allowed";
    default:
      return "Blocked by the gate";
  }
}

export function txView(p: Payment) {
  const a = getAgent(p.agentId);
  const apr = p.approvalId ? state.approvals[p.approvalId] : undefined;
  const listing = p.offerId ? state.listings[p.offerId] : undefined;
  const hard = p.reasons.find((x) => x.severity === "hard");
  const memo = p.status === "blocked" ? blockedMemo(hard) : p.status === "failed" ? "Failed to settle" : (listing?.title ?? p.memo);
  return {
    id: p.id,
    fromWalletId: `w_${a.id}`,
    toPartyId: partyIdFor(p.payTo),
    initiatedBy: a.id,
    amount: usdc(p.amountMicro),
    fiatAmount: usd(p.amountMicro),
    status: STATUS[p.status],
    memo,
    reason: p.memo && p.memo !== memo ? p.memo : undefined,
    createdAt: iso(p.createdAt),
    settledAt: p.status === "paid" ? iso(apr?.decidedAt ?? p.createdAt) : undefined,
    expiresAt: p.status === "awaiting_owner" && apr ? iso(apr.expiresAt) : undefined,
    flags: flagsFor(p, a),
  };
}

function sendView(s: SigilSend) {
  return {
    id: s.id,
    fromWalletId: `w_${s.ownerId}`,
    toPartyId: s.toPartyId,
    initiatedBy: s.ownerId,
    amount: usdc(s.amountMicro),
    fiatAmount: usd(s.amountMicro),
    status: "settled" as const,
    memo: s.memo,
    createdAt: iso(s.at),
    settledAt: iso(s.at),
    flags: [] as Flag[],
  };
}

function ownerPayments(owner: Owner): Payment[] {
  const ids = new Set(Object.values(state.agents).filter((a) => a.ownerId === owner.id && a.rules).map((a) => a.id));
  return Object.values(state.payments).filter((p) => ids.has(p.agentId));
}

function transactionsFor(owner: Owner) {
  const list = [...ownerPayments(owner).map(txView), ...sends(owner).map(sendView)];
  return list.sort((x, y) => y.createdAt.localeCompare(x.createdAt));
}

function partiesFor(owner: Owner) {
  const out: Record<string, unknown>[] = [personView(owner)];
  for (const a of Object.values(state.agents)) {
    if (a.ownerId === owner.id && a.rules) out.push(agentView(a));
    else if (a.seller) out.push(businessView(a));
  }
  const known = new Set(out.map((p) => p.id as string));
  for (const p of ownerPayments(owner)) {
    const id = partyIdFor(p.payTo);
    if (!known.has(id)) {
      known.add(id);
      out.push(addrParty(p.payTo));
    }
  }
  for (const s of sends(owner)) {
    if (!known.has(s.toPartyId)) {
      known.add(s.toPartyId);
      out.push(addrParty(s.payTo));
    }
  }
  return out;
}

// ---------- policy in, rules out ----------

interface SigilPolicy {
  autoApproveUpTo?: Money;
  weeklyAllowance?: Money;
  allowedPayees?: string[];
  canAddPayees?: boolean;
  canWithdraw?: boolean;
  canViewBalances?: boolean;
}

function applyPolicy(a: Agent, b: SigilPolicy) {
  const cur = a.rules!;
  const next: Rules = { ...cur, allowlist: [...cur.allowlist] };
  if (b.autoApproveUpTo !== undefined) {
    next.autoLimitMicro = toMicro(b.autoApproveUpTo, "autoApproveUpTo");
    next.autonomy = next.autoLimitMicro === 0 ? "ask_always" : cur.autonomy === "ask_always" ? "small_auto" : cur.autonomy;
  }
  if (b.weeklyAllowance !== undefined) next.dailyCapMicro = toMicro(b.weeklyAllowance, "weeklyAllowance");
  if (Array.isArray(b.allowedPayees)) {
    next.allowlist = b.allowedPayees.map((id) => {
      const address = addressForParty(String(id));
      return { address, label: (payeeAgentFor(address)?.name ?? shortAddr(address)).slice(0, 60) };
    });
  }
  if (next.autoLimitMicro > next.dailyCapMicro) throw new ApiError(400, "BAD_REQUEST", "The amount it can pay alone can't be more than its allowance.");
  // keep the gate's own invariants: auto <= per-payment cap <= daily cap
  next.perTxCapMicro = Math.min(Math.max(cur.perTxCapMicro, next.autoLimitMicro), next.dailyCapMicro);
  next.autoTotal24hMicro = Math.min(Math.max(cur.autoTotal24hMicro, next.autoLimitMicro), next.dailyCapMicro);
  next.version = cur.version + 1;
  a.rules = next;
  markDirty();
}

// ---------- events ----------

/** One gate event, as the UI's events (each carries the full object; the UI replaces, it does not merge). */
export function sigilEvents(e: FeedEvent): unknown[] {
  const d = e.data as Record<string, string | undefined>;
  const tx = (id?: string) => (id && state.payments[id] ? txView(state.payments[id]) : null);
  const agentUpdate = (id?: string) => {
    const a = id ? state.agents[id] : undefined;
    return a?.rules && !a.removedAt ? [{ type: "agent.updated", agent: agentView(a) }] : [];
  };
  switch (e.type) {
    case "decision.created": {
      const t = tx(d.paymentId);
      return t ? [{ type: "tx.created", tx: t }] : [];
    }
    case "payment.paid":
    case "payment.blocked":
    case "payment.failed":
    case "approval.resolved": {
      const pid = d.paymentId ?? (d.approvalId ? state.approvals[d.approvalId]?.paymentId : undefined);
      const t = tx(pid);
      return t ? [{ type: "tx.updated", tx: t }, ...agentUpdate(state.payments[pid!].agentId)] : [];
    }
    case "wallet.updated": {
      const a = d.agentId ? state.agents[d.agentId] : undefined;
      return a?.rules && !a.removedAt ? [{ type: "wallet.updated", wallet: agentWallet(a) }] : [];
    }
    case "agent.paused":
    case "agent.resumed":
    case "sigil.agent": {
      return agentUpdate(d.agentId);
    }
    case "sigil.send": {
      const s = (state.sigilSends ?? []).find((x) => x.id === d.sendId);
      const o = state.owners[e.ownerId];
      return s && o ? [{ type: "tx.created", tx: sendView(s) }, { type: "wallet.updated", wallet: mainWallet(o) }] : [];
    }
    case "sigil.main": {
      const o = state.owners[e.ownerId];
      return o ? [{ type: "wallet.updated", wallet: mainWallet(o) }] : [];
    }
    default:
      return [];
  }
}

// ---------- app ----------

export const sigil = new Hono();

sigil.use("*", cors({ origin: "*", allowHeaders: ["Authorization", "Content-Type"], allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] }));

sigil.onError((err, c) => {
  // the UI reads `message` at the top level
  if (err instanceof ApiError) return c.json({ message: err.message, error: { code: err.code, message: err.message } }, err.status as 400);
  console.error(err);
  return c.json({ message: "Something went wrong on the server.", error: { code: "INTERNAL", message: "Something went wrong on the server." } }, 500);
});

sigil.notFound((c) => c.json({ message: "No such endpoint.", error: { code: "NOT_FOUND", message: "No such endpoint." } }, 404));

sigil.get("/health", (c) => c.json({ ok: true, time: iso(now()) }));

/** Demo sign-in: the passcode set on the server. Same account, same token as the owner API. */
sigil.post("/login", async (c) => {
  const { passcode } = await body<{ passcode?: string }>(c);
  if (!checkPasscode(c, passcode)) throw new ApiError(401, "UNAUTHORIZED", "Wrong passcode.");
  const owner = state.owners.own_mia;
  owner.lastLoginAt = Date.now();
  markDirty();
  return c.json({ token: owner.token, user: personView(owner) });
});

sigil.get("/me", (c) => c.json(personView(ownerAuth(c))));

// DEMO ONLY: verification is mocked (SPEC). Production raises badgeLevel only from a signed provider callback.
sigil.post("/me/verification", async (c) => {
  const owner = ownerAuth(c);
  const { method } = await body<{ method?: string }>(c);
  const level = method === "id" ? 2 : method === "passkey" ? 1 : undefined;
  if (level === undefined) throw new ApiError(400, "BAD_REQUEST", "method must be id or passkey.");
  owner.badgeLevel = Math.max(owner.badgeLevel, level) as 0 | 1 | 2 | 3;
  markDirty();
  return c.json(personView(owner));
});

sigil.get("/wallets", (c) => {
  const owner = ownerAuth(c);
  return c.json([mainWallet(owner), ...ownerAgents(owner).map(agentWallet)]);
});

sigil.get("/parties", (c) => c.json(partiesFor(ownerAuth(c))));

sigil.get("/agents", (c) => {
  const owner = ownerAuth(c);
  return c.json(ownerAgents(owner).map((a) => agentView(a, c)));
});

sigil.get("/agents/:id", (c) => c.json(agentView(ownedAgent(ownerAuth(c), c.req.param("id")), c)));

function refuseIfBanned(ownerId: string) {
  if (Object.values(state.agents).some((a) => a.ownerId === ownerId && a.banned)) throw new ApiError(403, "BANNED", "This account was banned after a confirmed fraud.");
}

sigil.post("/agents", async (c) => {
  const owner = ownerAuth(c);
  refuseIfBanned(owner.id);
  const b = await body<{ name?: string; provider?: string; purpose?: string; policy?: SigilPolicy; initialFunding?: Money }>(c);
  if (!b.name?.trim()) throw new ApiError(400, "BAD_REQUEST", "Give the helper a name.");
  const count = ownerAgents(owner).length;
  const cap = owner.badgeLevel === 3 ? 100 : 10;
  if (count >= cap) throw new ApiError(400, "AGENT_LIMIT", `You can run at most ${cap} helpers at this verification level.`);
  const funding = b.initialFunding !== undefined ? toMicro(b.initialFunding, "initialFunding") : 0;
  if (funding > mainBalance(owner)) throw new ApiError(400, "INSUFFICIENT", "Not that much in your main wallet.");
  const provider = (["claude", "gpt", "gemini", "other"] as const).find((p) => p === b.provider) ?? "other";
  const id = nextId("agt");
  const token = randomToken("agent");
  const wallet = addr("a61c", `${id}-${token}`);
  const agent: Agent = {
    id,
    ownerId: owner.id,
    name: b.name.trim().slice(0, 60),
    status: "active",
    walletAddress: wallet,
    balanceMicro: 0,
    token,
    buyerTrust: 0,
    riskStatus: "none",
    provider,
    purpose: (b.purpose ?? "").trim().slice(0, 140) || undefined,
    createdAt: now(),
    rules: { autonomy: "ask_always", autoLimitMicro: 0, perTxCapMicro: 10 * M, dailyCapMicro: 20 * M, autoTotal24hMicro: 5 * M, allowlist: [], categories: ["data", "reports", "api"], version: 1 },
  };
  state.agents[id] = agent;
  state.wallets[wallet] = { address: wallet, label: agent.name, createdAt: now(), fundedBy: [owner.withdrawAddress] };
  if (b.policy) applyPolicy(agent, b.policy);
  if (funding) {
    owner.mainBalanceMicro = mainBalance(owner) - funding;
    agent.balanceMicro = funding;
  }
  markDirty();
  state.events.push({ id: ++state.eventSeq, ownerId: owner.id, type: "sigil.agent", at: now(), data: { agentId: id } });
  state.events.push({ id: ++state.eventSeq, ownerId: owner.id, type: "sigil.main", at: now(), data: {} });
  return c.json({ agent: agentView(agent, c), mcpConfig: { url: apiBase(c), key: token } }, 201);
});

sigil.patch("/agents/:id/policy", async (c) => {
  const agent = ownedAgent(ownerAuth(c), c.req.param("id"));
  applyPolicy(agent, await body<SigilPolicy>(c));
  state.events.push({ id: ++state.eventSeq, ownerId: agent.ownerId, type: "sigil.agent", at: now(), data: { agentId: agent.id } });
  return c.json(agentView(agent, c));
});

sigil.post("/agents/:id/pause", (c) => {
  const agent = ownedAgent(ownerAuth(c), c.req.param("id"));
  pauseAgent(agent, true);
  return c.json(agentView(agent, c));
});

sigil.post("/agents/:id/resume", (c) => {
  const owner = ownerAuth(c);
  const agent = ownedAgent(owner, c.req.param("id"));
  refuseIfBanned(owner.id);
  pauseAgent(agent, false);
  return c.json(agentView(agent, c));
});

/** Remove: token revoked, pending approvals cancelled, wallet swept to the owner. History stays. */
sigil.delete("/agents/:id", (c) => {
  const owner = ownerAuth(c);
  const agent = ownedAgent(owner, c.req.param("id"));
  agent.removedAt = now();
  agent.token = randomToken("revoked");
  pauseAgent(agent, true);
  owner.mainBalanceMicro = mainBalance(owner) + agent.balanceMicro;
  agent.balanceMicro = 0;
  markDirty();
  state.events.push({ id: ++state.eventSeq, ownerId: owner.id, type: "sigil.main", at: now(), data: {} });
  return c.body(null, 204);
});

sigil.get("/transactions", (c) => {
  const owner = ownerAuth(c);
  const statuses = (c.req.query("status") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const limit = Math.max(1, Math.min(500, Number(c.req.query("limit") ?? 50) || 50));
  let list = transactionsFor(owner);
  if (statuses.length) list = list.filter((t) => statuses.includes(t.status));
  return c.json(list.slice(0, limit));
});

/** Human-initiated send from the main wallet. Simulated, settles at once. Helpers never use this path. */
sigil.post("/transactions", async (c) => {
  const owner = ownerAuth(c);
  const b = await body<{ fromWalletId?: string; to?: { partyId?: string; address?: string }; amount?: Money; memo?: string }>(c);
  if (b.fromWalletId !== `w_${owner.id}`) throw new ApiError(400, "BAD_REQUEST", "You can only send from your main wallet. Helpers pay through their own tools.");
  const amountMicro = toMicro(b.amount, "amount");
  if (amountMicro <= 0) throw new ApiError(400, "BAD_REQUEST", "Amount must be more than zero.");
  if (amountMicro > mainBalance(owner)) throw new ApiError(400, "INSUFFICIENT", "That's more than you have.");
  let payTo: string;
  let toPartyId: string;
  if (b.to?.partyId) {
    if (b.to.partyId === owner.id) throw new ApiError(400, "BAD_REQUEST", "That's your own wallet.");
    payTo = addressForParty(b.to.partyId);
    toPartyId = b.to.partyId;
  } else if (b.to?.address) {
    if (!/^0x[a-fA-F0-9]{40}$/.test(b.to.address)) throw new ApiError(400, "BAD_REQUEST", "address must be 0x + 40 hex.");
    payTo = b.to.address.toLowerCase();
    toPartyId = partyIdFor(payTo);
  } else throw new ApiError(400, "BAD_REQUEST", "Say who to send to: a partyId or an address.");
  owner.mainBalanceMicro = mainBalance(owner) - amountMicro;
  const payee = payeeAgentFor(payTo);
  if (payee) payee.balanceMicro += amountMicro;
  const s: SigilSend = { id: nextId("snd"), ownerId: owner.id, toPartyId, payTo, amountMicro, memo: b.memo?.slice(0, 200) || undefined, at: now() };
  (state.sigilSends ??= []).push(s);
  markDirty();
  state.events.push({ id: ++state.eventSeq, ownerId: owner.id, type: "sigil.send", at: now(), data: { sendId: s.id } });
  return c.json(sendView(s), 201);
});

function pendingApprovalFor(owner: Owner, txId: string) {
  const p = state.payments[txId];
  if (!p || !ownerPayments(owner).some((x) => x.id === p.id)) throw new ApiError(404, "NOT_FOUND", "No such transaction.");
  if (!p.approvalId) throw new ApiError(409, "NOT_PENDING", "This payment never needed your okay.");
  return { payment: p, approvalId: p.approvalId };
}

sigil.post("/transactions/:id/approve", (c) => {
  const owner = ownerAuth(c);
  const { approvalId } = pendingApprovalFor(owner, c.req.param("id"));
  return c.json(txView(approve(approvalId, owner.id)));
});

sigil.post("/transactions/:id/decline", (c) => {
  const owner = ownerAuth(c);
  const { approvalId } = pendingApprovalFor(owner, c.req.param("id"));
  return c.json(txView(reject(approvalId, owner.id)));
});

/**
 * EventSource can't send headers, and a long-lived token in a URL ends up in proxy and tunnel logs.
 * So the stream is opened with a ticket: random, bound to the owner, good for 60 seconds, used once.
 */
const TICKET_TTL = 60_000;
const tickets = new Map<string, { ownerId: string; expiresAt: number }>();

sigil.post("/events/ticket", (c) => {
  const owner = ownerAuth(c);
  const t = Date.now();
  for (const [k, v] of tickets) if (v.expiresAt <= t) tickets.delete(k);
  const ticket = randomToken("tkt");
  tickets.set(ticket, { ownerId: owner.id, expiresAt: t + TICKET_TTL });
  return c.json({ ticket, expiresIn: TICKET_TTL / 1000 });
});

function ownerByTicket(ticket: string | undefined): Owner {
  const entry = ticket ? tickets.get(ticket) : undefined;
  if (entry) tickets.delete(ticket!); // single use
  if (!entry || entry.expiresAt <= Date.now()) throw new ApiError(401, "UNAUTHORIZED", "Stream ticket missing, used or expired. Ask for a new one.");
  const owner = state.owners[entry.ownerId];
  if (!owner) throw new ApiError(401, "UNAUTHORIZED", "Please sign in again.");
  return owner;
}

/** Live updates. Opened with a ticket from POST /events/ticket (or a bearer, for tools that can send headers). */
sigil.get("/events", (c) => {
  const owner = c.req.query("ticket") ? ownerByTicket(c.req.query("ticket")) : ownerAuth(c);
  // proxies and tunnels: don't compress, don't buffer
  c.header("Cache-Control", "no-cache, no-transform");
  c.header("Content-Encoding", "identity");
  c.header("X-Accel-Buffering", "no");
  return streamSSE(c, async (stream) => {
    let last = state.eventSeq;
    let open = true;
    let beat = 0;
    stream.onAbort(() => {
      open = false;
    });
    // some proxies hold the first bytes; a comment line of padding gets the stream flowing
    await stream.write(`: ${" ".repeat(2048)}\n\n`);
    await stream.writeSSE({ event: "ready", data: "{}" });
    while (open) {
      if (state.eventSeq < last) last = 0; // the demo was reset; start over
      const fresh = state.events.filter((e) => e.ownerId === owner.id && e.id > last);
      for (const e of fresh) {
        last = e.id;
        for (const out of sigilEvents(e)) await stream.writeSSE({ data: JSON.stringify(out) });
      }
      if (++beat % 40 === 0) await stream.writeSSE({ event: "ping", data: "" });
      await stream.sleep(400);
    }
  });
});
