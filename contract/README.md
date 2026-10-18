# Sigil — frontend ⇄ backend handover

The UI is built against a **contract**, not against the backend. That is what makes integration a one-line switch.

## The three files that matter

| File | Owner | What it is |
|---|---|---|
| `src/api/types.ts` | shared | TypeScript shapes for every object and request. Source of truth. |
| `contract/openapi.yaml` | shared | Same shapes as HTTP endpoints. Backend implements this. |
| `src/api/mock.ts` | frontend | In-memory fake that the UI runs on today. Behaves like the real thing, including approval flow and live events. |

`src/api/http.ts` is the real adapter. It already maps every method to a path in the YAML. Nothing in the UI imports it directly; the UI only ever sees the `SigilClient` interface in `src/api/client.ts`.

## How we switch

```
VITE_API_URL=https://api.sigil.money/v1 npm run dev
```

No `VITE_API_URL` → mock. With it → real backend. Zero UI changes.

## Rules that keep this painless

1. **Change the contract first, together.** New field? Edit `types.ts` and `openapi.yaml` in the same commit, then both sides build against it. Never let the backend invent a shape the UI hasn't seen.
2. **Money is a decimal string** (`"220.00"`), never a float. Currency is always attached.
3. **Timestamps are ISO 8601 UTC.**
4. **Every party has a `seal`.** sealed / unsealed / paused. The UI draws nothing without it.
5. **Agent transactions that need a human come back as `pending_approval` with `flags[]`** explaining why. The UI renders flags in plain words; the backend decides them from `AgentPolicy`.
6. **`/events` is server-sent events.** When a transaction changes status, push `tx.updated`. This is how the phone buzzes while the agent waits.
7. **MCP server is backend-owned.** It exposes the agent's tools (balance, pay, request_approval). It calls the same internal service as `POST /transactions`, so policy is enforced in one place.

## What the backend can start on today, independent of the UI

- Auth and `/me`, verification (`/me/verification`)
- Wallet custody and `/wallets`
- Policy engine: given `AgentPolicy` + a proposed transfer → `auto` or `pending_approval` + `flags`
- `/transactions` create / approve / decline, with expiry
- `/events` stream
- MCP server for agents, with per-agent keys

## Quick conformance check

Run the UI in mock mode, then point it at a dev backend. Every screen should look identical with real data. If something breaks, the contract was violated somewhere, and `types.ts` will tell you where.


## Charts and history

The hero charts (balance over time, a helper's spend against its allowance) are
derived on the client from settled transactions, in `src/series.ts`. No history
endpoint is needed for v1. If you later want server-side history (for long
ranges or many transactions), add `GET /wallets/:id/history?range=1W` returning
`[{ t: ISODate, v: Money }]` and swap the helpers in that one file.

`Agent.spentThisWeek` must agree with the settled transactions since Monday
00:00 in the user's timezone, because the helper page shows both side by side.
