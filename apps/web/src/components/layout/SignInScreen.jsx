import React from "react";
import { AlertCircle, ArrowRight, Layers, Mail, ShieldCheck, Users2, Zap } from "lucide-react";
import Brand from "../ui/Brand";
import DevLogin from "../dev/DevLogin";

/** Shown to anyone without a session. `authError`/`error` come from the URL/API; `onRetry` re-fetches the session. */
export default function SignInScreen({ authError, error, onRetry }) {
  return (
    <div className="signin">
      <section className="sign-hero">
        <Brand />
        <div>
          <h1>One calm place for client delivery.</h1>
          <p>Tickets, tasks, teams and chat — organised per client, with the right access for everyone.</p>
        </div>
        <div className="sign-points">
          <div><Layers size={18} /> Tickets turn into tasks automatically</div>
          <div><Users2 size={18} /> Role-based access for staff and clients</div>
          <div><Zap size={18} /> Live chat and notifications</div>
        </div>
      </section>
      <section className="sign-right">
        <div className="sign-card">
          <h2>Sign in</h2>
          <p>Use the Google account your invitation was sent to.</p>
          {authError === "not_invited" && <div className="error" role="alert"><AlertCircle size={18} />This Google account hasn’t been invited yet. Ask a Tendrils administrator to invite this exact email address.</div>}
          {authError === "1" && <div className="error" role="alert"><AlertCircle size={18} />Sign-in failed. Please try again with a Google account whose email is verified.</div>}
          {error && <div className="error" role="alert"><AlertCircle size={18} />{error}</div>}
          <a className="google" href="/auth/signin">Continue with Google <ArrowRight size={17} /></a>
          <div className="domain"><Mail size={20} /><div><b>Sign in with the invited email</b><small>Staff and clients both use Google. Any email works if you were invited.</small></div></div>
          <DevLogin />
          <small className="security"><ShieldCheck size={15} /> Protected by OAuth and server-side access controls.</small>
          <button className="retry" onClick={onRetry}>Retry connection</button>
          <small style={{ textAlign: "center" }}>Need access? Ask your Tendrils administrator for an invitation.</small>
        </div>
      </section>
    </div>
  );
}
