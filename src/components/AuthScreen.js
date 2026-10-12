"use client";
import { useState } from "react";
import { GoogleLogo, EnvelopeSimple, ArrowLeft, CircleNotch } from "@phosphor-icons/react";
import { useAccount, authErrorMessage } from "@/lib/auth";
import { toast } from "@/lib/toast";
import styles from "./AuthScreen.module.css";

// Sign in / create account, in the app's aurora style. `initialMode` lets /sign-up open the form.
export default function AuthScreen({ initialMode = "start", onDone }) {
  const { signInWithGoogle, signInWithEmail, signUpWithEmail, resetPassword, continueAsGuest, available } = useAccount();
  const [mode, setMode] = useState(initialMode); // start | signin | signup | reset
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(null); // which action is running
  const [error, setError] = useState("");

  const run = async (key, action) => {
    setBusy(key);
    setError("");
    try {
      await action();
      onDone?.();
    } catch (err) {
      const message = authErrorMessage(err);
      if (message) setError(message);
    } finally {
      setBusy(null);
    }
  };

  const handleGoogle = () => run("google", signInWithGoogle);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (mode === "reset") {
      run("email", async () => {
        await resetPassword(email);
        toast("Password reset email sent — check your inbox", { variant: "success" });
        setMode("signin");
      });
    } else if (mode === "signup") {
      run("email", () => signUpWithEmail(name, email, password));
    } else {
      run("email", () => signInWithEmail(email, password));
    }
  };

  const titles = {
    start: "Sign in to sync your aura across every device",
    signin: "Welcome back",
    signup: "Create your AuraSynq account",
    reset: "Reset your password",
  };

  return (
    <div className={styles.screen}>
      <div className={styles.aurora} aria-hidden="true">
        <span className={styles.orbA} />
        <span className={styles.orbB} />
        <span className={styles.orbC} />
      </div>

      <div className={styles.content}>
        <img src="/logo-emblem.png" alt="" width={112} height={91} className={styles.logo} />
        <h1 className={styles.brand}>AuraSynq</h1>
        <p className={styles.tagline}>{titles[mode]}</p>

        <div className={`glass ${styles.card}`}>
          {mode === "start" ? (
            <>
              <button className={styles.googleBtn} onClick={handleGoogle} disabled={!!busy || !available}>
                {busy === "google" ? <CircleNotch size={20} className={styles.spin} /> : <GoogleLogo size={20} weight="bold" />}
                Continue with Google
              </button>
              <button className={styles.secondaryBtn} onClick={() => { setError(""); setMode("signin"); }} disabled={!!busy || !available}>
                <EnvelopeSimple size={20} />
                Continue with email
              </button>
            </>
          ) : (
            <form className={styles.form} onSubmit={handleSubmit}>
              <button type="button" className={styles.backLink} onClick={() => { setError(""); setMode("start"); }}>
                <ArrowLeft size={16} /> All sign-in options
              </button>
              {mode === "signup" && (
                <input
                  className={styles.input}
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  maxLength={40}
                />
              )}
              <input
                className={styles.input}
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
              {mode !== "reset" && (
                <input
                  className={styles.input}
                  type="password"
                  placeholder={mode === "signup" ? "Password (6+ characters)" : "Password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  minLength={6}
                  required
                />
              )}
              <button type="submit" className={styles.primaryBtn} disabled={!!busy}>
                {busy === "email" && <CircleNotch size={18} className={styles.spin} />}
                {mode === "signup" ? "Create account" : mode === "reset" ? "Send reset link" : "Sign in"}
              </button>
              <div className={styles.formLinks}>
                {mode === "signin" && (
                  <>
                    <button type="button" onClick={() => { setError(""); setMode("reset"); }}>Forgot password?</button>
                    <button type="button" onClick={() => { setError(""); setMode("signup"); }}>New here? Create an account</button>
                  </>
                )}
                {mode !== "signin" && (
                  <button type="button" onClick={() => { setError(""); setMode("signin"); }}>Have an account? Sign in</button>
                )}
              </div>
            </form>
          )}

          {error && <p className={styles.error}>{error}</p>}
          {!available && <p className={styles.error}>Accounts aren&apos;t available right now — you can still listen as a guest.</p>}
        </div>

        <button className={styles.guestLink} onClick={() => { continueAsGuest(); onDone?.(); }} disabled={!!busy}>
          Continue as guest
          <span>Your library stays on this device until you sign in</span>
        </button>
      </div>
    </div>
  );
}
