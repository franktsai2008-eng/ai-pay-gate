# Sigil — handover for backend integration

Written 2026-10-18. This is the one page to read before touching the backend.
Everything else is detail: `contract/README.md` (the rules), `contract/openapi.yaml`
(the endpoints), `src/api/types.ts` (the shapes).

## What Sigil is, in three lines

People own wallets. They give AI agents ("helpers") their own wallet with an
allowance and rules. Anything outside the rules stops and asks the person. Every
party, human, helper or business, carries a visible seal that says "we know who
this is". Agents talk to Sigil through an MCP server; humans through this app.

## What exists today

- A complete UI: web, responsive down to 390px, React 19 + Vite + TypeScript.
  Screens: Welcome, Home, Send, Helpers, Helper detail, New helper (4 steps),
  Waiting on you (approvals), Activity, You.
- It runs on an **in-memory mock** (`src/api/mock.ts`) that behaves like the real
  backend: policy checks, pending approvals, expiry, live events.
- A **contract** the mock and the real backend both satisfy:
  `src/api/client.ts` (the `SigilClient` interface) ⇄ `contract/openapi.yaml`.
- The **HTTP adapter** (`src/api/http.ts`) already maps every method to the YAML
  paths. It has never been run against a real server, because there isn't one yet.
- Brand: the mark is `public/sigil-mark.svg` (also the favicon). Source and the
  mockup boards are in `brand/`.

## Run it

```
npm install
npm run dev            # mock mode, http://localhost:5173
npm run build          # tsc + vite, must stay clean
```

Switch to a real backend with one variable, no code change:

```
VITE_API_URL=http://localhost:8080/v1 npm run dev
```

Auth today: the adapter sends `Authorization: Bearer <token>` with the token read
from `localStorage["sigil.token"]`. There is **no login screen yet**; that is
built once the backend decides how sign-in works (see open questions).

## What the backend has to provide

All of it is in `contract/openapi.yaml`. In order of what unblocks the UI:

| Order | Endpoints | Unblocks |
|---|---|---|
| 1 | `GET /me`, `GET /wallets`, `GET /parties`, `GET /agents` | Home, Helpers, sidebar render with real data |
| 2 | `GET /transactions`, `POST /transactions` | Activity, Send |
| 3 | Policy engine + `POST /transactions/{id}/approve|decline` | Waiting on you |
| 4 | `GET /events` (SSE) | Live updates, the phone buzzing while a helper waits |
| 5 | `POST /agents`, `PATCH /agents/{id}/policy`, pause/resume, delete | New helper, limits, remove |
| 6 | `POST /me/verification` | Sealing the user |
| 7 | MCP server with per-agent keys | Helpers can actually act |

### Non-negotiables (the UI assumes these)

- Money is `{ amount: "220.00", currency: "USD" }`. Decimal string, never a float.
- Timestamps are ISO 8601 UTC strings.
- Every `Party` has `seal: "sealed" | "unsealed" | "paused"`.
- An agent payment that needs a human comes back `status: "pending_approval"`
  with `flags[]` from this set, and nothing else:
  `over_auto_limit {limit}`, `new_payee`, `unsealed_payee`,
  `over_weekly_allowance {remaining}`, `unusual_time`.
  The UI turns each into a plain sentence. New flag → tell the frontend first.
- `Agent.spentThisWeek` equals the sum of that agent's settled transactions since
  Monday 00:00 in the user's timezone. The helper page shows both side by side.
- `POST /agents` returns `mcpConfig: { url, key }` **once**. Afterwards only
  `agent.mcp.keyHint` (last 4 chars) and `connected` are ever returned.
- `/events` pushes `tx.created`, `tx.updated`, `agent.updated`, `wallet.updated`,
  each carrying the full object. The UI replaces, it does not merge.
- Expired approvals: backend flips to `expired`; the UI only shows the countdown
  from `expiresAt`.

### Policy engine, the one piece of logic that matters

Input: an `AgentPolicy` and a proposed transfer. Output: `auto` (settle it) or
`pending_approval` + `flags`. The mock does **not** implement this; its pending
transactions are seeded with flags. The backend owns the decision. The rules the
UI copy already promises the user:

- amount > `policy.autoApproveUpTo` → `over_auto_limit`
- payee not in `policy.allowedPayees` and `!policy.canAddPayees` → `new_payee`
- payee `seal !== "sealed"` → `unsealed_payee`
- `spentThisWeek + amount > policy.weeklyAllowance` → `over_weekly_allowance`
- `policy.canWithdraw === false` and the transfer is a withdrawal → reject outright
- any flag at all → `pending_approval`, `expiresAt` = now + 15 min

The MCP server's `pay` tool must go through the same function as `POST /transactions`.

## Charts and history

Derived on the client from settled transactions (`src/series.ts`). No history
endpoint needed for v1. If long ranges get slow, add
`GET /wallets/{id}/history?range=1W` → `[{ t, v }]` and swap the helpers in
that one file.

## How to verify you're done

1. Run the UI in mock mode and click through every screen. That is the spec.
2. Point it at the dev backend with `VITE_API_URL`. Every screen should look the
   same with real data. Anything that breaks is a contract violation, and
   `src/api/types.ts` will say where.
3. Create a helper, paste its MCP config into Claude, ask it to pay something
   over its limit. The approval must show up in Waiting on you within a second
   (that is the SSE path), and swiping approve must settle it.

## Open questions for the backend owner

- **Sign-in.** Passkey, magic link, or wallet signature? The UI will add a login
  screen to match; today it only expects a bearer token.
- **Chain and custody.** The UI shows a fiat figure per wallet (`fiatBalance`) and
  a crypto one (`balance`). Which chains, and who holds keys, is entirely backend.
- **Verification provider** for "seal the user" (`POST /me/verification`).
- **Business seals.** How does a merchant get `sealed`? The UI just displays it.

## Rules for changing the contract

Change `src/api/types.ts` and `contract/openapi.yaml` in the same commit, then
update `src/api/mock.ts` so the UI still runs without a backend. Never let the
backend invent a shape the UI hasn't seen.

## Not in a repo yet

`~/crypto` is not under git. First step for whoever takes this: `git init`,
commit, push, and add the backend as a sibling repo or a folder here.
