import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "aipg-risk-"));
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ADMIN_KEY;

const store = await import("../src/store.js");
const { app } = await import("../src/routes.js");
const engine = await import("../src/engine.js");
const { ADDR } = await import("../src/seed.js");

const OWNER = { Authorization: "Bearer owner_demo_mia", "Content-Type": "application/json" };
const AGENT = { Authorization: "Bearer agent_demo_mia", "Content-Type": "application/json" };
const ADMIN = { "X-Admin-Key": "demo-admin", "Content-Type": "application/json" };

async function call(method: string, path: string, headers: Record<string, string>, body?: unknown) {
  const res = await app.request(`/api/v1${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: (await res.json()) as any };
}
const codes = (reasons: { code: string }[]) => reasons.map((r) => r.code).sort();

test("before anyone is confirmed bad, nobody carries risk (suspicion doesn't spread)", () => {
  store.resetState();
  engine.tick();
  for (const a of Object.values(store.state.agents)) assert.equal(a.risk?.points ?? 0, 0, a.id);
});

test("confirmed fraud: the helper is suspended, the victim is cleared, the scam is banned with its ratings voided", async () => {
  store.resetState();
  engine.tick();
  const res = await call("POST", "/admin/confirm-fraud", ADMIN, { agentId: "agt_scam", note: "Took payment, delivered nothing, fake ratings." });
  assert.equal(res.status, 200);
  // the ban follows the person: QuickData and its rater accounts (same owner)
  assert.deepEqual(res.json.banned.map((b: any) => b.agentId).sort(), ["agt_r1", "agt_r2", "agt_r3", "agt_r4", "agt_scam"]);

  const s = store.state;
  const helper = s.agents.agt_helper.risk!;
  assert.equal(helper.level, "suspended");
  assert.ok(helper.points >= 80, `helper ${helper.points}`);
  assert.ok(["FUNDED_BY_BAD", "RATED_BAD", "TRADES_WITH_BAD", "CAME_AND_WENT_WITH_BAD"].every((c) => codes(helper.reasons).includes(c)), JSON.stringify(helper.reasons));
  assert.equal(s.agents.agt_helper.riskStatus, "suspended");

  // the victim also only ever traded with QuickData, but lost money to it
  const victim = s.agents.agt_newbie.risk!;
  assert.equal(victim.level, "none");
  assert.equal(victim.points, 0);
  assert.deepEqual(codes(victim.reasons), ["VICTIM"]);

  // honest accounts with no links stay at 0
  assert.equal(s.agents.agt_mia.risk?.points ?? 0, 0);
  assert.equal(s.agents.agt_feed.risk?.points ?? 0, 0);

  // the scam's public profile: score 0, nothing to sell
  const prof = (await call("GET", "/public/agents/agt_scam", {})).json;
  assert.equal(prof.score, 0);
  assert.equal(prof.openOrderLimitUsd, "$0.00");
  assert.equal("risk" in prof, false, "risk is never on the public profile (decision 10A)");

  // the gate: paying the banned seller or its helper is now red
  const toScam = await call("POST", "/agent/check", AGENT, { offerId: "lst_scam" });
  assert.equal(toScam.json.light, "red");
  assert.ok(codes(toScam.json.reasons).includes("PAYEE_SCAM_LIST"));
  const toHelper = await call("POST", "/agent/check", AGENT, { payTo: ADDR.helper, amountMicro: 1_000_000 });
  assert.equal(toHelper.json.light, "red");
  assert.ok(codes(toHelper.json.reasons).includes("PAYEE_SUSPENDED"));

  const list = (await call("GET", "/admin/risk", ADMIN)).json.agents;
  assert.equal(list.find((r: any) => r.agentId === "agt_helper").level, "suspended");
});

test("a ban follows the person: no new AI, no resume, no payments", async () => {
  store.resetState();
  engine.tick();
  engine.confirmFraud("agt_scam", "test");
  const quickOwner = { Authorization: "Bearer owner_demo_quick", "Content-Type": "application/json" };
  const fresh = await call("POST", "/owner/agents", quickOwner, { name: "Clean start" });
  assert.equal(fresh.status, 403);
  assert.equal(fresh.json.error.code, "BANNED");

  // a banned AI with spending rules stays blocked even if its owner presses resume
  store.resetState();
  engine.tick();
  engine.confirmFraud("agt_mia", "test");
  assert.equal((await call("POST", "/owner/agents/agt_mia/resume", OWNER)).status, 403);
  store.state.agents.agt_mia.status = "active"; // even if something flips it back
  const pay = await call("POST", "/agent/pay", AGENT, { offerId: "lst_feed" });
  assert.equal(pay.json.light, "red");
  assert.match(pay.json.reasons.find((r: any) => r.code === "AGENT_PAUSED").message, /banned/);
});

test("a restricted seller drops one tier and payers see a yellow reason", async () => {
  store.resetState();
  engine.tick();
  const report = store.state.agents.agt_report;
  const before = engine.creditOf("agt_report");
  report.riskStatus = "restricted";
  const after = engine.creditOf("agt_report");
  assert.equal(after.tier, before.tier - 1);
  assert.ok(after.openOrderLimitMicro < before.openOrderLimitMicro);
  const check = await call("POST", "/agent/check", AGENT, { offerId: "lst_report" });
  assert.ok(codes(check.json.reasons).includes("PAYEE_RESTRICTED"));
});

test("the owner is told about their own AI's risk; non-admins can't confirm fraud", async () => {
  store.resetState();
  engine.tick();
  const me = (await call("GET", "/owner/me", OWNER)).json;
  assert.deepEqual(me.agents[0].risk, { level: "none", points: 0, reasons: [] });
  const sneaky = await call("POST", "/admin/confirm-fraud", OWNER, { agentId: "agt_feed" });
  assert.equal(sneaky.status, 401);
});

test("a scammer can't wash its helper by failing one order to it (Frank 2A)", async () => {
  store.resetState();
  engine.tick();
  store.state.trades.push({
    id: "trd_wash", sellerAgentId: "agt_scam", buyerAgentId: "agt_helper", amountMicro: 100_000, outcome: "failed",
    factors: { outcome: -2, amount: 0, evidence: 1, independence: 0, buyerTrust: 1, pair: 1 }, points: 0, at: store.now() - 3_600_000,
  });
  engine.confirmFraud("agt_scam", "test");
  const helper = store.state.agents.agt_helper.risk!;
  assert.deepEqual(codes(helper.reasons), ["FUNDED_BY_BAD", "VICTIM"]);
  assert.equal(helper.points, 40);
  assert.equal(helper.level, "watch");
  // the real victim is still cleared
  assert.equal(store.state.agents.agt_newbie.risk!.points, 0);
});
