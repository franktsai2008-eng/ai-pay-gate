import type { SigilClient } from "./client";
import type { Event } from "./types";

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
      const es = new EventSource(`${baseUrl}/events${getToken() ? `?token=${getToken()}` : ""}`);
      es.onmessage = (m) => onEvent(JSON.parse(m.data) as Event);
      return () => es.close();
    },
  };
}
