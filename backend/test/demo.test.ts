import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "aipg-"));
delete process.env.ANTHROPIC_API_KEY;

const store = await import("../src/store.js");
const { app } = await import("../src/routes.js");
const engine = await import("../src/engine.js");
const { ADDR } = await import("../src/seed.js");

const OWNER = { Authorization: "Bearer owner_demo_mia", "Content-Type": "application/json" };
const AGENT = { Authorization: "Bearer agent_demo_mia", "Content-Type": "application/json" };

async function call(method: string, path: string, headers: Record<string, string>, body?: unknown) {
  const res = await app.request(`/api/v1${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: (await res.json()) as any };
}

const codes = (reasons: { code: string }[]) => reasons.map((r) => r.code).sort();

test("demo script: green, yellow, red", async () => {
  store.resetState();

  // step 2: allowlisted price feed, $0.05 -> green
  const feed = await call("POST", "/agent/pay", AGENT, { offerId: "lst_feed", criteria: "JSON with 50 prices, all from today" });
  assert.equal(feed.json.light, "green", JSON.stringify(feed.json.reasons));
  assert.equal(feed.json.status, "paid");
  assert.match(feed.json.txHash, /^sim_0x[0-9a-f]{64}$/);
  assert.ok(feed.json.orderId);

  // seller delivers, judge (code checks) accepts, window closes -> +0.017
  store.state.clockOffsetMs += 5_000;
  engine.tick();
  await new Promise((r) => setTimeout(r, 20));
  const ord = store.state.orders[feed.json.orderId];
  assert.equal(ord.status, "judged");
  assert.equal(ord.judge?.verdict, "accept", ord.judge?.reason ?? "");
  engine.timewarp(3);
  assert.equal(ord.status, "closed");
  assert.equal(ord.outcome, "accepted");
  assert.ok(Math.abs((ord.pointsAdded ?? 0) - 0.017) < 0.0005, `points ${ord.pointsAdded}`);

  // step 3: $20 report -> yellow with exactly these three reasons
  const rep = await call("POST", "/agent/pay", AGENT, { offerId: "lst_report" });
  assert.equal(rep.json.light, "yellow");
  assert.deepEqual(codes(rep.json.reasons), ["AMOUNT_UNUSUAL", "AUTONOMY_OVER_AUTO_LIMIT", "NEW_PAYEE"]);
  assert.match(rep.json.reasons.find((r: any) => r.code === "AMOUNT_UNUSUAL").message, /^40x/);
  const approvals = await call("GET", "/owner/approvals?status=pending", OWNER);
  const aprId = approvals.json.approvals[0].id;
  const card = await call("GET", `/owner/approvals/${aprId}`, OWNER);
  assert.equal(card.json.payee.name, "MarketReport Lab");
  assert.ok(card.json.sellerText.includes("Weekly market report"));

  // agent token cannot approve
  const sneaky = await call("POST", `/owner/approvals/${aprId}/approve`, AGENT);
  assert.equal(sneaky.status, 401);

  // double tap is safe
  const a1 = await call("POST", `/owner/approvals/${aprId}/approve`, OWNER);
  const a2 = await call("POST", `/owner/approvals/${aprId}/approve`, OWNER);
  assert.equal(a1.json.payment.status, "paid");
  assert.equal(a2.json.payment.txHash, a1.json.payment.txHash);
  assert.equal(store.state.agents.agt_mia.balanceMicro, 50_000_000 - 50_000 - 20_000_000);

  // step 4: AI reads the scam listing, then tries to pay the address in it -> red
  const offers = await call("GET", "/agent/offers?q=price", AGENT);
  assert.ok(offers.json.offers.some((o: any) => o.id === "lst_scam"));
  const scam = await call("POST", "/agent/pay", AGENT, { payTo: ADDR.bad1, amountMicro: 3_000_000, memo: "seller said to pay here" });
  assert.equal(scam.json.light, "red");
  assert.equal(scam.json.status, "blocked");
  const hard = scam.json.reasons.filter((r: any) => r.severity === "hard").map((r: any) => r.code);
  assert.deepEqual(hard, ["OUTSIDE_INSTRUCTION"], "only the command-source check should block a $3 payment");
  assert.ok(codes(scam.json.reasons).includes("RING"));
  assert.ok(scam.json.reasons.find((r: any) => r.code === "RING").evidence.graph.nodes.length >= 5);
  assert.match(scam.json.message, /QuickData/);
});

test("unknown raw address is yellow, not green; pause makes everything red", async () => {
  store.resetState();
  const unknown = await call("POST", "/agent/pay", AGENT, { payTo: "0x" + "12".repeat(20), amountMicro: 100_000 });
  assert.equal(unknown.json.light, "yellow");
  assert.ok(codes(unknown.json.reasons).includes("UNKNOWN_ORIGIN"));

  await call("POST", "/owner/agents/agt_mia/pause", OWNER);
  const paused = await call("POST", "/agent/pay", AGENT, { offerId: "lst_feed" });
  assert.equal(paused.json.light, "red");
  assert.ok(codes(paused.json.reasons).includes("AGENT_PAUSED"));
  // the pending approval from before the pause was cancelled
  const pending = await call("GET", "/owner/approvals?status=pending", OWNER);
  assert.equal(pending.json.approvals.length, 0);
  await call("POST", "/owner/agents/agt_mia/resume", OWNER);
});

test("repeat payment within 10 minutes is flagged; scam delivery goes to the owner", async () => {
  store.resetState();
  await call("POST", "/agent/pay", AGENT, { offerId: "lst_feed" });
  const again = await call("POST", "/agent/pay", AGENT, { offerId: "lst_feed" });
  assert.equal(again.json.light, "yellow");
  assert.ok(codes(again.json.reasons).includes("POSSIBLE_DUPLICATE"));

  // allow the scam listing's category and buy it directly: low score seller
  const buy = await call("POST", "/agent/check", AGENT, { offerId: "lst_scam" });
  assert.ok(codes(buy.json.reasons).includes("PAYEE_LOW_SCORE"));

  const profile = await call("GET", "/public/agents/agt_scam", {});
  assert.equal(profile.json.score, 0);
  assert.ok(profile.json.graph);
  assert.equal(profile.json.recentTrades.every((t: any) => t.points === 0), true);
  const feed = await call("GET", "/public/agents/agt_feed", {});
  assert.equal(feed.json.score, 82);
  assert.equal(feed.json.tier, 3);
});

test("rules validation and agent scope", async () => {
  store.resetState();
  const bad = await call("PUT", "/owner/agents/agt_mia/rules", OWNER, { autoLimitMicro: 30_000_000 });
  assert.equal(bad.status, 400);
  const agentTriesRules = await call("PUT", "/owner/agents/agt_mia/rules", AGENT, { autoLimitMicro: 1 });
  assert.equal(agentTriesRules.status, 401);
  const feed = await call("GET", "/owner/feed", OWNER);
  assert.ok(Array.isArray(feed.json.events));
});
