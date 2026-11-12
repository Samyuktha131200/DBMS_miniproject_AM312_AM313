"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { StaffSession } from "@/lib/staff-session";
import styles from "./app-shell.module.css";

type SessionState = {
  user: StaffSession | null;
  reload: () => Promise<StaffSession | null>;
};

const SessionContext = createContext<SessionState>({ user: null, reload: async () => null });

export function useStaffSession() {
  return useContext(SessionContext);
}

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<StaffSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    const response = await fetch("/api/auth", { cache: "no-store" });
    const body = await response.json() as { session?: StaffSession | null; error?: string };
    if (!response.ok) throw new Error(body.error || `Session request failed (${response.status}).`);
    const nextUser = body.session ?? null;
    setUser(nextUser);
    setError("");
    return nextUser;
  }, []);

  useEffect(() => {
    let active = true;
    async function loadSession() {
      try {
        await reload();
        if (!active) return;
      } catch (sessionError) {
        if (active) setError(sessionError instanceof Error ? sessionError.message : "Could not verify the staff session.");
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadSession();
    return () => { active = false; };
  }, [reload]);

  useEffect(() => {
    if (loading || error) return;
    if (pathname === "/login" && user) router.replace("/");
    if (pathname !== "/login" && !user) router.replace("/login");
  }, [error, loading, pathname, router, user]);

  async function signOut() {
    const response = await fetch("/api/auth", { method: "DELETE" });
    if (!response.ok) {
      setError("Could not sign out. Please try again.");
      return;
    }
    setUser(null);
    router.replace("/login");
  }

  if (pathname === "/login") {
    return (
      <SessionContext.Provider value={{ user, reload }}>
        {children}
      </SessionContext.Provider>
    );
  }

  if (error) {
    return <main className={styles.status} role="alert">{error}</main>;
  }
  if (loading || !user) {
    return <main className={styles.status}>Checking staff session…</main>;
  }

  const links = [
    { href: "/", label: "Overview" },
    { href: "/patients", label: "Patients" },
    { href: "/payments", label: "Payments" },
    { href: "/entries", label: user.role === "nurse" ? "Triage & records" : "Clinical records" },
    { href: "/incidents", label: "Incidents" },
    { href: "/notes", label: "Notes" },
  ];

  return (
    <SessionContext.Provider value={{ user, reload }}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/">
          <span className={styles.mark}>+</span>
          <span><small>Hospital ER</small><strong>Emergency Operations</strong></span>
        </Link>
        <nav className={styles.nav} aria-label="Main navigation">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={pathname === link.href ? "page" : undefined}
              className={pathname === link.href ? styles.activeLink : styles.link}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className={styles.profile}>
          <div><strong>{user.name}</strong><small>{user.role} · {user.departmentName}</small></div>
          <button type="button" onClick={signOut}>Sign out</button>
        </div>
      </header>
      {children}
    </SessionContext.Provider>
  );
}
