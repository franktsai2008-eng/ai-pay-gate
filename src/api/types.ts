/**
 * Sigil API contract — shared with the backend.
 * This file is the source of truth for request/response shapes.
 * Mirrors contract/openapi.yaml. Change both together.
 */

export type ID = string;
export type ISODate = string; // "2026-10-18T06:12:45Z"
export type Money = { amount: string; currency: "USDC" | "USDT" | "ETH" | "BTC" | "HKD" | "USD" }; // amount as decimal string

export type SealState = "sealed" | "unsealed" | "paused";

/** Any party that can hold or move money: a person, an agent, or a business. */
export interface Party {
  id: ID;
  kind: "person" | "agent" | "business";
  name: string;
  seal: SealState;
  sealedAt?: ISODate;
  avatarUrl?: string;
}

export interface Wallet {
  id: ID;
  ownerId: ID; // Party.id (person or agent)
  label: string;
  address: string;
  balance: Money;
  fiatBalance: Money; // display currency
  change24h: Money; // signed
}

export type AgentProvider = "claude" | "gpt" | "gemini" | "other";

export interface AgentPolicy {
  /** Can spend up to this per transaction without asking. */
  autoApproveUpTo: Money;
  /** Rolling weekly allowance. */
  weeklyAllowance: Money;
  /** Party ids this agent may pay. Empty = ask every time for new payees. */
  allowedPayees: ID[];
  canAddPayees: boolean;
  canWithdraw: boolean;
  canViewBalances: boolean;
}

export interface Agent extends Party {
  kind: "agent";
  ownerId: ID; // the human who vouches for it
  provider: AgentProvider;
  purpose: string; // "buys groceries weekly"
  walletId: ID;
  policy: AgentPolicy;
  spentThisWeek: Money;
  lastActiveAt?: ISODate;
  /** MCP connection details. Secret is only returned once, at creation. */
  mcp: { url: string; keyHint: string; connected: boolean };
}

export type TxStatus = "pending_approval" | "approved" | "declined" | "settled" | "failed" | "expired";

export interface Transaction {
  id: ID;
  fromWalletId: ID;
  toPartyId: ID;
  initiatedBy: ID; // Party.id (human or agent)
  amount: Money;
  fiatAmount: Money;
  status: TxStatus;
  memo?: string;
  createdAt: ISODate;
  settledAt?: ISODate;
  /** Why this needed a human. Empty when auto-approved. */
  flags: TxFlag[];
  /** Agent's own explanation, when initiated by an agent. */
  reason?: string;
  expiresAt?: ISODate;
}

export type TxFlag =
  | { code: "over_auto_limit"; limit: Money }
  | { code: "new_payee" }
  | { code: "unsealed_payee" }
  | { code: "over_weekly_allowance"; remaining: Money }
  | { code: "unusual_time" };

export interface User extends Party {
  kind: "person";
  email: string;
  displayCurrency: Money["currency"];
  verification: { status: "none" | "pending" | "verified"; method?: "id" | "passkey"; at?: ISODate };
}

/* ---------- Requests ---------- */

export interface SendRequest {
  fromWalletId: ID;
  to: { partyId: ID } | { address: string };
  amount: Money;
  memo?: string;
}

export interface CreateAgentRequest {
  name: string;
  provider: AgentProvider;
  purpose: string;
  policy: AgentPolicy;
  initialFunding?: Money;
}

export interface CreateAgentResponse {
  agent: Agent;
  /** Full MCP config to paste. Shown once. */
  mcpConfig: { url: string; key: string };
}

export interface UpdatePolicyRequest extends Partial<AgentPolicy> {}

/* ---------- Realtime ---------- */

export type Event =
  | { type: "tx.created"; tx: Transaction }
  | { type: "tx.updated"; tx: Transaction }
  | { type: "agent.updated"; agent: Agent }
  | { type: "wallet.updated"; wallet: Wallet };
