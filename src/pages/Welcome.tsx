import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Fingerprint, IdCard } from "lucide-react";
import { api } from "../api";
import { Seal } from "../components/ui";

/** First run: one promise, one button, one verification. */
export default function WelcomePage() {
  const nav = useNavigate();
  const [step, setStep] = useState<0 | 1>(0);
  const [busy, setBusy] = useState<"passkey" | "id" | null>(null);
  const verify = async (m: "passkey" | "id") => { setBusy(m); await api.startVerification(m); nav("/"); };

  return (
    <div className="wash" style={{ minHeight: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div className="card" style={{ maxWidth: 440, width: "100%", padding: 36, textAlign: "center", borderRadius: 28 }}>
        <Seal size="lg" />
        <div className="serif" style={{ fontSize: 30, marginTop: 22 }}>Sigil</div>
        {step === 0 ? (
          <>
            <h1 className="serif" style={{ fontSize: 30, lineHeight: 1.15, marginTop: 18 }}>Money you can hand to an AI<br />without losing sleep.</h1>
            <p className="plain" style={{ margin: "16px 0 26px" }}>One wallet for you, one for each helper you trust. Everyone is sealed before they can move a cent, and your helpers stop and ask when something's new.</p>
            <button className="btn lg block primary" onClick={() => setStep(1)}>Get sealed · 2 min</button>
            <button className="btn lg block ghost" style={{ marginTop: 8 }} onClick={() => nav("/")}>I already have an account</button>
          </>
        ) : (
          <>
            <h1 className="serif" style={{ fontSize: 28, lineHeight: 1.15, marginTop: 18 }}>Prove it's you, once.</h1>
            <p className="plain" style={{ margin: "14px 0 24px" }}>Your seal is what tells everyone, people and agents, that you're real. Pick how you'd like to do it.</p>
            <button className="btn lg block primary" disabled={!!busy} onClick={() => verify("passkey")}><Fingerprint /> {busy === "passkey" ? "Checking…" : "Face ID or Touch ID"}</button>
            <button className="btn lg block" style={{ marginTop: 8 }} disabled={!!busy} onClick={() => verify("id")}><IdCard /> {busy === "id" ? "Checking…" : "Photo of my ID"}</button>
            <div className="hint" style={{ marginTop: 16 }}>We never show your documents to anyone. Only the seal.</div>
          </>
        )}
      </div>
    </div>
  );
}
