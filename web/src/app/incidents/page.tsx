"use client";

import { useEffect, useState } from "react";
import { useStaffSession } from "@/components/app-shell";
import styles from "../page.module.css";

type IncidentData = {
  staff?: { department: string };
  summary: { incidents: number; openIncidents: number };
  incidents: Array<{ no: string; type: string; severity: string; status: string }>;
  error?: string;
};

export default function IncidentsPage() {
  const { user } = useStaffSession();
  const [data, setData] = useState<IncidentData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await fetch("/api/dashboard", { cache: "no-store" });
        const result = await response.json() as IncidentData;
        if (!response.ok) throw new Error(result.error || `Incident request failed (${response.status}).`);
        if (active) {
          setData(result);
          setError("");
        }
      } catch (requestError) {
        if (active) setError(requestError instanceof Error ? requestError.message : "Could not load incidents.");
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
        <h1 className={styles.pageTitle}>{user?.role === "doctor" ? "Clinical safety incidents" : "Ward & patient safety"}</h1>
        <p className={styles.pageSubtitle}>Incident reports linked to cases in your department, refreshed every 10 seconds.</p>
      </header>
      {error ? <div className={styles.statusBanner} role="alert">{error}</div> : null}
      {data ? (
        <>
          <section className={styles.summaryGrid}>
            <div className={styles.metricCard}><p>Department incidents</p><div className={styles.value}>{data.summary.incidents}</div><div className={styles.meta}>MongoDB incident reports</div></div>
            <div className={styles.metricCard}><p>Open incidents</p><div className={styles.value}>{data.summary.openIncidents}</div><div className={styles.meta}>Not closed or resolved</div></div>
          </section>
          <section className={styles.panel}>
            <div className={styles.panelHead}><h2>Recent incident reports</h2></div>
            <div className={styles.incidentList}>
              {data.incidents.map((incident) => (
                <article className={styles.incidentRow} key={incident.no}>
                  <div><strong>{incident.no}</strong><p>{incident.type}</p></div>
                  <span className={styles.statusText}>{incident.severity}</span>
                  <span className={styles.statusText}>{incident.status}</span>
                </article>
              ))}
              {!data.incidents.length ? <p>No incidents are linked to current department cases.</p> : null}
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}
