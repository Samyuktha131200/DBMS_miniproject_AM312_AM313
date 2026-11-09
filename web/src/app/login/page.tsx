"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useStaffSession } from "@/components/app-shell";
import styles from "./page.module.css";

export default function LoginPage() {
  const router = useRouter();
  const { reload } = useStaffSession();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: form.get("username"), password: form.get("password") }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || `Sign-in failed (${response.status}).`);
      if (!await reload()) throw new Error("The new staff session could not be verified.");
      router.replace("/");
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <div className={styles.brandMark}>+</div>
        <p className={styles.eyebrow}>Hospital ER · Staff access</p>
        <h1>Welcome back</h1>
        <p className={styles.subtitle}>Sign in to your role-based emergency department workspace.</p>

        <form className={styles.form} onSubmit={signIn}>
          <label htmlFor="username">Username</label>
          <input id="username" name="username" type="text" required autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={50} />
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" required autoComplete="current-password" maxLength={200} />
          <button className={styles.submit} type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
        </form>

        <p className={styles.demoNotice}>
          Your role (doctor or nurse) and department come from your staff account.
          Passwords are stored only as salted scrypt hashes.
        </p>
      </section>
    </main>
  );
}
