import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "aipg-credit-"));
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ADMIN_KEY;

const store = await import("../src/store.js");
const { app } = await import("../src/routes.js");
const engine = await import("../src/engine.js");
const credit = await import("../src/credit.js");
const { ADDR, addr } = await import("../src/seed.js");

const OWNER = { Authorization: "Bearer owner_demo_mia", "Content-Type": "application/json" };
const ADMIN = { "X-Admin-Key": "demo-admin", "Content-Type": "application/json" };
const DAY = 86_400_000;

async function call(method: string, path: string, headers: Record<string, string>, body?: unknown) {
  const res = await app.request(`/api/v1${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: (await res.json()) as any };
}

/** A buyer agent with its own owner and wallet, funded by `funders`. */
function addBuyer(id: string, funders: string[], ownerId = `own_${id}`, badgeLevel: 0 | 1 | 2 | 3 = 2) {
  const s = store.state;
  s.owners[ownerId] ??= { id: ownerId, name: id, email: `${id}@example.com`, badgeLevel, withdrawAddress: ADDR.miaOwner, token: `owner_${id}` };
  const wallet = addr("b0b0", id);
  s.wallets[wallet] = { address: wallet, label: id, createdAt: store.now() - 30 * DAY, fundedBy: funders };
  s.agents[id] = { id, ownerId, name: id, status: "active", walletAddress: wallet, balanceMicro: 0, token: `agent_${id}`, buyerTrust: 0, riskStatus: "none" };
  return s.agents[id];
}

function addWallet(tag: string, funders: string[], extra: Record<string, unknown> = {}) {
  const w = addr("f00d", tag);
  store.state.wallets[w] = { address: w, label: tag, createdAt: store.now() - 30 * DAY, fundedBy: funders, ...extra };
  return w;
}

/** Pre-demo style trade (no order), so it also counts as a purchase. */
function addTrade(buyerAgentId: string, sellerAgentId: string, usd: number) {
  store.state.trades.push({
    id: `trd_t_${store.state.trades.length}`,
    sellerAgentId,
    buyerAgentId,
    amountMicro: Math.round(usd * 1_000_000),
    outcome: "accepted",
    factors: { outcome: 1, amount: 0, evidence: 1, independence: 1, buyerTrust: 0, pair: 1 },
    points: 0,
    at: store.now() - DAY,
  });
}

test("buyer trust spreads from audited sellers through real spending", () => {
  store.resetState();
  const { buyers } = credit.computeTrust();
  const mia = buyers.get("agt_mia")!;
  // 20 past payments at 4 audited sellers (about $12.60) -> about 0.8, which keeps the demo's +0.02
  assert.ok(mia.value > 0.77 && mia.value < 0.83, `mia trust ${mia.value}`);
  assert.equal(mia.trustedSellers, 4);
  assert.match(mia.reason, /at 4 trusted sellers/);
  assert.equal(buyers.get("agt_feed")!.value, 1, "audited accounts are trust seeds");
  // the scam's raters only ever bought from QuickData, which no trusted buyer touched
  for (const r of ["agt_r1", "agt_r2", "agt_r3", "agt_r4"]) assert.equal(buyers.get(r)!.value, 0, r);

  // an owner who never verified identity: capped at 0.2
  store.state.owners.own_mia.badgeLevel = 0;
  const capped = credit.computeTrust().buyers.get("agt_mia")!;
  assert.equal(capped.value, credit.UNVERIFIED_TRUST_CAP);
  assert.match(capped.reason, /Capped at 0.2/);
});

test("a brand-new AI starts with zero trust; the owner sees why", async () => {
  store.resetState();
  const created = await call("POST", "/owner/agents", OWNER, { name: "Shop assistant" });
  const me = await call("GET", "/owner/me", OWNER);
  const fresh = me.json.agents.find((a: any) => a.id === created.json.agent.id);
  assert.equal(fresh.buyerTrust.value, 0);
  assert.match(fresh.buyerTrust.reason, /not spent money at any trusted seller/);
  const mia = me.json.agents.find((a: any) => a.id === "agt_mia");
  assert.ok(mia.buyerTrust.value > 0.77);
});

test("independence follows the money, in SPEC order", () => {
  store.resetState();
  const s = store.state;
  const feed = s.agents.agt_feed;
  const scam = s.agents.agt_scam;

  const mia = credit.independenceDetail(s.agents.agt_mia, feed);
  assert.deepEqual([mia.value, mia.code], [1, "CLEAN_FUNDING"]);
  assert.match(mia.reason, /verified wallet/);

  const sameOwner = credit.independenceDetail(s.agents.agt_r1, scam);
  assert.deepEqual([sameOwner.value, sameOwner.code], [0, "SAME_OWNER"]);

  // QuickData -> middle wallet -> buyer: caught two hops back
  const middle = addWallet("middle", [ADDR.scam]);
  const puppet = addBuyer("puppet", [middle]);
  const viaSeller = credit.independenceDetail(puppet, scam);
  assert.deepEqual([viaSeller.value, viaSeller.code], [0, "FUNDED_BY_SELLER"]);
  assert.match(viaSeller.reason, /2 hops back/);
  assert.equal(viaSeller.path?.length, 3);

  // buyer and seller funded by the same (non-exchange) wallet
  const source = addWallet("source", [ADDR.exchange]);
  const twin = addBuyer("twin", [source]);
  s.wallets[feed.walletAddress].fundedBy.push(source);
  assert.equal(credit.independenceDetail(twin, feed).code, "SHARED_FUNDING");
  s.wallets[feed.walletAddress].fundedBy.pop();

  // a shared exchange says nothing
  const viaExchange = addBuyer("exch", [ADDR.exchange]);
  assert.deepEqual([credit.independenceDetail(viaExchange, feed).value, credit.independenceDetail(viaExchange, feed).code], [1, "CLEAN_FUNDING"]);

  // no idea where the money came from
  const anon = addBuyer("anon", []);
  assert.deepEqual([credit.independenceDetail(anon, feed).value, credit.independenceDetail(anon, feed).code], [0.3, "FUNDING_UNKNOWN"]);
});

test("a closed group that only buys from each other counts 0", () => {
  store.resetState();
  const group = ["g1", "g2", "g3"].map((id) => addBuyer(id, [ADDR.exchange]));
  for (const b of group) addTrade(b.id, "agt_scam", 1);
  const d = credit.independenceDetail(group[0], store.state.agents.agt_scam);
  assert.deepEqual([d.value, d.code], [0, "CLOSED_GROUP"]);
  // Mia buys widely, so the same check doesn't fire for her
  assert.equal(credit.independenceDetail(store.state.agents.agt_mia, store.state.agents.agt_scam).code, "CLEAN_FUNDING");
});

test("public profile explains the score, the weekly cap and what the next tier needs", async () => {
  store.resetState();
  engine.tick(); // first tick runs the nightly recompute, which fills in the notes
  const feed = (await call("GET", "/public/agents/agt_feed", {})).json;
  assert.equal(feed.score, 82);
  assert.equal(feed.tier, 3);
  assert.equal(feed.tierProgress.next, null);
  // seeded trades come from 3 AIs of one owner: that is one real buyer, not three
  assert.equal(feed.distinctBuyers, 55);
  assert.equal(feed.scoreDetail.cappedByWeeklyLimit, false);
  assert.ok(feed.recentTrades[0].notes.independence.length > 10);
  assert.ok(feed.lastRecomputedAt);

  const scam = (await call("GET", "/public/agents/agt_scam", {})).json;
  assert.equal(scam.tier, 0);
  const need = Object.fromEntries(scam.tierProgress.next.requirements.map((r: any) => [r.key, r]));
  assert.equal(scam.tierProgress.next.tier, 1);
  assert.deepEqual([need.score.need, need.score.met], [30, false]);
  assert.deepEqual([need.distinctBuyers.need, need.distinctBuyers.met], [5, false]);
  assert.equal(need.badgeLevel.met, true);
  // no gains for the scam; its victim's undelivered order counts against it
  for (const t of scam.recentTrades) assert.ok(t.points <= 0, `${t.orderId} ${t.points}`);
  assert.ok(scam.recentTrades.some((t: any) => t.points < 0));
});

test("a sock puppet found later loses its points at the nightly recompute", async () => {
  store.resetState();
  engine.tick();
  // a new buyer, funded from an exchange, bought from PriceFeed a few times
  const buyer = addBuyer("later", [ADDR.exchange]);
  for (const usd of [2, 3, 5]) addTrade(buyer.id, "agt_feed", usd);
  store.state.agents.agt_feed.seller!.scoreWeekAgo = 100; // keep the weekly cap out of the way
  const before = await call("POST", "/admin/recompute", ADMIN);
  assert.equal(before.status, 200);
  const earned = store.state.trades.filter((t) => t.buyerAgentId === "later").map((t) => t.points);
  assert.ok(earned.every((p) => p === 0), "a buyer with no trusted spending elsewhere adds nothing yet");

  // give it real history elsewhere so its ratings count, then reveal who funded it
  addTrade(buyer.id, "agt_o1", 4);
  addTrade(buyer.id, "agt_o2", 4);
  addTrade(buyer.id, "agt_o3", 4);
  await call("POST", "/admin/recompute", ADMIN);
  const counted = store.state.trades.filter((t) => t.buyerAgentId === "later" && t.sellerAgentId === "agt_feed");
  assert.ok(counted.every((t) => t.points > 0), "independent and trusted: it counts");
  // repeat purchases from the same seller count 1/k
  assert.deepEqual(counted.map((t) => t.factors.pair), [1, 0.5, 0.3333]);

  const link = await call("POST", "/admin/funding", ADMIN, { from: ADDR.feed, to: buyer.walletAddress });
  assert.equal(link.status, 200);
  const after = await call("POST", "/admin/recompute", ADMIN);
  const revoked = after.json.changedTrades.filter((c: any) => c.sellerAgentId === "agt_feed");
  assert.equal(revoked.length, 3);
  for (const c of revoked) {
    assert.equal(c.pointsAfter, 0);
    assert.match(c.why, /funded by the seller/);
  }
  assert.ok(after.json.sellerScores.some((x: any) => x.agentId === "agt_feed" && x.scoreAfter < x.scoreBefore));

  const noKey = await call("POST", "/admin/recompute", { "Content-Type": "application/json" });
  assert.equal(noKey.status, 401);
});

test("the recompute also runs by itself once a day on the demo clock", () => {
  store.resetState();
  engine.tick();
  const first = store.state.lastRecomputeAt!;
  engine.timewarp(60);
  assert.equal(store.state.lastRecomputeAt, first, "not again within the day");
  engine.timewarp(24 * 60);
  assert.ok(store.state.lastRecomputeAt! > first);
});

test("review fixes: losses always count, sister sellers don't lend trust, only your own verified wallet is clean", async () => {
  store.resetState();
  const s = store.state;

  // a seller that never delivers loses points even to a brand-new buyer
  const created = await call("POST", "/owner/agents", OWNER, { name: "New shopper" });
  const newbie = s.agents[created.json.agent.id];
  s.orders.ord_t = {
    id: "ord_t", paymentId: "pay_t", listingId: "lst_report", buyerAgentId: newbie.id, sellerAgentId: "agt_report",
    amountMicro: 20_000_000, criteria: "x", status: "awaiting_delivery", createdAt: store.now(), deliverAfter: store.now(), deliverBy: store.now(),
  };
  engine.closeOrder(s.orders.ord_t, "failed");
  assert.ok((s.orders.ord_t.pointsAdded ?? 0) < -2, `loss ${s.orders.ord_t.pointsAdded}`);

  // one owner runs a trusted seller and a second seller; puppets spend at the first to rate the second
  s.agents.agt_feed2 = { ...s.agents.agt_scam, id: "agt_feed2", ownerId: "own_feedco", name: "PriceFeed Two", walletAddress: addWallet("feed2", [ADDR.exchange]), preTrusted: false };
  const puppet = addBuyer("pup", [ADDR.exchange]);
  addTrade(puppet.id, "agt_feed", 5);
  const t = credit.computeTrust();
  assert.ok(t.buyers.get(puppet.id)!.value > 0.3, "it did spend at a trusted seller");
  assert.equal(t.forRating(puppet.id, "agt_feed2").value, 0, "but not at one run by someone else than the rated seller's owner");

  // a verified wallet that belongs to someone else proves nothing
  const stranger = addWallet("stranger-verified", [], { verifiedOwnerWallet: true, ownerId: "own_feedco" });
  const funded = addBuyer("funded", [stranger]);
  assert.equal(credit.independenceDetail(funded, s.agents.agt_report).code, "FUNDING_UNKNOWN");
  // Mia changing her withdraw address doesn't change where her AI's money came from
  const moved = await call("PUT", "/owner/withdraw-address", OWNER, { address: "0x" + "ab".repeat(20), passcode: "demo" });
  assert.equal(moved.status, 200);
  assert.equal(credit.independenceDetail(s.agents.agt_mia, s.agents.agt_feed).code, "CLEAN_FUNDING");
});
