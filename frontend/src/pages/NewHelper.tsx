import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, Copy, Check } from "lucide-react";
import { api } from "../api";
import type { AgentPolicy, AgentProvider, CreateAgentResponse } from "../api";
import { useStore } from "../store";
import { Celebrate, Seal, Toggle } from "../components/ui";

const PROVIDERS: { id: AgentProvider; name: string; color: string; hint: string }[] = [
  { id: "claude", name: "Claude", color: "#d97757", hint: "Claude Desktop, Claude Code, claude.ai" },
  { id: "gpt", name: "ChatGPT", color: "#10a37f", hint: "ChatGPT apps & connectors" },
  { id: "gemini", name: "Gemini", color: "#4285f4", hint: "Gemini CLI, AI Studio" },
  { id: "other", name: "Something else", color: "#9a9f9b", hint: "Any MCP-capable agent" },
];

export default function NewHelperPage() {
  const nav = useNavigate();
  const { refresh } = useStore();
  const [step, setStep] = useState(0);
  const [prov, setProv] = useState<AgentProvider | null>(null);
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [fund, setFund] = useState("100");
  const [policy, setPolicy] = useState<AgentPolicy>({ autoApproveUpTo: { amount: "50.00", currency: "USD" }, weeklyAllowance: { amount: "200.00", currency: "USD" }, allowedPayees: [], canAddPayees: false, canWithdraw: false, canViewBalances: true });
  const [result, setResult] = useState<CreateAgentResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [celebrating, setParty] = useState(false);

  const create = async () => {
    setBusy(true);
    try { const r = await api.createAgent({ name, provider: prov!, purpose, policy, initialFunding: { amount: Number(fund || 0).toFixed(2), currency: "USDC" } }); setResult(r); await refresh(); setStep(3); setParty(true); }
    finally { setBusy(false); }
  };
  const config = result ? JSON.stringify({ mcpServers: { sigil: { url: result.mcpConfig.url, key: result.mcpConfig.key } } }, null, 2) : "";

  return (
    <div style={{ maxWidth: 560, margin: "0 auto" }}>
      <button className="btn ghost" style={{ marginLeft: -12, marginBottom: 8 }} onClick={() => (step > 0 && step < 3 ? setStep(step - 1) : nav("/helpers"))}><ChevronLeft /> {step > 0 && step < 3 ? "Back" : "Helpers"}</button>
      <div className="steps">{[0, 1, 2, 3].map((i) => <i key={i} className={i <= step ? "on" : ""} />)}</div>

      {step === 0 && (
        <>
          <div className="page-h"><div><h1>Add a helper</h1><div className="sub">Pick where your AI lives. It gets its own wallet, its own seal, and only the powers you choose.</div></div></div>
          <div className="providers">
            {PROVIDERS.map((p) => <button key={p.id} className={"prov" + (prov === p.id ? " on" : "")} onClick={() => setProv(p.id)}><span className="sq" style={{ background: p.color }} /><span><div>{p.name}</div><div className="small muted" style={{ fontWeight: 400 }}>{p.hint}</div></span></button>)}
          </div>
          <div className="pin"><button className="btn lg block primary" disabled={!prov} onClick={() => setStep(1)}>Continue</button></div>
        </>
      )}

      {step === 1 && (
        <>
          <div className="page-h"><div><h1>What's it for?</h1><div className="sub">A name you'll recognise, and one line on its job. You'll see both every time it moves money.</div></div></div>
          <div className="card stack" style={{ gap: 16 }}>
            <div className="field"><label>Name</label><input className="input" placeholder="Shopper" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></div>
            <div className="field"><label>Its job</label><input className="input" placeholder="Buys the weekly groceries" value={purpose} onChange={(e) => setPurpose(e.target.value)} /></div>
            <div className="field"><label>Start it off with</label><div className="row input" style={{ gap: 6 }}><span className="muted">$</span><input style={{ border: 0, outline: 0, flex: 1, fontSize: 15 }} inputMode="decimal" value={fund} onChange={(e) => setFund(e.target.value.replace(/[^\d.]/g, ""))} /><span className="faint small">from your main wallet</span></div></div>
          </div>
          <div className="pin"><button className="btn lg block primary" disabled={!name || !purpose} onClick={() => setStep(2)}>Continue</button></div>
        </>
      )}

      {step === 2 && (
        <>
          <div className="page-h"><div><h1>Its powers</h1><div className="sub">Start small. You can loosen these any time from its page.</div></div></div>
          <div className="card" style={{ padding: "6px 22px" }}>
            <div className="kv"><span>Can pay without asking, up to</span><div className="row" style={{ gap: 6 }}><span className="muted">$</span><input className="input num" style={{ width: 110, textAlign: "right" }} inputMode="decimal" value={policy.autoApproveUpTo.amount} onChange={(e) => setPolicy({ ...policy, autoApproveUpTo: { ...policy.autoApproveUpTo, amount: e.target.value.replace(/[^\d.]/g, "") } })} /></div></div>
            <div className="kv"><span>Weekly allowance</span><div className="row" style={{ gap: 6 }}><span className="muted">$</span><input className="input num" style={{ width: 110, textAlign: "right" }} inputMode="decimal" value={policy.weeklyAllowance.amount} onChange={(e) => setPolicy({ ...policy, weeklyAllowance: { ...policy.weeklyAllowance, amount: e.target.value.replace(/[^\d.]/g, "") } })} /></div></div>
            <div className="kv"><span>Look at balances</span><Toggle on={policy.canViewBalances} onChange={(v) => setPolicy({ ...policy, canViewBalances: v })} /></div>
            <div className="kv"><span>Pay new places without asking</span><Toggle on={policy.canAddPayees} onChange={(v) => setPolicy({ ...policy, canAddPayees: v })} /></div>
            <div className="kv"><span>Withdraw to cash</span><Toggle on={policy.canWithdraw} onChange={(v) => setPolicy({ ...policy, canWithdraw: v })} /></div>
          </div>
          <div className="hint" style={{ marginTop: 10 }}>Anything bigger or newer than this comes to your phone first. Nothing moves until you say so.</div>
          <div className="pin"><button className="btn lg block sage" disabled={busy} onClick={create}>{busy ? "Creating its wallet…" : `Create ${name}'s wallet`}</button></div>
        </>
      )}

      {step === 3 && result && celebrating && (
        <Celebrate title={<>{result.agent.name} is sealed.</>} primary={{ label: `Connect to ${PROVIDERS.find((p) => p.id === prov)?.name}`, onClick: () => setParty(false) }} secondary={{ label: "Later", onClick: () => nav(`/helpers/${result.agent.id}`) }} foot="Takes about a minute. We'll walk you through it.">
          It has its own wallet with {Number(fund || 0) > 0 ? `$${Number(fund).toLocaleString("en-US")}` : "nothing"} in it, and it can't spend more than ${Number(policy.autoApproveUpTo.amount).toLocaleString("en-US")} without asking you.
        </Celebrate>
      )}

      {step === 3 && result && !celebrating && (
        <>
          <div className="page-h"><div><h1 className="row" style={{ gap: 10 }}><Seal kind="agent" size="md" /> {result.agent.name} is sealed</h1><div className="sub">One last step: tell {PROVIDERS.find((p) => p.id === prov)?.name} about it. Paste this where it keeps its tools.</div></div></div>
          <div className="code"><pre style={{ font: "inherit", whiteSpace: "pre-wrap" }}>{config}</pre>
            <button className="btn" style={{ position: "absolute", right: 10, top: 10, padding: "6px 10px" }} onClick={() => { navigator.clipboard?.writeText(config); setCopied(true); }}>{copied ? <><Check /> Copied</> : <><Copy /> Copy</>}</button>
          </div>
          <div className="hint" style={{ marginTop: 10 }}>This key is shown once. If you lose it, make a new one from {result.agent.name}'s page.</div>
          <div className="card tint" style={{ marginTop: 18, fontSize: 14 }}>
            <b style={{ fontWeight: 500 }}>Then try saying to {PROVIDERS.find((p) => p.id === prov)?.name}:</b>
            <div className="muted" style={{ marginTop: 6, fontStyle: "italic" }}>“Check my Sigil balance.” · “Pay Wellcome $40 for groceries.”</div>
          </div>
          <div className="pin"><button className="btn lg block primary" onClick={() => nav(`/helpers/${result.agent.id}`)}>Done</button></div>
        </>
      )}
    </div>
  );
}
