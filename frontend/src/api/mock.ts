import type { SigilClient } from "./client";
import type { Agent, Event, Money, Party, Transaction, User, Wallet } from "./types";

const wait = (ms = 250) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();
const ago = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString();
const usd = (n: number | string): Money => ({ amount: Number(n).toFixed(2), currency: "USD" });
const usdc = (n: number | string): Money => ({ amount: Number(n).toFixed(2), currency: "USDC" });
let seq = 100;
const id = (p: string) => `${p}_${++seq}`;

/* ---------- seed ---------- */

const me: User = {
  id: "p_me", kind: "person", name: "Marco", seal: "sealed", sealedAt: ago(60 * 24 * 12),
  email: "marco@example.com", displayCurrency: "USD",
  verification: { status: "verified", method: "passkey", at: ago(60 * 24 * 12) },
};

const parties: Party[] = [
  me,
  { id: "p_lena", kind: "person", name: "Lena", seal: "sealed", sealedAt: ago(60 * 24 * 40) },
  { id: "p_studio", kind: "business", name: "Northline Studio", seal: "sealed", sealedAt: ago(60 * 24 * 200) },
  { id: "p_wellcome", kind: "business", name: "Wellcome", seal: "sealed", sealedAt: ago(60 * 24 * 300) },
  { id: "p_parknshop", kind: "business", name: "PARKnSHOP", seal: "sealed", sealedAt: ago(60 * 24 * 300) },
  { id: "p_apple", kind: "business", name: "Apple Store", seal: "sealed", sealedAt: ago(60 * 24 * 500) },
  { id: "p_hkelectric", kind: "business", name: "HK Electric", seal: "sealed", sealedAt: ago(60 * 24 * 500) },
  { id: "p_unknown", kind: "business", name: "0x8f2a…c41e", seal: "unsealed" },
];

const wallets: Wallet[] = [
  { id: "w_me", ownerId: "p_me", label: "Main", address: "0x3aF1…9b2C", balance: usdc(3120), fiatBalance: usd(3120), change24h: usd(12.1) },
  { id: "w_shopper", ownerId: "a_shopper", label: "Shopper", address: "0x71bE…04dD", balance: usdc(640), fiatBalance: usd(640), change24h: usd(-48.9) },
  { id: "w_saver", ownerId: "a_saver", label: "Saver", address: "0x9c0A…e7F1", balance: usdc(458.4), fiatBalance: usd(458.4), change24h: usd(0) },
  { id: "w_bills", ownerId: "a_bills", label: "Bills", address: "0x22dD…A810", balance: usdc(210), fiatBalance: usd(210), change24h: usd(0) },
];

const agents: Agent[] = [
  {
    id: "a_shopper", kind: "agent", name: "Shopper", seal: "sealed", sealedAt: ago(60 * 24 * 6), ownerId: "p_me",
    provider: "claude", purpose: "Buys the weekly groceries", walletId: "w_shopper",
    policy: { autoApproveUpTo: usd(80), weeklyAllowance: usd(500), allowedPayees: ["p_wellcome", "p_parknshop"], canAddPayees: false, canWithdraw: false, canViewBalances: true },
    spentThisWeek: usd(112.6), lastActiveAt: ago(40), mcp: { url: "https://sigil.money/mcp", keyHint: "8f2a", connected: true },
  },
  {
    id: "a_saver", kind: "agent", name: "Saver", seal: "paused", sealedAt: ago(60 * 24 * 20), ownerId: "p_me",
    provider: "gpt", purpose: "Moves spare change into savings every Friday", walletId: "w_saver",
    policy: { autoApproveUpTo: usd(50), weeklyAllowance: usd(200), allowedPayees: ["p_me"], canAddPayees: false, canWithdraw: false, canViewBalances: true },
    spentThisWeek: usd(0), lastActiveAt: ago(60 * 24 * 3), mcp: { url: "https://sigil.money/mcp", keyHint: "c19d", connected: true },
  },
  {
    id: "a_bills", kind: "agent", name: "Bills", seal: "sealed", sealedAt: ago(60 * 24 * 2), ownerId: "p_me",
    provider: "claude", purpose: "Pays electricity and internet when they come in", walletId: "w_bills",
    policy: { autoApproveUpTo: usd(150), weeklyAllowance: usd(300), allowedPayees: ["p_hkelectric"], canAddPayees: false, canWithdraw: false, canViewBalances: true },
    spentThisWeek: usd(0), lastActiveAt: ago(60 * 5), mcp: { url: "https://sigil.money/mcp", keyHint: "41aa", connected: false },
  },
];
parties.push(...agents);

const txs: Transaction[] = [
  {
    id: "t_apple", fromWalletId: "w_shopper", toPartyId: "p_apple", initiatedBy: "a_shopper", amount: usdc(220), fiatAmount: usd(220),
    status: "pending_approval", createdAt: ago(6), expiresAt: new Date(Date.now() + 14 * 60_000).toISOString(),
    flags: [{ code: "over_auto_limit", limit: usd(80) }, { code: "new_payee" }],
    reason: "You asked me to replace the broken charger cable. Apple's price was $220 for the official one; the third-party ones had poor reviews.",
  },
  { id: "t_1", fromWalletId: "w_shopper", toPartyId: "p_wellcome", initiatedBy: "a_shopper", amount: usdc(48.9), fiatAmount: usd(48.9), status: "settled", createdAt: ago(60 * 2), settledAt: ago(60 * 2), flags: [], memo: "Groceries" },
  { id: "t_2", fromWalletId: "w_lena", toPartyId: "p_me", initiatedBy: "p_lena", amount: usdc(120), fiatAmount: usd(120), status: "settled", createdAt: ago(60 * 3), settledAt: ago(60 * 3), flags: [], memo: "Rent refund" },
  { id: "t_2b", fromWalletId: "w_lena", toPartyId: "p_me", initiatedBy: "p_lena", amount: usdc(32), fiatAmount: usd(32), status: "settled", createdAt: ago(60 * 26), settledAt: ago(60 * 26), flags: [], memo: "Dinner split" },
  { id: "t_pay", fromWalletId: "w_studio", toPartyId: "p_me", initiatedBy: "p_studio", amount: usdc(1800), fiatAmount: usd(1800), status: "settled", createdAt: ago(60 * 24 * 5), settledAt: ago(60 * 24 * 5), flags: [], memo: "October invoice" },
  { id: "t_3", fromWalletId: "w_shopper", toPartyId: "p_parknshop", initiatedBy: "a_shopper", amount: usdc(63.7), fiatAmount: usd(63.7), status: "settled", createdAt: ago(60 * 24 * 2), settledAt: ago(60 * 24 * 2), flags: [], memo: "Groceries" },
  { id: "t_4", fromWalletId: "w_bills", toPartyId: "p_hkelectric", initiatedBy: "a_bills", amount: usdc(96.2), fiatAmount: usd(96.2), status: "settled", createdAt: ago(60 * 24 * 4), settledAt: ago(60 * 24 * 4), flags: [], memo: "Electricity, September" },
  { id: "t_5", fromWalletId: "w_me", toPartyId: "p_lena", initiatedBy: "p_me", amount: usdc(300), fiatAmount: usd(300), status: "settled", createdAt: ago(60 * 24 * 6), settledAt: ago(60 * 24 * 6), flags: [], memo: "Dinner split" },
  { id: "t_6", fromWalletId: "w_shopper", toPartyId: "p_unknown", initiatedBy: "a_shopper", amount: usdc(40), fiatAmount: usd(40), status: "declined", createdAt: ago(60 * 24 * 8), flags: [{ code: "unsealed_payee" }, { code: "new_payee" }], reason: "A marketplace seller for the charger." },
];

/* ---------- events ---------- */

const listeners = new Set<(e: Event) => void>();
const emit = (e: Event) => listeners.forEach((l) => l(e));

/* ---------- client ---------- */

export const mockClient: SigilClient = {
  async me() { await wait(); return me; },
  async startVerification(method) { await wait(600); me.verification = { status: "verified", method, at: now() }; me.seal = "sealed"; me.sealedAt = now(); return me; },
  async wallets() { await wait(); return wallets; },
  async parties() { await wait(); return parties; },
  async agents() { await wait(); return agents; },
  async agent(aid) { await wait(); const a = agents.find((x) => x.id === aid); if (!a) throw new Error("No such agent"); return a; },
  async createAgent(req) {
    await wait(700);
    const aid = id("a");
    const w: Wallet = { id: id("w"), ownerId: aid, label: req.name, address: "0x" + Math.random().toString(16).slice(2, 6) + "…" + Math.random().toString(16).slice(2, 6), balance: usdc(req.initialFunding?.amount ?? 0), fiatBalance: usd(req.initialFunding?.amount ?? 0), change24h: usd(0) };
    const key = "sk_live_" + Math.random().toString(36).slice(2, 14);
    const a: Agent = { id: aid, kind: "agent", name: req.name, seal: "sealed", sealedAt: now(), ownerId: "p_me", provider: req.provider, purpose: req.purpose, walletId: w.id, policy: req.policy, spentThisWeek: usd(0), mcp: { url: "https://sigil.money/mcp", keyHint: key.slice(-4), connected: false } };
    wallets.push(w); agents.push(a); parties.push(a);
    emit({ type: "agent.updated", agent: a });
    return { agent: a, mcpConfig: { url: a.mcp.url, key } };
  },
  async updateAgentPolicy(aid, req) { await wait(); const a = agents.find((x) => x.id === aid)!; a.policy = { ...a.policy, ...req }; emit({ type: "agent.updated", agent: a }); return a; },
  async pauseAgent(aid, paused) { await wait(); const a = agents.find((x) => x.id === aid)!; a.seal = paused ? "paused" : "sealed"; emit({ type: "agent.updated", agent: a }); return a; },
  async removeAgent(aid) { await wait(); const i = agents.findIndex((x) => x.id === aid); if (i >= 0) agents.splice(i, 1); },
  async transactions(opts) {
    await wait();
    let list = [...txs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (opts?.status) list = list.filter((t) => opts.status!.includes(t.status));
    return list.slice(0, opts?.limit ?? 50);
  },
  async send(req) {
    await wait(900);
    const toPartyId = "partyId" in req.to ? req.to.partyId : (() => { const p: Party = { id: id("p"), kind: "business", name: req.to.address.slice(0, 6) + "…" + req.to.address.slice(-4), seal: "unsealed" }; parties.push(p); return p.id; })();
    const t: Transaction = { id: id("t"), fromWalletId: req.fromWalletId, toPartyId, initiatedBy: "p_me", amount: req.amount, fiatAmount: usd(req.amount.amount), status: "settled", createdAt: now(), settledAt: now(), flags: [], memo: req.memo };
    txs.unshift(t);
    const w = wallets.find((x) => x.id === req.fromWalletId)!;
    w.balance = usdc(Number(w.balance.amount) - Number(req.amount.amount)); w.fiatBalance = usd(w.balance.amount);
    emit({ type: "tx.created", tx: t }); emit({ type: "wallet.updated", wallet: w });
    return t;
  },
  async approve(tid) {
    await wait(700);
    const t = txs.find((x) => x.id === tid)!; t.status = "settled"; t.settledAt = now();
    const w = wallets.find((x) => x.id === t.fromWalletId)!;
    w.balance = usdc(Number(w.balance.amount) - Number(t.amount.amount)); w.fiatBalance = usd(w.balance.amount);
    const a = agents.find((x) => x.id === t.initiatedBy); if (a) a.spentThisWeek = usd(Number(a.spentThisWeek.amount) + Number(t.amount.amount));
    emit({ type: "tx.updated", tx: t }); emit({ type: "wallet.updated", wallet: w });
    return t;
  },
  async decline(tid) { await wait(400); const t = txs.find((x) => x.id === tid)!; t.status = "declined"; emit({ type: "tx.updated", tx: t }); return t; },
  subscribe(onEvent) {
    listeners.add(onEvent);
    // Demo: a helper asks for something ~40s in, so the live flow can be seen.
    const timer = setTimeout(() => {
      const t: Transaction = { id: id("t"), fromWalletId: "w_bills", toPartyId: "p_hkelectric", initiatedBy: "a_bills", amount: usdc(182.4), fiatAmount: usd(182.4), status: "pending_approval", createdAt: now(), expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), flags: [{ code: "over_auto_limit", limit: usd(150) }], reason: "October's electricity bill arrived. It's higher than last month because of the heatwave." };
      txs.unshift(t); emit({ type: "tx.created", tx: t });
    }, 40_000);
    return () => { listeners.delete(onEvent); clearTimeout(timer); };
  },
};
