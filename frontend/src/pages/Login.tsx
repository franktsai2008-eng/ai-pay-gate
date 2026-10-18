import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound } from "lucide-react";
import { isMock } from "../api";
import { Seal } from "../components/ui";

const base = import.meta.env.VITE_API_URL as string | undefined;

/**
 * Sign-in for the real backend: the demo passcode set on the server.
 * The backend answers with the owner token, which http.ts sends on every call.
 * In mock mode there is nothing to sign in to, so this just goes home.
 */
export default function LoginPage() {
  const nav = useNavigate();
  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (isMock || !base) {
      nav("/");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${base}/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.token) throw new Error(data.message ?? "Sign-in failed.");
      localStorage.setItem("sigil.token", data.token);
      // full reload, so the store and the live event stream start with the token
      location.assign("/");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="wash" style={{ minHeight: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <form className="card" style={{ maxWidth: 440, width: "100%", padding: 36, textAlign: "center", borderRadius: 28 }} onSubmit={submit}>
        <Seal size="lg" />
        <div className="serif" style={{ fontSize: 30, marginTop: 22 }}>Sigil</div>
        <h1 className="serif" style={{ fontSize: 28, lineHeight: 1.15, marginTop: 18 }}>Welcome back.</h1>
        <p className="plain" style={{ margin: "14px 0 24px" }}>Enter your passcode to see your money and your helpers.</p>
        <div className="row input" style={{ gap: 10 }}>
          <KeyRound size={16} className="faint" />
          <input
            style={{ border: 0, outline: 0, flex: 1, fontSize: 16 }}
            type="password"
            autoComplete="current-password"
            placeholder="Passcode"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            autoFocus
          />
        </div>
        {error && <div className="small" style={{ color: "var(--red)", marginTop: 10 }}>{error}</div>}
        <button className="btn lg block primary" style={{ marginTop: 18 }} type="submit" disabled={busy || (!isMock && !passcode)}>{busy ? "Checking…" : "Sign in"}</button>
        <button className="btn lg block ghost" style={{ marginTop: 8 }} type="button" onClick={() => nav("/welcome")}>I'm new here</button>
      </form>
    </div>
  );
}
