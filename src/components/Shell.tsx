import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Home, Bot, Inbox, Clock, Send, Plus, Search, Bell, User } from "lucide-react";
import { useStore } from "../store";
import { Mark, Seal, Toast } from "./ui";
import { ApprovalHost } from "./Approval";

export default function Shell() {
  const { agents, txs, me } = useStore();
  const nav = useNavigate();
  const waiting = txs.filter((t) => t.status === "pending_approval").length;

  const items = [
    { to: "/", label: "Home", icon: Home, end: true },
    { to: "/helpers", label: "Helpers", icon: Bot },
    { to: "/waiting", label: "Waiting on you", short: "Waiting", icon: Inbox, badge: waiting },
    { to: "/activity", label: "Activity", icon: Clock },
  ];

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <NavLink to="/" className="word"><Mark size={28} />Sigil</NavLink>
          <div className="row" style={{ gap: 14, opacity: .75 }}><Bell size={16} /><Search size={16} /></div>
        </div>
        <nav className="stack" style={{ gap: 2 }}>
          <NavLink to="/send"><Send /> Send money</NavLink>
          {items.map((it) => (
            <NavLink key={it.to} to={it.to} end={it.end}>
              <it.icon /> {it.label}
              {it.badge ? <span className="badge" style={{ marginLeft: "auto" }}>{it.badge}</span> : null}
            </NavLink>
          ))}
        </nav>
        <h5>Your helpers</h5>
        <div className="sub stack" style={{ gap: 0 }}>
          {agents.map((a) => (
            <NavLink key={a.id} to={`/helpers/${a.id}`}>{a.seal === "sealed" ? <Mark size={18} /> : <Seal kind="agent" state={a.seal} size="xs" />}{a.name} <span style={{ color: "#8b918d", fontSize: 12 }}>· {provName(a.provider)}</span></NavLink>
          ))}
          <NavLink to="/helpers/new" style={{ color: "#9fd3b8" }}><Plus size={14} /> Add a helper</NavLink>
        </div>
        <button className="me" onClick={() => nav("/you")}>
          <Seal size="sm" light />{me?.name ?? "You"}
        </button>
      </aside>

      <main className="main"><Outlet /></main>

      <nav className="tabbar">
        {items.map((it) => (
          <NavLink key={it.to} to={it.to} end={it.end}>
            <it.icon /> {it.short ?? it.label}
            {it.badge ? <span className="badge">{it.badge}</span> : null}
          </NavLink>
        ))}
        <NavLink to="/you"><User /> You</NavLink>
      </nav>

      <ApprovalHost />
      <Toast />
    </div>
  );
}

export const provName = (p: string) => ({ claude: "Claude", gpt: "ChatGPT", gemini: "Gemini", other: "MCP" }[p] ?? p);
