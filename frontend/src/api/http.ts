import type { SigilClient } from "./client";
import type { Agent, Event, Transaction, Wallet } from "./types";

/** Real backend adapter. Every method maps 1:1 to contract/openapi.yaml. */
export function createHttpClient(baseUrl: string, getToken: () => string | null): SigilClient {
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(baseUrl + path, {
      method,
      headers: {
        "content-type": "application/json",
        ...(getToken() ? { authorization: `Bearer ${getToken()}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (res.status === 401 && typeof location !== "undefined" && location.pathname !== "/login") {
        // not signed in, or the token stopped working: go sign in
        localStorage.removeItem("sigil.token");
        location.assign("/login");
      }
      throw new Error(err.message ?? `${method} ${path} failed (${res.status})`);
    }
    return res.status === 204 ? (undefined as T) : res.json();
  }

  return {
    me: () => call("GET", "/me"),
    startVerification: (method) => call("POST", "/me/verification", { method }),
    wallets: () => call("GET", "/wallets"),
    parties: () => call("GET", "/parties"),
    agents: () => call("GET", "/agents"),
    agent: (id) => call("GET", `/agents/${id}`),
    createAgent: (req) => call("POST", "/agents", req),
    updateAgentPolicy: (id, req) => call("PATCH", `/agents/${id}/policy`, req),
    pauseAgent: (id, paused) => call("POST", `/agents/${id}/${paused ? "pause" : "resume"}`),
    removeAgent: (id) => call("DELETE", `/agents/${id}`),
    transactions: (opts) => {
      const q = new URLSearchParams();
      if (opts?.status) q.set("status", opts.status.join(","));
      if (opts?.limit) q.set("limit", String(opts.limit));
      return call("GET", `/transactions${q.size ? "?" + q : ""}`);
    },
    send: (req) => call("POST", "/transactions", req),
    approve: (id) => call("POST", `/transactions/${id}/approve`),
    decline: (id, reason) => call("POST", `/transactions/${id}/decline`, { reason }),
    subscribe: (onEvent) => {
      if (!getToken()) return () => {}; // nothing to listen to until signed in
      // The stream and the poller below can both report the same thing; the UI toasts on tx.created, so dedupe by id.
      const seen = new Set<string>();
      const emit = (e: Event) => {
        if (e.type === "tx.created") {
          if (seen.has(e.tx.id)) return;
          seen.add(e.tx.id);
        }
        onEvent(e);
      };
      // The stream is opened with a one-time ticket, so the sign-in token never appears in a URL.
      let es: EventSource | null = null;
      let stopped = false;
      let retry: ReturnType<typeof setTimeout> | null = null;
      const openStream = async () => {
        if (stopped) return;
        try {
          const { ticket } = await call<{ ticket: string }>("POST", "/events/ticket");
          if (stopped) return;
          es = new EventSource(`${baseUrl}/events?ticket=${encodeURIComponent(ticket)}`);
          es.onmessage = (m) => emit(JSON.parse(m.data) as Event);
          es.onerror = () => {
            es?.close();
            es = null;
            if (!stopped) retry = setTimeout(openStream, 5000); // a ticket is single use, so reconnect with a new one
          };
        } catch {
          if (!stopped) retry = setTimeout(openStream, 5000);
        }
      };
      openStream();
      // Some tunnels and proxies hold a stream back, so also poll. Same objects, same replace-by-id rule.
      const known = new Map<string, string>();
      let first = true;
      const poll = async () => {
        try {
          const [txs, agents, wallets] = await Promise.all([call<Transaction[]>("GET", "/transactions"), call<Agent[]>("GET", "/agents"), call<Wallet[]>("GET", "/wallets")]);
          for (const tx of txs) {
            const sig = `${tx.status}|${tx.flags.length}|${tx.settledAt ?? ""}`;
            if (!known.has(tx.id)) {
              if (first) seen.add(tx.id);
              else emit({ type: "tx.created", tx });
            } else if (known.get(tx.id) !== sig) emit({ type: "tx.updated", tx });
            known.set(tx.id, sig);
          }
          if (!first) {
            for (const agent of agents) emit({ type: "agent.updated", agent });
            for (const wallet of wallets) emit({ type: "wallet.updated", wallet });
          }
          first = false;
        } catch {
          /* offline or signed out; the next tick tries again */
        }
      };
      poll();
      const timer = setInterval(poll, 2500);
      return () => {
        stopped = true;
        es?.close();
        if (retry) clearTimeout(retry);
        clearInterval(timer);
      };
    },
  };
}
