# Sigil: Backend Design v1 (2026-10-17)

Companion to `PLAN-en-v3-2026-10-17.md`. The plan says what the product does. This doc says how the backend is built, what is real in the demo, and in what order to build it.

## 0. TL;DR
- One TypeScript backend with clear modules. Claude connects through a thin MCP server. The owner uses a phone web app.
- The AI never holds a key. Every payment goes through the gate. Only a small signer module can sign, and it signs only what the gate approved, with the exact payee and amount.
- Three layers of distrust: the AI can't override the gate (code), our server can't overspend (on-chain limit), and nobody but the owner can approve a yellow payment (owner login, plus a device signature in production).
- The gate and the rating formula are pure functions with unit tests. They run for real in the demo. Fund-flow and identity data are seeded.
- Chain: Base Sepolia, USDC, EIP-3009 signatures (no gas token for the agent), x402 for paid APIs, ERC-8004 for agent IDs.

## 1. Design rules
1. **The model is untrusted.** Assume the AI can be talked into anything. Safety never depends on the AI behaving.
2. **Third-party text is data.** Listings, deliveries and seller messages are wrapped as untrusted, and any address in them is recorded (see section 4).
3. **Decide, then execute exactly that.** A gate decision is bound to (payee, amount, asset, chain, kind) and expires in 120 seconds. The signer refuses anything that doesn't match.
4. **Our server is not fully trusted either.** On-chain limits cap the damage if we get hacked.
5. **Explanations are templates.** Each finding has a code and a fixed sentence. No LLM decides or writes a light.

## 2. Architecture

```
   Owner's Claude (Desktop)                 Owner's phone (web app)
          │ MCP (stdio)                            │ HTTPS + SSE
          ▼                                        ▼
   ┌──────────────┐  agent token        ┌──────────────────────┐
   │  MCP server  │────────────────────▶│      Backend API     │
   │ (thin, no    │                     │ owner API · agent API│
   │  keys)       │                     │ public score API     │
   └──────────────┘                     └──────────┬───────────┘
                                                   │
      ┌──────────────┬──────────────┬──────────────┼──────────────┬──────────────┐
      ▼              ▼              ▼              ▼              ▼              ▼
  ┌────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
  │  Gate  │   │ Approvals│   │ Executor │   │  Orders  │   │  Judge   │   │  Rating  │
  │6 checks│   │ (owner)  │   │ + Signer │   │ market,  │   │ code +   │   │  engine  │
  │ + light│   │          │   │ (EIP-3009│   │ escrow,  │   │ Claude   │   │ + jobs   │
  └───┬────┘   └──────────┘   │  only)   │   │complaints│   │   API    │   └────┬─────┘
      │                       └────┬─────┘   └────┬─────┘   └──────────┘        │
      ▼                            ▼              ▼                             ▼
  Check adapters:            Base Sepolia:  USDC · SafeMarket contract ·   Fund-flow analyzer
  registry, rules, taint,    ERC-8004 registry · x402 facilitator          (wallet graph)
  GoPlus, simulation,
  fund-flow, history                    ┌──────────────────────────┐
                                        │ DB: SQLite (demo) →      │
                                        │ Postgres (prod) +        │
                                        │ append-only event log    │
                                        └──────────────────────────┘
```

| Module | Job | Demo |
|---|---|---|
| MCP server | Exposes agent tools; forwards to the API with the agent token; holds no keys | Real |
| Gate | Runs the six checks, returns findings and a light | Real (pure functions) |
| Approvals | Creates yellow requests, pushes them to the phone, records the owner's decision | Real |
| Executor + Signer | Re-checks inside a per-agent lock, then signs one EIP-3009 authorization and submits it | Real |
| Orders | Listings, orders, deliveries, escrow, complaints | Real; escrow contract is P1 |
| Judge | Code checks plus a separate Claude call that can only accept or reject | Real |
| Rating engine | Points per trade, decay, caps, score, tier; nightly trust and limit jobs | Real formula, seeded inputs |
| Fund-flow analyzer | Wallet age, funding source, distance to bad wallets, loops | Real algorithm, seeded graph |
| Identity | Owner verification level, agent cap, bans | Mock provider |

## 3. The payment path

```
AI calls pay(...)
  → create PaymentIntent (dedupe: same agent+payee+amount within 60s returns the earlier intent)
  → Gate: run 6 checks → findings[] → light
  → RED:    block, notify owner, return reasons to the AI
  → YELLOW: create Approval, push to phone, return "waiting for owner" + approval_id
  → GREEN:  Executor
Executor (also runs when the owner approves a yellow):
  → take per-agent lock
  → re-run the cheap checks (paused? caps? payee unchanged?)
  → Signer signs EIP-3009 for the exact decision
  → submit (x402 retry, or relayer tx for a transfer or escrow)
  → record tx hash, emit events, release lock
```

**Findings.** Each check returns zero or more findings: `{check, severity: hard | soft, code, message, evidence}`.

| Check | Hard (red) | Soft (yellow) |
|---|---|---|
| 1 Command source | `OUTSIDE_INSTRUCTION`: raw payee first seen in third-party text | `UNKNOWN_ORIGIN`: raw payee we never saw (owner may have typed it) |
| 2 Owner rules | `CAP_PER_TX`, `CAP_DAILY`, `AGENT_PAUSED`, `CATEGORY_BLOCKED` | |
| 3 Payee | `PAYEE_SCAM_LIST`, `PAYEE_SANCTIONED`, `PAYTO_CHANGED` (x402 payTo differs from the registry), `SELLER_AT_LIMIT` | `NEW_PAYEE`, `PAYEE_UNVERIFIED`, `PAYEE_LOW_SCORE`, `LEVEL1_LARGE_ORDER` |
| 4 Fund flow | `DIRECT_BAD_LINK` (1 hop from a known scam wallet) | `YOUNG_WALLET`, `NEAR_BAD`, `RING`, `PASS_THROUGH` |
| 5 Simulation | `SIM_MISMATCH` (moves a different amount), `UNLIMITED_APPROVAL` | |
| 6 Unusual amount | | `AMOUNT_UNUSUAL` (over 5× the median of the last 20), `FREQ_UNUSUAL` |

**Light rules (fixed code):**
```
if any hard finding                         → RED
elif any soft finding                       → YELLOW
elif autonomy == ASK_ALWAYS                 → YELLOW ("your setting: ask every time")
elif autonomy == SMALL_AUTO
     and amount > auto_threshold            → YELLOW ("above your auto limit")
elif autonomy == APPROVED_AUTO
     and payee not in allowlist
     and amount > auto_threshold            → YELLOW
else                                        → GREEN
```

**Details that prevent real bugs:**
- **Retries.** LLMs retry tool calls. Dedupe on (agent, payee, amount) within 60 seconds, plus an optional client idempotency key.
- **Races.** Two payments at once could both pass the daily cap. Caps are checked inside a per-agent lock at execution time, not only at decision time.
- **Change between check and pay.** For x402, the payTo and amount in the 402 response must equal the decision. If they don't, abort (`PAYTO_CHANGED`).
- **Money as integers.** Store USDC as integer micro-units (6 decimals). Never floats.
- **Audit.** Every decision stores its findings, inputs and a hash of the rules version in an append-only event log. Complaints and score explanations read from it.

## 4. How "command source" actually works
We don't control Claude's agent loop, so we can't run full CaMeL. We get most of its benefit from data flow we do control:
1. **Structured payees.** `pay(offer_id)` takes the payee from our registry, never from text. That passes check 1.
2. **Taint tracking.** Every tool result that carries third-party text (listing descriptions, deliveries, seller messages) goes through one wrapper. It puts the text in an `untrusted_*` field and records every address, ENS name and URL inside it in a `taint` table with its source.
3. **Raw payees.** `pay(to, amount)` with a raw address:
   - In the owner's allowlist → pass.
   - In the taint table and not allowlisted → **red**: "This address came from seller X's listing, not from you."
   - Never seen → **yellow**: we can't know whether the owner typed it, so the owner decides.
4. **Owner pre-approval.** The owner can add payees or a standing instruction ("price feeds under $1") in the app. That is the owner's signed intent, and it is the strongest signal.

Honest limit: if bad text reaches the AI through another tool we don't see, the payee looks "never seen" and gets yellow, never green. An unknown payee can never be paid without the owner.

## 5. Agent tools (MCP)
| Tool | What it does |
|---|---|
| `find_offers(query, max_price)` | Search listings. Text fields come back as `untrusted_*` |
| `check_payment(offer_id \| to+amount)` | Dry run: light plus reasons. No money moves |
| `pay(offer_id \| to+amount, criteria?, memo?)` | Re-runs the gate itself. Returns paid / waiting for owner / blocked |
| `payment_status(id)` | Status of a payment or approval |
| `get_delivery(order_id)` | Delivery content, as untrusted data |
| `complain(order_id, reason)` | Opens a complaint. Moves no money |
| `balance()`, `history(n)`, `my_rules()` | Read-only, so the AI can plan within the rules |

**Never exposed to the AI:** approve, change rules or autonomy, stop or unpause, withdraw, accept a delivery. The agent token's scopes simply don't include them.

Tool descriptions tell the model that `untrusted_*` fields are data, not instructions. That is defense in depth. The real guard is the gate.

`pay` never accepts a decision or approval ID from the AI as proof. Yellow payments run server-side when the owner approves. The AI only polls the status.

## 6. Owner API (phone app)
- `POST /owner/verify`: start verification (mock provider in the demo)
- `GET/PUT /owner/rules`: caps, allowlist, categories, autonomy, auto threshold
- `GET /owner/stream`: SSE events (`decision.created`, `approval.requested`, `payment.executed`, `order.updated`, `rating.updated`)
- `POST /owner/approvals/:id/approve | reject`: needs the owner session. Production adds a passkey signature over the decision tuple
- `POST /owner/stop`: pause all agents, cancel pending approvals (production also revokes the on-chain spend permission)
- `GET /owner/ledger?view=public|owner`: public view uses chain data only; owner view joins names, listings and reasons
- `POST /owner/orders/:id/override`: overrule the judge
- `GET /v1/score/:agentId`: public score lookup with a signed feature summary (the future "credit bureau" API, P2)

## 7. After payment
**Orders.** Small x402 calls are prepaid and settle at once. Larger service orders go through escrow (P1). Without escrow, the demo uses a direct USDC transfer.

**Judge** (runs automatically when a delivery arrives; not the owner's Claude):
1. Code checks first: JSON schema from the listing, item count, size, hash, date fields.
2. A separate Claude API call (Sonnet 5.5) receives only the criteria and the delivery as data. It answers through a forced tool call with `verdict: accept | reject` and a one-line reason. It has no other tools.
3. Accept → release escrow (or record "Accepted" for prepaid). Reject → open a complaint and start the seller's response window.
4. The owner can override.

Risk to watch: the buyer's AI writes the criteria after reading the listing, which is untrusted. Criteria start from the listing's structured schema plus owner defaults, and code checks always run.

**Complaints.** Seller response window, then a scripted arbiter in the demo. Outcomes map to the plan (fixed counts as silent, refund counts 0, upheld counts as failed).

**Rating engine:**
- On every finished trade (Accepted / Silent / Failed / Refunded): `points = outcome × amountW × independence × buyerTrust`, stored with a timestamp and a per-trade feature summary (hash, signed by the scorer key).
- At read time: decay each trade by `0.5^(age_days / 90)`, apply the 1/k per-pair cap, compute `P`, `N`, `score = 100 × P / (P + N + 10)`, then cap the rise at 10 points per week.
- Nightly jobs: EigenTrust from seed wallets → `buyerTrust`. Refresh fund-flow features → `independence`. Recount distinct verified buyers → tier. Push each seller's open-order limit to the contract.
- Window closers: when a complaint window ends with no complaint → auto-release → "Silent". **The demo needs a time-warp admin button** (`POST /admin/time-warp?hours=72`), because real windows last days.

**Fund-flow analyzer.** Production indexes USDC transfers on Base into a wallet graph (Postgres first) and caches features per address. The demo runs the same code on a seeded graph JSON, including a scam wallet that funded the 4 wallets that rated it. That graph is the loop chart.

## 8. Contracts
**Demo (P1): one contract, `SafeMarket.sol`:**
- `deposit / withdraw`: seller bond; withdraw blocked while exposure > 0 or a window is open
- `openOrder(orderId, seller, payout, amount, windowEnd, criteriaHash, auth)`: our relayer submits it; it pulls the buyer's USDC with `receiveWithAuthorization` (EIP-3009) and requires `exposure[seller] + amount ≤ limit[seller]`
- `release(orderId)`: buyer operator, after judge acceptance
- `autoRelease(orderId)`: anyone, after `windowEnd` with no dispute
- `dispute(orderId)`: buyer operator, before `windowEnd`
- `resolve(orderId, refund, slashAmount)`: arbiter role; a slash pays the victim from the bond
- `setLimit(seller, limit)`: scorer role (rating engine)

**Demo wallet model: budget wallet.** Each agent has an EOA whose key lives only in the signer. The owner tops it up with a budget (e.g. $50). Worst case = that balance. The agent needs only USDC. Our relayer pays gas on Base Sepolia.

**Production:**
| Piece | Choice |
|---|---|
| Spending limit on-chain | Owner's smart wallet + spend permission per period (e.g. Base Smart Wallet Spend Permissions or Safe Allowance Module). The owner revokes it on-chain |
| Signer key | KMS or a policy wallet (e.g. CDP Server Wallet, Turnkey), with its own max-amount policy as a second backstop |
| Agent ID | ERC-8004 Identity Registry; agentURI JSON shows the owner's badge level |
| Owner badge | Attestation (e.g. EAS on Base); Coinbase Verified is already an EAS attestation on Base |
| Reputation export | Post scores to the ERC-8004 Reputation Registry |
| Private receiving | ERC-5564 stealth payouts (P2) |

## 9. Data model (core tables)
```
owners(id, level, country, sanctions_status, provider_ref, banned_at)
agents(id, owner_id, wallet_address, erc8004_id, autonomy, auto_threshold, status)
owner_rules(agent_id, per_tx_cap, daily_cap, allowlist[], categories[], rules_hash)
listings(id, seller_agent_id, title, untrusted_description, price, pay_to, x402_url,
         category, delivery_schema, window_hours)
taint(agent_id, value, kind, source_type, source_id, seen_at)
payment_intents(id, agent_id, source[offer|raw], offer_id, payee, amount_micro,
                memo, idem_key, status, created_at)
decisions(id, intent_id, light, findings_json, rules_hash, expires_at)
approvals(id, decision_id, status, decided_by, decided_at, expires_at, device_sig)
executions(id, decision_id, kind[x402|transfer|escrow], tx_hash, status)
orders(id, buyer_agent, seller_agent, amount_micro, escrow_order_id, criteria,
       criteria_hash, window_ends_at, status)
deliveries(order_id, payload_ref, hash, code_checks_json)
judgments(order_id, verdict, reason, model, overridden_by)
complaints(id, order_id, filed_by, status, outcome)
rating_events(id, order_id, seller_agent, buyer_agent, outcome, amount_w,
              independence, buyer_trust, points, finished_at, feature_hash, scorer_sig)
scores(seller_agent, p, n, score, tier, distinct_buyers, score_7d_ago, updated_at)
wallet_graph(from_addr, to_addr, amount_micro, ts)          -- seeded in demo
events(id, type, entity_id, payload_json, ts)                -- append-only
```

## 10. Demo script → backend calls
| Step | What happens in the backend |
|---|---|
| 1 Mia verifies and connects | `POST /owner/verify` (mock → level 2). Claude Desktop runs our MCP server with her agent token. `PUT /owner/rules`: autonomy = SMALL_AUTO, auto threshold $5, per-payment cap $25 |
| 2 $0.05 feed, green | `find_offers` → `pay(offer_id=feed, criteria)`. All checks pass → GREEN. Signer signs EIP-3009 for the exact payTo and amount → x402 retry → data returns as untrusted → judge accepts → rating event → seller score updates on the phone |
| 3 $20 report, yellow | `pay(offer_id=report)` → `AMOUNT_UNUSUAL` and above the auto limit → YELLOW → SSE to the phone → Mia approves → Executor re-checks in the lock → transfer (escrow in P1) |
| 4 Scam, red | The AI read the scam listing; the wrapper recorded its address. `pay(to=0xBAD…, 50)` → `OUTSIDE_INSTRUCTION` (hard), `CAP_PER_TX` (hard), `PAYEE_UNVERIFIED`, `YOUNG_WALLET`, `RING` → RED. Blocked, owner notified, loop chart from the fund-flow evidence |
| 5 Ledger | `GET /owner/ledger?view=public` vs `view=owner` |

## 11. Real vs mock, and build order
**P0: the demo works end to end**
1. Freeze the API contract (shared TypeScript types plus mock JSON) so the frontend can build against it right away.
2. `packages/gate` with all checks, findings and light rules, plus unit tests for the 3 demo cases.
3. Seed data: Mia, 3 sellers, the scam ring graph, 20 past payments for Mia's agent (so $20 is unusual).
4. API + SQLite + event log + SSE + approvals + stop button.
5. MCP server with the tools in section 5 and the taint wrapper.
6. Executor + Signer: direct USDC transfer via EIP-3009 through our relayer on Base Sepolia.
7. Judge (code checks + Claude call) and rating engine with the real formula on seeded inputs.
8. Time-warp button and a "replay" mode that plays recorded responses if the chain or wifi fails.

**P1: makes it credible**
- Real x402 seller (`@x402/express`) and buyer path with the gate between the 402 and the signature. Time-box it to 90 minutes, then fall back to the P0 transfer.
- `SafeMarket.sol` escrow + bond on Base Sepolia.
- Register the demo agents in the ERC-8004 Identity Registry on Base Sepolia.
- Live GoPlus call. A testnet address will come back clean, so the scam flag in the demo comes from our seed list. Say so if asked.

**P2: only if time is left**
- Stealth payouts for step 5 (otherwise the public ledger view is a mock screen).
- Badge attestation on-chain, public score API, signed feature summaries page.

## 12. Stack and setup
- Node 22, TypeScript, Hono, Drizzle + SQLite (Postgres later), viem, `@modelcontextprotocol/sdk`, `@anthropic-ai/sdk`, Foundry.
- x402 v2 packages: `@x402/core`, `@x402/evm`, `@x402/express` (seller). For the buyer side, see the x402 "Quickstart for Buyers". Don't let an auto-pay wrapper pay on its own: run the gate between the 402 and signing, and refuse if payTo or amount differ from the decision.
- Base Sepolia (`eip155:84532`). USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e`. x402 testnet facilitator `https://x402.org/facilitator`. ERC-8004 Identity Registry `0x8004A818BFB912233c491871b3d84c89A494BD9e`, Reputation Registry `0x8004B663056A597Dffe9eCcC1965A193B7388713`.
- Repo layout:
```
ai-pay-safety/
  packages/gate/     checks, findings, light rules (pure, tested)
  packages/rating/   points, decay, caps, score, tier (pure, tested)
  packages/types/    shared API types (frozen first)
  apps/api/          owner API, agent API, SSE, executor, signer, judge, jobs, seed
  apps/mcp/          MCP server (stdio), thin client of apps/api
  apps/sellers/      demo sellers: feed (x402), report, scam
  apps/owner/        phone web app
  contracts/         SafeMarket.sol + tests + deploy script (P1)
  seed/              owners, agents, listings, wallet graph, payment history
```

## 13. Premortem: "the demo failed on stage. Why?"
| Why it failed | Prevention |
|---|---|
| Claude refused to pay the scam address, so there was no red to show | Claude often resists injection. Test the scam text many times. Keep a fallback "naive agent" (a small scripted agent loop) that does fall for it. The pitch line: "Even when the AI falls for it, the gate stops it" |
| Chain, faucet or RPC was slow | Pre-fund every wallet, use a keyed RPC, pre-run every flow, keep replay mode and a backup video |
| x402 ate the night | 90-minute time-box, then P0 transfer |
| Frontend and backend didn't fit | Freeze types and mock JSON in the first 30 minutes |
| A judge asked "how do you know the owner asked?" | Section 4 |
| Venue wifi died | Run everything on the laptop; phone on the laptop's hotspot; tunnel only as a backup |
| The AI approved its own payment | Agent token has no approve scope. Approve endpoints check the owner session. Test it |

## 14. Security checklist
1. Keys never in the frontend or the MCP config. The MCP server holds only a scoped agent token.
2. No client talks to the DB directly. Everything goes through the API.
3. Default deny: every owner endpoint checks the owner session and that the agent belongs to that owner.
4. No ID documents or names in our tables. Store level, country, sanctions result and the provider reference only.
5. Rate limits are not authorization. Approve, stop and rules endpoints need auth regardless.
6. Assume anything the phone app can call, the AI or an attacker can also call. The server re-checks everything.

## 15. Demo → production
| Area | Demo | Production |
|---|---|---|
| Process | One Node process | Split the signer first (key isolation), then the rating jobs |
| DB | SQLite | Postgres + queue (e.g. Postgres-backed or Redis) |
| Wallet | Budget EOA, key in env | Smart wallet + spend permission, signer in KMS or a policy wallet |
| Approval | Owner login | Login + passkey signature over the decision tuple; push notifications |
| Fund flow | Seeded graph | Indexer on Base + cached features |
| Payee lists | Seed list + live GoPlus | GoPlus, Chainalysis, our own fraud labels |
| Simulation | `eth_call` / viem simulate | Blockaid or Tenderly |
| Identity | Mock | World ID / Coinbase Verified / Persona or Stripe Identity / business check |
| Arbiter | Scripted | Bonded independent arbiters |
| Score oracle | Our key sets limits | Same key + public signed feature summaries; ZK later |
