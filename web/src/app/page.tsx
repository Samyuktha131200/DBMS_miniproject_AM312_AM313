"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useStaffSession } from "@/components/app-shell";
import styles from "./page.module.css";

type DashboardData = {
  source: "live";
  updatedAt: string;
  staff: { role: "doctor" | "nurse"; name: string; department: string };
  summary: {
    registeredPatients: number;
    inHospital: number;
    dischargedCases: number;
    criticalCases: number;
    availableBeds: number;
    occupiedBeds: number;
    pendingTests: number;
    pendingBills: number;
    departmentActiveCases: number;
    departmentCriticalCases: number;
    doctorPendingTests: number;
    observations: number;
    staffObservations: number;
    clinicalNotes: number;
    staffNotes: number;
    incidents: number;
    openIncidents: number;
  };
  patients: Array<{ id: string; name: string; department: string; status: string; triageLevel: number }>;
  incidents: Array<{ no: string; type: string; severity: string; status: string }>;
  notes: Array<{ title: string; patient: string; text: string }>;
  alerts: string[];
};

function csvCell(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function metric(label: string, value: number, detail: string, tone: "primary" | "danger" | "success" | "neutral") {
  return { label, value, detail, tone };
}

export default function Home() {
  const { user } = useStaffSession();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/dashboard", { cache: "no-store", signal });
      const result = await response.json() as DashboardData & { error?: string };
      if (!response.ok) throw new Error(result.error || `Dashboard request failed (${response.status}).`);
      setData(result);
      setError("");
    } catch (requestError) {
      if (!signal?.aborted) setError(requestError instanceof Error ? requestError.message : "Could not load live dashboard data.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const initialLoad = window.setTimeout(() => void refresh(controller.signal), 0);
    const interval = window.setInterval(() => void refresh(), 5000);
    return () => {
      controller.abort();
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
    };
  }, [refresh]);

  function exportReport() {
    if (!data) return;
    const rows: Array<Array<string | number>> = [
      ["Emergency department live report"],
      ["Staff role", data.staff.role],
      ["Department", data.staff.department],
      ["Last updated", data.updatedAt],
      [],
      ["Metric", "Value"],
      ["Registered patients", data.summary.registeredPatients],
      ["Currently in hospital", data.summary.inHospital],
      ["Discharged cases", data.summary.dischargedCases],
      ["Critical/high-risk active cases", data.summary.criticalCases],
      ["Available beds", data.summary.availableBeds],
      ["Pending tests", data.summary.pendingTests],
      ["Pending bills", data.summary.pendingBills],
      ["MongoDB observations", data.summary.observations],
      ["MongoDB clinical notes", data.summary.clinicalNotes],
      ["MongoDB incidents", data.summary.incidents],
      [],
      ["Case", "Patient", "Department", "Status", "Triage level"],
      ...data.patients.map((patient) => [patient.id, patient.name, patient.department, patient.status, patient.triageLevel]),
    ];
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `er-dashboard-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const metrics = data && user ? [
    metric("Registered patients", data.summary.registeredPatients, "MySQL patient records", "primary"),
    metric("Currently in hospital", data.summary.inHospital, "Open, under treatment, or admitted", "success"),
    metric("Discharged cases", data.summary.dischargedCases, "Cases currently marked Discharged", "neutral"),
    metric("Critical / high risk", data.summary.criticalCases, "Active cases at triage level 1–2", "danger"),
    metric("Available beds", data.summary.availableBeds, `${data.summary.occupiedBeds} occupied`, "primary"),
    metric(user.role === "doctor" ? "Pending test orders" : "Pending tests", user.role === "doctor" ? data.summary.doctorPendingTests : data.summary.pendingTests, "Ordered or in progress", "neutral"),
    metric("Pending bills", data.summary.pendingBills, "Billing status: Pending", "neutral"),
    metric(user.role === "nurse" ? "Your observations" : "Vital observations", user.role === "nurse" ? data.summary.staffObservations : data.summary.observations, `MongoDB · ${data.summary.observations} total`, "success"),
  ] : [];

  return (
    <main className={styles.page}>
      <div className={styles.dashboard}>
        <section className={styles.heroPanel}>
          <div>
            <p className={styles.badge}>Live MySQL + MongoDB</p>
            <h1>{user?.role === "nurse" ? "Nursing & triage overview" : "Clinical operations overview"}</h1>
            <p className={styles.heroSubtitle}>
              {user?.role === "nurse"
                ? `Triage and ward activity for ${data?.staff.department ?? "your department"}.`
                : `Clinical cases and test activity for ${data?.staff.department ?? "your department"}.`}
            </p>
          </div>
          <div className={styles.heroActions}>
            <button className={styles.secondaryAction} type="button" onClick={() => void refresh()} disabled={loading}>
              {loading ? "Updating…" : "Refresh"}
            </button>
            <button className={styles.secondaryAction} type="button" onClick={exportReport} disabled={!data}>
              Export report
            </button>
          </div>
        </section>

        {error ? <div className={styles.statusBanner} role="alert">{error}</div> : null}
        {loading && !data ? <div className={styles.loadingText}>Loading live hospital records…</div> : null}
        {data ? (
          <>
            <p className={styles.liveStamp} role="status">
              Auto-refreshes every 5 seconds · Last updated {new Date(data.updatedAt).toLocaleTimeString()}
            </p>
            <section className={styles.statsGrid} aria-label="Live hospital metrics">
              {metrics.map((item) => (
                <article key={item.label} className={`${styles.statCard} ${styles[item.tone]}`}>
                  <p>{item.label}</p>
                  <div className={styles.statRow}>
                    <strong>{item.value}</strong>
                    <span>{item.detail}</span>
                  </div>
                </article>
              ))}
            </section>

            <section className={styles.contentGrid}>
              <article className={styles.panel}>
                <div className={styles.panelHead}>
                  <div>
                    <h2>{data.staff.department} case list</h2>
                    <p>{user?.role === "nurse" ? "Triage and current ward status" : "Cases for clinical review"}</p>
                  </div>
                  <Link href="/patients">All patients</Link>
                </div>
                <div className={styles.tableWrap}>
                  <table>
                    <thead><tr><th>Case</th><th>Patient</th><th>Dept.</th><th>Triage</th><th>Status</th></tr></thead>
                    <tbody>
                      {data.patients.map((patient) => (
                        <tr key={patient.id}>
                          <td>{patient.id}</td>
                          <td>{patient.name}</td>
                          <td>{patient.department}</td>
                          <td>{patient.triageLevel}</td>
                          <td><span className={`${styles.statusPill} ${patient.status === "Discharged" ? styles.blue : patient.triageLevel <= 2 ? styles.red : styles.amber}`}>{patient.status}</span></td>
                        </tr>
                      ))}
                      {!data.patients.length ? <tr><td colSpan={5}>No cases are currently listed for this department.</td></tr> : null}
                    </tbody>
                  </table>
                </div>
              </article>
              <article className={styles.panel}>
                <div className={styles.panelHead}><div><h2>{user?.role === "nurse" ? "Triage & safety alerts" : "Clinical review alerts"}</h2><p>Updated from current records</p></div></div>
                <ul className={styles.alertList}>
                  {data.alerts.map((alert) => <li key={alert}><span className={styles.alertDot} />{alert}</li>)}
                </ul>
                <div className={styles.roleSummary}>
                  <strong>{user?.role === "nurse" ? "Nursing activity" : "Doctor activity"}</strong>
                  <span>{data.summary.departmentActiveCases} current cases in this department</span>
                  <span>{data.summary.departmentCriticalCases} critical/high-risk cases in this department</span>
                  {user?.role === "nurse"
                    ? <span>{data.summary.staffNotes} notes authored by you</span>
                    : <span>{data.summary.staffNotes} notes authored by you</span>}
                </div>
              </article>
            </section>

            <section className={styles.contentGrid}>
              <article className={styles.panel}>
                <div className={styles.panelHead}><div><h2>Recent incidents</h2><p>MongoDB · {data.summary.openIncidents} open of {data.summary.incidents}</p></div><Link href="/incidents">Incident records</Link></div>
                <div className={styles.incidentList}>
                  {data.incidents.map((incident) => (
                    <div className={styles.incidentRow} key={incident.no}>
                      <div><strong>{incident.no}</strong><p>{incident.type}</p></div>
                      <span className={styles.statusText}>{incident.severity}</span>
                      <span className={styles.statusText}>{incident.status}</span>
                    </div>
                  ))}
                  {!data.incidents.length ? <p>No incident reports are in MongoDB.</p> : null}
                </div>
              </article>
              <article className={styles.panel}>
                <div className={styles.panelHead}><div><h2>Recent clinical notes</h2><p>MongoDB · {data.summary.clinicalNotes} total</p></div><Link href="/notes">Clinical notes</Link></div>
                <div className={styles.noteList}>
                  {data.notes.map((note) => <div className={styles.noteCard} key={`${note.title}-${note.patient}`}><strong>{note.title}</strong><small>{note.patient}</small><p>{note.text}</p></div>)}
                  {!data.notes.length ? <p>No clinical notes are in MongoDB.</p> : null}
                </div>
              </article>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
