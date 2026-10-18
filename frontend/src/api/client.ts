import type {
  Agent, CreateAgentRequest, CreateAgentResponse, Event, ID, Party, SendRequest,
  Transaction, UpdatePolicyRequest, User, Wallet,
} from "./types";

/**
 * The one interface the UI talks to. Two implementations:
 *  - mock.ts   (in-memory, used until the backend is ready)
 *  - http.ts   (fetch against VITE_API_URL, same shapes)
 */
export interface SigilClient {
  me(): Promise<User>;
  startVerification(method: "id" | "passkey"): Promise<User>;

  wallets(): Promise<Wallet[]>;
  parties(): Promise<Party[]>;

  agents(): Promise<Agent[]>;
  agent(id: ID): Promise<Agent>;
  createAgent(req: CreateAgentRequest): Promise<CreateAgentResponse>;
  updateAgentPolicy(id: ID, req: UpdatePolicyRequest): Promise<Agent>;
  pauseAgent(id: ID, paused: boolean): Promise<Agent>;
  removeAgent(id: ID): Promise<void>;

  transactions(opts?: { status?: Transaction["status"][]; limit?: number }): Promise<Transaction[]>;
  send(req: SendRequest): Promise<Transaction>;
  approve(txId: ID): Promise<Transaction>;
  decline(txId: ID, reason?: string): Promise<Transaction>;

  /** Server-sent events / websocket. Returns unsubscribe. */
  subscribe(onEvent: (e: Event) => void): () => void;
}
