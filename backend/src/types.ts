export type Light = "green" | "yellow" | "red";
export type Severity = "hard" | "soft";
export type CheckName = "source" | "rules" | "payee" | "flow" | "simulation" | "amount" | "autonomy";
export type Autonomy = "ask_always" | "small_auto" | "allowlist_auto";
export type PaymentStatus = "blocked" | "awaiting_owner" | "sending" | "paid" | "rejected" | "cancelled" | "failed";
export type BadgeLevel = 0 | 1 | 2 | 3;

export interface Reason {
  check: CheckName;
  code: string;
  severity: Severity;
  message: string;
  evidence?: Record<string, unknown>;
}

export interface Owner {
  id: string;
  name: string;
  email: string;
  badgeLevel: BadgeLevel;
  withdrawAddress: string;
  token: string;
  /** real time (not the demo clock) of the last passcode login; sensitive changes need a recent one */
  lastLoginAt?: number;
}

export interface Rules {
  autonomy: Autonomy;
  autoLimitMicro: number;
  perTxCapMicro: number;
  dailyCapMicro: number;
  autoTotal24hMicro: number;
  allowlist: { address: string; label: string }[];
  categories: string[];
  version: number;
}

export interface SellerProfile {
  /** already-decayed history from before the demo, so the seed doesn't need hundreds of trades */
  baselineP: number;
  baselineN: number;
  baselineTrades: number;
  baselineDistinctBuyers: number;
  scoreWeekAgo: number;
  depositMicro: number;
  scripted: "feed" | "report" | "scam" | "generic";
}

export interface Agent {
  id: string;
  ownerId: string;
  name: string;
  status: "active" | "paused";
  walletAddress: string;
  balanceMicro: number;
  token: string;
  rules?: Rules;
  seller?: SellerProfile;
  /** buyer trust (0..1): last value from credit.computeTrust (at order close and in the nightly recompute) */
  buyerTrust: number;
  /** audited account: a seed that trust spreads out from */
  preTrusted?: boolean;
  /** confirmed fraud by arbitration (SPEC 5); only arbitration sets this, never the risk score */
  banned?: { at: number; note: string };
  /** risk points (SPEC 5): internal; told to the owner, never shown on the public profile */
  risk?: { points: number; level: RiskLevel; reasons: RiskReason[]; at: number };
  riskStatus: "none" | "restricted" | "suspended";
}

export type RiskLevel = "none" | "watch" | "restricted" | "suspended";

export interface RiskReason {
  code: string;
  points: number;
  message: string;
}

export interface Listing {
  id: string;
  sellerAgentId: string;
  title: string;
  untrustedDescription: string;
  priceMicro: number;
  payTo: string;
  category: string;
  deliveryKind: "prices" | "report" | "generic";
  windowMinutes: number;
}

export interface Payment {
  id: string;
  agentId: string;
  source: "offer" | "raw";
  offerId?: string;
  payTo: string;
  amountMicro: number;
  memo?: string;
  criteria?: string;
  status: PaymentStatus;
  light: Light;
  reasons: Reason[];
  rulesVersion: number;
  createdAt: number;
  auto: boolean;
  approvalId?: string;
  orderId?: string;
  nonce?: string;
  validBefore?: number;
  txHash?: string;
  failMessage?: string;
  seeded?: boolean;
}

export interface Approval {
  id: string;
  paymentId: string;
  ownerId: string;
  status: "pending" | "approved" | "rejected" | "expired";
  createdAt: number;
  expiresAt: number;
  decidedAt?: number;
}

export type Outcome = "accepted" | "silent" | "refunded" | "failed" | "no_result";

export interface Order {
  id: string;
  paymentId: string;
  listingId: string;
  buyerAgentId: string;
  sellerAgentId: string;
  amountMicro: number;
  criteria: string;
  status: "awaiting_delivery" | "delivered" | "judged" | "closed";
  createdAt: number;
  deliverAfter: number;
  deliverBy: number;
  windowEndsAt?: number;
  delivery?: { content: string; hash: string; at: number; route: "pipe" | "link" | "offplatform" };
  codeCheck?: { passed: boolean; notes: string[] };
  judge?: { verdict: "accept" | "reject"; reason: string; by: "ai" | "code" };
  ownerReview?: { reason: string };
  override?: "accept" | "reject";
  outcome?: Outcome;
  pointsAdded?: number;
}

export interface Trade {
  id: string;
  orderId?: string;
  sellerAgentId: string;
  buyerAgentId: string;
  amountMicro: number;
  outcome: Outcome;
  factors: { outcome: number; amount: number; evidence: number; independence: number; buyerTrust: number; pair: number };
  points: number;
  at: number;
  /** how the goods were delivered (evidence factor); pre-demo trades count as "pipe" */
  route?: "pipe" | "link" | "offplatform";
  /** plain-language reason for each factor, shown on the public profile (no names or addresses) */
  notes?: { outcome: string; evidence: string; independence: string; buyerTrust: string; pair: string };
  independenceCode?: string;
  recomputedAt?: number;
}

export interface TaintEntry {
  agentId: string;
  value: string;
  sourceType: "listing" | "delivery" | "message";
  sourceId: string;
  sourceName: string;
  excerpt: string;
  at: number;
}

export interface WalletInfo {
  address: string;
  label: string;
  createdAt: number;
  fundedBy: string[];
  verifiedOwnerWallet?: boolean;
  /** owner this verified wallet belongs to */
  ownerId?: string;
  exchange?: boolean;
  scamList?: boolean;
  sanctioned?: boolean;
  ring?: string;
}

export interface Graph {
  nodes: { id: string; label: string; kind: string }[];
  edges: { from: string; to: string; label: string }[];
}

/** One gate decision, append-only and hash-chained (SPEC 10): what came in, which rules, what came out. */
export interface DecisionLogEntry {
  seq: number;
  at: number;
  stage: "request" | "recheck";
  paymentId: string;
  agentId: string;
  input: { source: "offer" | "raw"; offerId: string | null; payTo: string; amountMicro: number; memo: string | null };
  rulesVersion: number;
  light: Light;
  reasons: { check: CheckName; code: string; severity: Severity; message: string }[];
  prevHash: string;
  hash: string;
}

export interface FeedEvent {
  id: number;
  ownerId: string;
  type: string;
  at: number;
  data: Record<string, unknown>;
}

export interface State {
  seq: number;
  eventSeq: number;
  clockOffsetMs: number;
  owners: Record<string, Owner>;
  agents: Record<string, Agent>;
  listings: Record<string, Listing>;
  payments: Record<string, Payment>;
  approvals: Record<string, Approval>;
  orders: Record<string, Order>;
  trades: Trade[];
  taint: TaintEntry[];
  wallets: Record<string, WalletInfo>;
  graphs: Record<string, Graph>;
  events: FeedEvent[];
  reports: { id: string; ownerId: string; paymentId: string; note: string; at: number }[];
  /** last nightly recompute (demo clock); undefined means run it on the next tick */
  lastRecomputeAt?: number;
  /** append-only gate decision log; optional so older snapshots still load */
  decisionLog?: DecisionLogEntry[];
  /** last entry's seq and hash, kept apart from the log so cutting entries off the end shows; production publishes it */
  decisionHead?: { seq: number; hash: string };
}
