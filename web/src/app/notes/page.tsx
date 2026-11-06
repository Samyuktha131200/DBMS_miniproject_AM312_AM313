"use client";

import { useEffect, useState } from "react";
import { useStaffSession } from "@/components/app-shell";
import styles from "../page.module.css";

type NotesData = {
  staff?: { department: string };
  summary: { clinicalNotes: number; staffNotes: number };
  notes: Array<{ title: string; patient: string; text: string }>;
  error?: string;
};

export default function NotesPage() {
  const { user } = useStaffSession();
  const [data, setData] = useState<NotesData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await fetch("/api/dashboard", { cache: "no-store" });
        const result = await response.json() as NotesData;
        if (!response.ok) throw new Error(result.error || `Notes request failed (${response.status}).`);
        if (active) {
          setData(result);
          setError("");
        }
      } catch (requestError) {
        if (active) setError(requestError instanceof Error ? requestError.message : "Could not load notes.");
      }
    }
    void load();
    const interval = window.setInterval(() => void load(), 10000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <p className={styles.eyebrow}>Live MongoDB records · {data?.staff?.department ?? user?.departmentName}</p>
        <h1 className={styles.pageTitle}>{user?.role === "doctor" ? "Clinical documentation" : "Nursing notes & handoff"}</h1>
        <p className={styles.pageSubtitle}>Recent clinical notes for your department cases, refreshed every 10 seconds.</p>
      </header>
      {error ? <div className={styles.statusBanner} role="alert">{error}</div> : null}
      {data ? (
        <>
          <section className={styles.summaryGrid}>
            <div className={styles.metricCard}><p>Department notes</p><div className={styles.value}>{data.summary.clinicalNotes}</div><div className={styles.meta}>MongoDB notes linked to department cases</div></div>
            <div className={styles.metricCard}><p>Your notes</p><div className={styles.value}>{data.summary.staffNotes}</div><div className={styles.meta}>Authored by your signed-in staff ID</div></div>
          </section>
          <section className={styles.panel}>
            <div className={styles.panelHead}><h2>Recent case notes</h2></div>
            <div className={styles.noteList}>
              {data.notes.map((note) => (
                <article className={styles.noteCard} key={`${note.title}-${note.patient}`}>
                  <div className={styles.noteHeader}><strong>{note.title}</strong><span>{note.patient}</span></div>
                  <p>{note.text}</p>
                </article>
              ))}
              {!data.notes.length ? <p>No notes are linked to current department cases.</p> : null}
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}
