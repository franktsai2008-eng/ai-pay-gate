import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, type Agent, type Party, type Transaction, type User, type Wallet } from "./api";

interface State {
  ready: boolean;
  me: User | null;
  wallets: Wallet[];
  parties: Party[];
  agents: Agent[];
  txs: Transaction[];
  toast: string | null;
}

interface Actions {
  refresh(): Promise<void>;
  approve(id: string): Promise<void>;
  decline(id: string): Promise<void>;
  pause(id: string, paused: boolean): Promise<void>;
  removeAgent(id: string): Promise<void>;
  notify(msg: string): void;
  party(id: string): Party | undefined;
  wallet(id: string): Wallet | undefined;
  agent(id: string): Agent | undefined;
}

const Ctx = createContext<(State & Actions) | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [s, set] = useState<State>({ ready: false, me: null, wallets: [], parties: [], agents: [], txs: [], toast: null });

  const refresh = useCallback(async () => {
    const [me, wallets, parties, agents, txs] = await Promise.all([api.me(), api.wallets(), api.parties(), api.agents(), api.transactions()]);
    set((p) => ({ ...p, ready: true, me, wallets, parties, agents, txs }));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const notify = useCallback((msg: string) => {
    set((p) => ({ ...p, toast: msg }));
    setTimeout(() => set((p) => (p.toast === msg ? { ...p, toast: null } : p)), 3200);
  }, []);

  useEffect(() => {
    return api.subscribe((e) => {
      set((p) => {
        switch (e.type) {
          case "tx.created": return { ...p, txs: [e.tx, ...p.txs.filter((t) => t.id !== e.tx.id)] };
          case "tx.updated": return { ...p, txs: p.txs.map((t) => (t.id === e.tx.id ? e.tx : t)) };
          case "agent.updated": return { ...p, agents: p.agents.some((a) => a.id === e.agent.id) ? p.agents.map((a) => (a.id === e.agent.id ? e.agent : a)) : [...p.agents, e.agent], parties: p.parties.some((x) => x.id === e.agent.id) ? p.parties.map((x) => (x.id === e.agent.id ? e.agent : x)) : [...p.parties, e.agent] };
          case "wallet.updated": return { ...p, wallets: p.wallets.map((w) => (w.id === e.wallet.id ? e.wallet : w)) };
        }
      });
      if (e.type === "tx.created" && e.tx.status === "pending_approval") {
        const who = e.tx.initiatedBy;
        set((p) => { const a = p.agents.find((x) => x.id === who); notify(`${a?.name ?? "A helper"} is asking for your okay`); return p; });
      }
    });
  }, [notify]);

  const value = useMemo<State & Actions>(() => ({
    ...s,
    refresh,
    notify,
    async approve(id) { await api.approve(id); await refresh(); notify("Approved. Sealed and sent."); },
    async decline(id) { await api.decline(id); await refresh(); notify("Declined. Nothing moved."); },
    async pause(id, paused) { await api.pauseAgent(id, paused); await refresh(); notify(paused ? "Paused. It can't spend until you resume." : "Resumed."); },
    async removeAgent(id) { await api.removeAgent(id); await refresh(); notify("Removed. Its money is back in your main wallet."); },
    party: (id) => s.parties.find((p) => p.id === id),
    wallet: (id) => s.wallets.find((w) => w.id === id),
    agent: (id) => s.agents.find((a) => a.id === id),
  }), [s, refresh, notify]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore outside provider");
  return v;
}

/* ---------- helpers ---------- */

export const fmtMoney = (m: { amount: string; currency: string }, opts: { sign?: boolean } = {}) => {
  const n = Number(m.amount);
  const abs = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sym = m.currency === "USD" || m.currency === "USDC" || m.currency === "USDT" ? "$" : m.currency === "HKD" ? "HK$" : m.currency + " ";
  const sign = opts.sign ? (n > 0 ? "+" : n < 0 ? "−" : "") : n < 0 ? "−" : "";
  return `${sign}${sym}${abs}`;
};

export const fmtWhen = (iso: string) => {
  const d = new Date(iso), now = Date.now(), diff = (now - d.getTime()) / 60_000;
  if (diff < 1) return "just now";
  if (diff < 60) return `${Math.round(diff)} min ago`;
  if (diff < 60 * 24 && d.getDate() === new Date().getDate()) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (diff < 60 * 24 * 7) return d.toLocaleDateString("en-US", { weekday: "short" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

export const minutesLeft = (iso?: string) => (iso ? Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60_000)) : null);

export const explainFlag = (f: Transaction["flags"][number], agentName: string) => {
  switch (f.code) {
    case "over_auto_limit": return `More than ${agentName} can spend on its own (${fmtMoney(f.limit)})`;
    case "new_payee": return "First time paying this place";
    case "unsealed_payee": return "This wallet isn't sealed. We don't know who it is";
    case "over_weekly_allowance": return `Would go over this week's allowance (${fmtMoney(f.remaining)} left)`;
    case "unusual_time": return "Unusual time of day for this helper";
  }
};
