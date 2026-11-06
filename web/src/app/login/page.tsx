"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useStaffSession } from "@/components/app-shell";
import styles from "./page.module.css";

export default function LoginPage() {
  const router = useRouter();
  const { reload } = useStaffSession();
  const [role, setRole] = useState<"doctor" | "nurse">("doctor");
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
        body: JSON.stringify({ role, staffId: form.get("staffId") }),
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

        <div className={styles.rolePicker} aria-label="Choose staff role">
          {(["doctor", "nurse"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={role === value}
              className={role === value ? styles.selectedRole : styles.role}
              onClick={() => setRole(value)}
            >
              {value === "doctor" ? "Doctor" : "Nurse"}
            </button>
          ))}
        </div>

        <form className={styles.form} onSubmit={signIn}>
          <label htmlFor="staffId">{role === "doctor" ? "Doctor ID" : "Nurse staff ID"}</label>
          <input id="staffId" name="staffId" type="number" min="1" step="1" required autoComplete="username" />
          <button className={styles.submit} type="submit" disabled={busy}>
            {busy ? "Checking staff record…" : "Continue"}
          </button>
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
        </form>

        <p className={styles.demoNotice}>
          Demo sign-in only: staff IDs are checked against MySQL, but no password is requested.
          This does not authenticate a person and is disabled in production.
        </p>
      </section>
    </main>
  );
}
