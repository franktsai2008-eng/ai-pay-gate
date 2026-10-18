import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "aipg-sigil-"));
delete process.env.ANTHROPIC_API_KEY;

const store = await import("../src/store.js");
const { root } = await import("../src/app.js");
const { sigilEvents } = await import("../src/sigil.js");
const { ADDR } = await import("../src/seed.js");

const OWNER = { Authorization: "Bearer owner_demo_mia", "Content-Type": "application/json" };
const AGENT = { Authorization: "Bearer agent_demo_mia", "Content-Type": "application/json" };

async function call(method: string, path: string, headers: Record<string, string>, body?: unknown) {
  const res = await root.request(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, json: text ? (JSON.parse(text) as any) : null };
}

const flagCodes = (flags: { code: string }[]) => flags.map((f) => f.code).sort();

test("the gate's own API still answers through the root app", async () => {
  store.resetState();
  const h = await call("GET", "/api/v1/health", {});
  assert.equal(h.status, 200);
  assert.equal(h.json.ok, true);
  const me = await call("GET", "/api/v1/owner/me", OWNER);
  assert.equal(me.json.owner.id, "own_mia");
});

test("sigil: login, me, wallets, parties, agents have the UI's shapes", async () => {
  store.resetState();
  const bad = await call("POST", "/v1/login", { "Content-Type": "application/json" }, { passcode: "nope" });
  assert.equal(bad.status, 401);
  assert.equal(typeof bad.json.message, "string");
  const login = await call("POST", "/v1/login", { "Content-Type": "application/json" }, { passcode: "demo" });
  assert.equal(login.status, 200);
  assert.equal(login.json.token, "owner_demo_mia");

  const noauth = await call("GET", "/v1/me", {});
  assert.equal(noauth.status, 401);

  const me = await call("GET", "/v1/me", OWNER);
  assert.equal(me.json.kind, "person");
  assert.equal(me.json.seal, "sealed");
  assert.equal(me.json.verification.status, "verified");
  assert.equal(me.json.displayCurrency, "USD");

  const wallets = await call("GET", "/v1/wallets", OWNER);
  assert.equal(wallets.json.length, 2);
  const [main, mia] = wallets.json;
  assert.equal(main.id, "w_own_mia");
  assert.equal(main.ownerId, "own_mia");
  assert.equal(main.balance.currency, "USDC");
  assert.equal(main.fiatBalance.amount, "3000.00");
  assert.equal(mia.id, "w_agt_mia");
  assert.equal(mia.ownerId, "agt_mia");
  assert.equal(mia.fiatBalance.amount, "50.00");
  assert.match(mia.change24h.amount, /^-?\d+\.\d\d$/);

  const parties = await call("GET", "/v1/parties", OWNER);
  const byId = Object.fromEntries(parties.json.map((p: any) => [p.id, p]));
  assert.equal(byId.own_mia.kind, "person");
  assert.equal(byId.agt_mia.kind, "agent");
  assert.equal(byId.agt_feed.kind, "business");
  assert.equal(byId.agt_feed.seal, "sealed");
  assert.equal(byId.agt_scam.kind, "business");
  for (const p of parties.json) assert.ok(["sealed", "unsealed", "paused"].includes(p.seal), p.id);

  const agents = await call("GET", "/v1/agents", OWNER);
  assert.equal(agents.json.length, 1);
  const a = agents.json[0];
  assert.equal(a.id, "agt_mia");
  assert.equal(a.kind, "agent");
  assert.equal(a.provider, "claude");
  assert.equal(a.walletId, "w_agt_mia");
  assert.equal(a.policy.autoApproveUpTo.amount, "5.00");
  assert.equal(a.policy.weeklyAllowance.amount, "40.00");
  assert.deepEqual(a.policy.allowedPayees, ["agt_feed"]);
  assert.equal(a.policy.canWithdraw, false);
  assert.equal(a.mcp.keyHint, "_mia");
  assert.equal(a.mcp.connected, true);
  assert.match(a.spentThisWeek.amount, /^\d+\.\d\d$/);
  assert.ok(a.mcp.url.endsWith("/api/v1"));
});

test("sigil: green, yellow, red payments appear as settled, pending_approval, declined", async () => {
  store.resetState();
  const before = (await call("GET", "/v1/transactions", OWNER)).json;
  assert.equal(before.length, 20, "the seeded history shows");
  assert.ok(before.every((t: any) => t.status === "settled" && t.fromWalletId === "w_agt_mia" && t.initiatedBy === "agt_mia"));

  // green
  const feed = await call("POST", "/api/v1/agent/pay", AGENT, { offerId: "lst_feed", criteria: "JSON with 50 prices", memo: "daily prices" });
  assert.equal(feed.json.light, "green");
  const green = (await call("GET", "/v1/transactions?limit=1", OWNER)).json[0];
  assert.equal(green.id, feed.json.paymentId);
  assert.equal(green.status, "settled");
  assert.equal(green.toPartyId, "agt_feed");
  assert.equal(green.amount.amount, "0.05");
  assert.equal(green.fiatAmount.currency, "USD");
  assert.equal(green.memo, "Today's crypto prices (50 coins)");
  assert.equal(green.reason, "daily prices");
  assert.deepEqual(green.flags, []);
  assert.ok(green.settledAt);

  // yellow
  const rep = await call("POST", "/api/v1/agent/pay", AGENT, { offerId: "lst_report", memo: "weekly market report" });
  assert.equal(rep.json.light, "yellow");
  const pending = (await call("GET", "/v1/transactions?status=pending_approval", OWNER)).json;
  assert.equal(pending.length, 1);
  const y = pending[0];
  assert.equal(y.id, rep.json.paymentId);
  assert.equal(y.toPartyId, "agt_report");
  assert.deepEqual(flagCodes(y.flags), ["new_payee", "over_auto_limit"]);
  assert.equal(y.flags.find((f: any) => f.code === "over_auto_limit").limit.amount, "5.00");
  assert.ok(y.expiresAt);

  // the agent token cannot approve through the UI's path either
  const sneaky = await call("POST", `/v1/transactions/${y.id}/approve`, AGENT);
  assert.equal(sneaky.status, 401);

  const approved = await call("POST", `/v1/transactions/${y.id}/approve`, OWNER);
  assert.equal(approved.status, 200);
  assert.equal(approved.json.status, "settled");
  assert.ok(approved.json.settledAt);
  // double tap is safe
  const again = await call("POST", `/v1/transactions/${y.id}/approve`, OWNER);
  assert.equal(again.json.status, "settled");

  const agents = (await call("GET", "/v1/agents", OWNER)).json;
  assert.equal(Number(agents[0].spentThisWeek.amount) >= 20.05, true, agents[0].spentThisWeek.amount);
  const wallets = (await call("GET", "/v1/wallets", OWNER)).json;
  assert.equal(wallets[1].fiatBalance.amount, "29.95");

  // red: the address came from the scam listing
  await call("GET", "/api/v1/agent/offers?q=premium", AGENT);
  const scam = await call("POST", "/api/v1/agent/pay", AGENT, { payTo: ADDR.bad1, amountMicro: 3_000_000, memo: "seller said to pay here first" });
  assert.equal(scam.json.light, "red");
  const red = (await call("GET", "/v1/transactions?limit=1", OWNER)).json[0];
  assert.equal(red.id, scam.json.paymentId);
  assert.equal(red.status, "declined");
  assert.equal(red.memo, "Blocked: address came from the seller's text");
  assert.equal(red.reason, "seller said to pay here first");
  assert.deepEqual(flagCodes(red.flags), ["new_payee", "unsealed_payee"]);
  assert.equal(red.toPartyId, `addr:${ADDR.bad1}`);
  const parties = (await call("GET", "/v1/parties", OWNER)).json;
  const drop = parties.find((p: any) => p.id === red.toPartyId);
  assert.ok(drop, "the drop address shows up as an unsealed party");
  assert.equal(drop.seal, "unsealed");

  // a declined payment cannot be approved
  const nope = await call("POST", `/v1/transactions/${red.id}/approve`, OWNER);
  assert.equal(nope.status, 409);
});

test("sigil: decline, pause and resume", async () => {
  store.resetState();
  const rep = await call("POST", "/api/v1/agent/pay", AGENT, { offerId: "lst_report" });
  const declined = await call("POST", `/v1/transactions/${rep.json.paymentId}/decline`, OWNER, { reason: "not now" });
  assert.equal(declined.json.status, "declined");

  const paused = await call("POST", "/v1/agents/agt_mia/pause", OWNER);
  assert.equal(paused.json.seal, "paused");
  const blocked = await call("POST", "/api/v1/agent/pay", AGENT, { offerId: "lst_feed" });
  assert.equal(blocked.json.light, "red");
  const resumed = await call("POST", "/v1/agents/agt_mia/resume", OWNER);
  assert.equal(resumed.json.seal, "sealed");
});

test("sigil: create a helper, change its limits, remove it", async () => {
  store.resetState();
  const created = await call("POST", "/v1/agents", OWNER, {
    name: "Shopper",
    provider: "claude",
    purpose: "Buys data",
    policy: { autoApproveUpTo: { amount: "8.00", currency: "USD" }, weeklyAllowance: { amount: "100.00", currency: "USD" }, allowedPayees: ["agt_feed"], canAddPayees: false, canWithdraw: false, canViewBalances: true },
    initialFunding: { amount: "25.00", currency: "USDC" },
  });
  assert.equal(created.status, 201);
  const a = created.json.agent;
  assert.equal(a.name, "Shopper");
  assert.equal(a.seal, "sealed");
  assert.equal(a.policy.autoApproveUpTo.amount, "8.00");
  assert.equal(a.policy.weeklyAllowance.amount, "100.00");
  assert.deepEqual(a.policy.allowedPayees, ["agt_feed"]);
  assert.match(created.json.mcpConfig.key, /^agent_[0-9a-f]{24}$/);
  assert.equal(a.mcp.keyHint, created.json.mcpConfig.key.slice(-4));
  assert.equal(a.mcp.connected, false);

  const wallets = (await call("GET", "/v1/wallets", OWNER)).json;
  assert.equal(wallets.find((w: any) => w.id === "w_own_mia").fiatBalance.amount, "2975.00");
  assert.equal(wallets.find((w: any) => w.id === a.walletId).fiatBalance.amount, "25.00");

  // the new key works on the agent API, and the gate uses the limits the UI set
  const NEW = { Authorization: `Bearer ${created.json.mcpConfig.key}`, "Content-Type": "application/json" };
  const rules = await call("GET", "/api/v1/agent/rules", NEW);
  assert.equal(rules.json.autoLimitUsd, "$8.00");
  assert.equal(rules.json.dailyCapUsd, "$100.00");
  const pay = await call("POST", "/api/v1/agent/pay", NEW, { offerId: "lst_feed" });
  assert.equal(pay.json.light, "green", JSON.stringify(pay.json.reasons));
  assert.equal((await call("GET", `/v1/agents/${a.id}`, OWNER)).json.mcp.connected, true);

  const patched = await call("PATCH", `/v1/agents/${a.id}/policy`, OWNER, { autoApproveUpTo: { amount: "0.00", currency: "USD" } });
  assert.equal(patched.json.policy.autoApproveUpTo.amount, "0.00");
  const ask = await call("POST", "/api/v1/agent/pay", NEW, { offerId: "lst_feed" });
  assert.equal(ask.json.light, "yellow");
  assert.ok(ask.json.reasons.some((r: any) => r.code === "AUTONOMY_ASK_ALWAYS"));
  const tooBig = await call("PATCH", `/v1/agents/${a.id}/policy`, OWNER, { autoApproveUpTo: { amount: "500.00", currency: "USD" } });
  assert.equal(tooBig.status, 400);

  const removed = await call("DELETE", `/v1/agents/${a.id}`, OWNER);
  assert.equal(removed.status, 204);
  assert.ok(!(await call("GET", "/v1/agents", OWNER)).json.some((x: any) => x.id === a.id));
  assert.equal((await call("GET", `/v1/agents/${a.id}`, OWNER)).status, 404);
  const after = (await call("GET", "/v1/wallets", OWNER)).json;
  assert.equal(after.find((w: any) => w.id === "w_own_mia").fiatBalance.amount, "2999.95");
  assert.equal((await call("GET", "/api/v1/agent/balance", NEW)).status, 401, "the old key stops working");
  assert.equal((await call("GET", "/v1/transactions?status=pending_approval", OWNER)).json.length, 0, "its pending approval was cancelled");
});

test("sigil: a human send from the main wallet settles at once and shows up", async () => {
  store.resetState();
  const sent = await call("POST", "/v1/transactions", OWNER, { fromWalletId: "w_own_mia", to: { partyId: "agt_feed" }, amount: { amount: "12.50", currency: "USDC" }, memo: "thanks" });
  assert.equal(sent.status, 201);
  assert.equal(sent.json.status, "settled");
  assert.equal(sent.json.initiatedBy, "own_mia");
  assert.equal(sent.json.toPartyId, "agt_feed");
  const list = (await call("GET", "/v1/transactions?limit=1", OWNER)).json;
  assert.equal(list[0].id, sent.json.id);
  assert.equal((await call("GET", "/v1/wallets", OWNER)).json[0].fiatBalance.amount, "2987.50");
  const fromHelper = await call("POST", "/v1/transactions", OWNER, { fromWalletId: "w_agt_mia", to: { partyId: "agt_feed" }, amount: { amount: "1.00", currency: "USDC" } });
  assert.equal(fromHelper.status, 400);
  const tooMuch = await call("POST", "/v1/transactions", OWNER, { fromWalletId: "w_own_mia", to: { address: ADDR.feed }, amount: { amount: "9999.00", currency: "USDC" } });
  assert.equal(tooMuch.status, 400);
});

test("sigil: gate events translate into the UI's events with full objects", async () => {
  store.resetState();
  // translate as the stream would: right after each thing happens
  const from = store.state.eventSeq;
  const rep = await call("POST", "/api/v1/agent/pay", AGENT, { offerId: "lst_report" });
  const mid = store.state.eventSeq;
  const first = store.state.events.filter((e) => e.id > from).flatMap(sigilEvents) as any[];
  await call("POST", `/v1/transactions/${rep.json.paymentId}/approve`, OWNER);
  const second = store.state.events.filter((e) => e.id > mid).flatMap(sigilEvents) as any[];
  const out = [...first, ...second];
  const types = out.map((e) => e.type);
  assert.equal(types[0], "tx.created");
  assert.equal(out[0].tx.status, "pending_approval");
  assert.ok(types.includes("tx.updated"));
  assert.ok(types.includes("agent.updated"));
  assert.ok(types.includes("wallet.updated"));
  const settled = out.filter((e) => e.type === "tx.updated").pop();
  assert.equal(settled.tx.status, "settled");
  const wallet = out.find((e) => e.type === "wallet.updated");
  assert.equal(wallet.wallet.id, "w_agt_mia");
  assert.equal(wallet.wallet.fiatBalance.amount, "30.00");

  // the token never rides in the URL: the stream takes a one-time ticket
  assert.equal((await root.request("/v1/events?token=owner_demo_mia")).status, 401);
  assert.equal((await root.request("/v1/events?ticket=tkt_nope")).status, 401);
  assert.equal((await call("POST", "/v1/events/ticket", AGENT)).status, 401, "agents get no stream");
  const ticket = (await call("POST", "/v1/events/ticket", OWNER)).json.ticket;
  assert.match(ticket, /^tkt_[0-9a-f]{24}$/);
  const res = await root.request(`/v1/events?ticket=${ticket}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
  const reader = res.body!.getReader();
  let chunk = "";
  for (let i = 0; i < 5 && !/event: ready/.test(chunk); i++) chunk += new TextDecoder().decode((await reader.read()).value);
  assert.match(chunk, /^: {10,}/, "a padding comment comes first, for proxies that hold the first bytes");
  assert.match(chunk, /event: ready/);
  await reader.cancel();
  assert.equal((await root.request(`/v1/events?ticket=${ticket}`)).status, 401, "a ticket works once");
  const viaHeader = await root.request("/v1/events", { headers: OWNER });
  assert.equal(viaHeader.status, 200);
  await viaHeader.body!.cancel();
});
