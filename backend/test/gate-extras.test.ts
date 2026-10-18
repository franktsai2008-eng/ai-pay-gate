import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "aipg-extras-"));
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ADMIN_KEY;
delete process.env.DEMO_PASSCODE;

const store = await import("../src/store.js");
const { app } = await import("../src/routes.js");
const engine = await import("../src/engine.js");
const { ADDR } = await import("../src/seed.js");

const OWNER = { Authorization: "Bearer owner_demo_mia", "Content-Type": "application/json" };
const AGENT = { Authorization: "Bearer agent_demo_mia", "Content-Type": "application/json" };
const ADMIN = { "X-Admin-Key": "demo-admin" };

async function call(method: string, path: string, headers: Record<string, string>, body?: unknown) {
  const res = await app.request(`/api/v1${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: (await res.json()) as any };
}
const codes = (reasons: { code: string }[]) => reasons.map((r) => r.code).sort();
const check = async (payTo: string, usd = 1) => (await call("POST", "/agent/check", AGENT, { payTo, amountMicro: usd * 1_000_000 })).json;

test("public-list and fund-flow lights: scam list, sanctions, one and two steps away, pass-through", async () => {
  store.resetState();
  const listed = await check(ADDR.listedScam);
  assert.equal(listed.light, "red");
  assert.ok(codes(listed.reasons).includes("PAYEE_SCAM_LIST"));

  const sanctioned = await check(ADDR.sanctioned);
  assert.equal(sanctioned.light, "red");
  assert.ok(codes(sanctioned.reasons).includes("PAYEE_SANCTIONED"));

  const mule1 = await check(ADDR.mule1);
  assert.equal(mule1.light, "red");
  assert.ok(codes(mule1.reasons).includes("DIRECT_BAD_LINK"));

  const mule2 = await check(ADDR.mule2);
  assert.equal(mule2.light, "yellow");
  assert.ok(codes(mule2.reasons).includes("NEAR_BAD"));
  assert.ok(!codes(mule2.reasons).includes("DIRECT_BAD_LINK"));

  const pass = await check(ADDR.passThrough);
  assert.equal(pass.light, "yellow");
  assert.ok(codes(pass.reasons).includes("PASS_THROUGH"));

  // the main demo's scam address is untouched: still only the command-source check blocks it
  await call("GET", "/agent/offers?q=premium", AGENT);
  const scam = await check(ADDR.bad1, 3);
  assert.deepEqual(scam.reasons.filter((r: any) => r.severity === "hard").map((r: any) => r.code), ["OUTSIDE_INSTRUCTION"]);
  assert.ok(!codes(scam.reasons).includes("NEAR_BAD") && !codes(scam.reasons).includes("PASS_THROUGH"));
});

test("an owner who never verified identity can spend at most $5 a day, across all their AIs", async () => {
  store.resetState();
  store.state.owners.own_mia.badgeLevel = 0;
  // a second AI of the same owner already spent $4 today
  const second = (await call("POST", "/owner/agents", OWNER, { name: "Second" })).json.agent.id;
  store.state.payments.pay_x = { id: "pay_x", agentId: second, source: "raw", payTo: ADDR.report, amountMicro: 4_000_000, status: "paid", light: "green", reasons: [], rulesVersion: 1, createdAt: store.now() - 60_000, auto: true };
  const two = await check(ADDR.report, 2);
  assert.ok(codes(two.reasons).includes("CAP_DAILY"), "2 + 4 > 5 across the owner");
  delete store.state.payments.pay_x;
  const big = await check(ADDR.report, 6);
  const cap = big.reasons.find((r: any) => r.code === "CAP_DAILY");
  assert.ok(cap, JSON.stringify(big.reasons));
  assert.match(cap.message, /Unverified owners/);
  store.state.owners.own_mia.badgeLevel = 2;
  const ok = await check(ADDR.report, 6);
  assert.ok(!codes(ok.reasons).includes("CAP_DAILY"));
});

test("changing the withdraw address needs the passcode every time", async () => {
  store.resetState();
  const target = "0x" + "cd".repeat(20);
  const stale = await call("PUT", "/owner/withdraw-address", OWNER, { address: target });
  assert.equal(stale.status, 401);
  assert.equal(stale.json.error.code, "REAUTH_REQUIRED");
  const wrong = await call("PUT", "/owner/withdraw-address", OWNER, { address: target, passcode: "nope" });
  assert.equal(wrong.status, 401);
  const withPass = await call("PUT", "/owner/withdraw-address", OWNER, { address: target, passcode: "demo" });
  assert.equal(withPass.status, 200);
  // someone else logging in doesn't open a window for a stolen token
  await call("POST", "/owner/login", { "Content-Type": "application/json" }, { email: "mia@example.com", passcode: "demo" });
  const tokenOnly = await call("PUT", "/owner/withdraw-address", OWNER, { address: "0x" + "ef".repeat(20) });
  assert.equal(tokenOnly.status, 401);
  // guessing is cut off per client
  const hdr = { ...OWNER, "cf-connecting-ip": "203.0.113.9" };
  for (let i = 0; i < 10; i++) await call("PUT", "/owner/withdraw-address", hdr, { address: target, passcode: `guess${i}` });
  assert.equal((await call("PUT", "/owner/withdraw-address", hdr, { address: target, passcode: "demo" })).status, 429);
  assert.equal((await call("PUT", "/owner/withdraw-address", OWNER, { address: target, passcode: "demo" })).status, 200, "other clients unaffected");
});

test("every gate decision lands in a hash-chained, append-only log", async () => {
  store.resetState();
  const green = await call("POST", "/agent/pay", AGENT, { offerId: "lst_feed" });
  const yellow = await call("POST", "/agent/pay", AGENT, { offerId: "lst_report" });
  await call("GET", "/agent/offers?q=premium", AGENT);
  const red = await call("POST", "/agent/pay", AGENT, { payTo: ADDR.bad1, amountMicro: 3_000_000 });
  const apr = (await call("GET", "/owner/approvals?status=pending", OWNER)).json.approvals[0].id;
  await call("POST", `/owner/approvals/${apr}/approve`, OWNER);

  const stages = async (id: string) => (await call("GET", `/owner/payments/${id}`, OWNER)).json.decisionLog.map((e: any) => `${e.stage}:${e.light}`);
  assert.deepEqual(await stages(green.json.paymentId), ["request:green", "recheck:green"]);
  assert.deepEqual(await stages(yellow.json.paymentId), ["request:yellow", "recheck:green"]);
  assert.deepEqual(await stages(red.json.paymentId), ["request:red"]);
  const redEntry = (await call("GET", `/owner/payments/${red.json.paymentId}`, OWNER)).json.decisionLog[0];
  assert.equal(redEntry.input.payTo, ADDR.bad1);
  assert.equal(redEntry.rulesVersion, 3);

  const intact = await call("GET", "/admin/decision-log", ADMIN);
  assert.deepEqual([intact.json.valid, intact.json.entries], [true, 5]);
  // quietly editing an old entry breaks the chain at that entry
  store.state.decisionLog![1].input.amountMicro = 1;
  const broken = await call("GET", "/admin/decision-log", ADMIN);
  assert.deepEqual([broken.json.valid, broken.json.brokenAt], [false, 2]);
  assert.equal(engine.verifyDecisionLog().valid, false);
  // cutting the last entry off is caught against the stored head
  store.resetState();
  await call("POST", "/agent/pay", AGENT, { offerId: "lst_feed" });
  assert.equal(engine.verifyDecisionLog().valid, true);
  store.state.decisionLog!.pop();
  assert.equal(engine.verifyDecisionLog().valid, false);
});
