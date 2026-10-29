"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "../page.module.css";

type PatientRecord = {
  patientId: number;
  name: string;
  caseId: number | null;
  status: string;
  triageLevel: number | null;
  department: string;
};

type PatientResponse = {
  summary: {
    totalPatients: number;
    activeCases: number;
    criticalCases: number;
    dischargedToday: number;
  };
  patients: PatientRecord[];
};

function riskLabel(triageLevel: number | null) {
  if (triageLevel === null) return "Not triaged";
  if (triageLevel === 1) return "Critical";
  if (triageLevel === 2) return "High";
  if (triageLevel === 3) return "Moderate";
  return "Low";
}

function riskClass(triageLevel: number | null) {
  if (triageLevel !== null && triageLevel <= 1) return `${styles.inlineTag} ${styles.danger}`;
  if (triageLevel === 2) return `${styles.inlineTag} ${styles.warn}`;
  if (triageLevel === null) return `${styles.inlineTag} ${styles.info}`;
  return `${styles.inlineTag} ${styles.success}`;
}

export default function PatientsPage() {
  const [data, setData] = useState<PatientResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function loadPatients() {
      try {
        const response = await fetch("/api/patients", { cache: "no-store", signal: controller.signal });
        const result = await response.json() as PatientResponse & { error?: string };
        if (!response.ok) throw new Error(result.error || `Patient request failed (${response.status}).`);
        setData(result);
        setError("");
      } catch (requestError) {
        if (!controller.signal.aborted) {
          setError(requestError instanceof Error ? requestError.message : "Could not load patient records.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    loadPatients();
    return () => controller.abort();
  }, [refreshVersion]);

  function refresh() {
    setLoading(true);
    setRefreshVersion((version) => version + 1);
  }

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <p className={styles.eyebrow}>Live MySQL records</p>
        <h1 className={styles.pageTitle}>Patient records</h1>
        <p className={styles.pageSubtitle}>
          Track registered patients, emergency case status, and triage risk from your MySQL database.
        </p>
        <div className={styles.pageActions}>
          <Link className={styles.primaryAction} href="/entries">New patient</Link>
        </div>
      </header>

      {error ? <div className={styles.statusBanner} role="alert">{error}</div> : null}
      {loading && !data ? <div className={styles.loadingText}>Loading patient records from MySQL…</div> : null}

      {data ? (
        <>
          <section className={styles.summaryGrid} aria-label="Patient summary">
            <div className={styles.metricCard}>
              <p>Registered patients</p>
              <div className={styles.value}>{data.summary.totalPatients}</div>
              <div className={styles.meta}>MySQL patient records</div>
            </div>
            <div className={styles.metricCard}>
              <p>Active cases</p>
              <div className={styles.value}>{data.summary.activeCases}</div>
              <div className={styles.meta}>Open, under treatment, or admitted</div>
            </div>
            <div className={styles.metricCard}>
              <p>Critical / high risk</p>
              <div className={styles.value}>{data.summary.criticalCases}</div>
              <div className={styles.meta}>Active cases at triage level 1–2</div>
            </div>
            <div className={styles.metricCard}>
              <p>Discharged today</p>
              <div className={styles.value}>{data.summary.dischargedToday}</div>
              <div className={styles.meta}>Based on case arrival date</div>
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <h3>Patient registry</h3>
              <button type="button" onClick={refresh} disabled={loading}>
                {loading ? "Refreshing…" : "Refresh"}
              </button>
            </div>

            <div className={styles.tableWrap}>
              <table>
                <thead>
                  <tr>
                    <th>Patient ID</th>
                    <th>Name</th>
                    <th>Emergency case</th>
                    <th>Department</th>
                    <th>Triage risk</th>
                    <th>Case status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.patients.length ? data.patients.map((patient, index) => (
                    <tr key={`${patient.patientId}-${patient.caseId ?? "none"}-${index}`}>
                      <td>PAT-{String(patient.patientId).padStart(4, "0")}</td>
                      <td>{patient.name}</td>
                      <td>{patient.caseId === null ? "—" : `CASE-${String(patient.caseId).padStart(3, "0")}`}</td>
                      <td>{patient.department}</td>
                      <td>
                        <span className={riskClass(patient.triageLevel)}>
                          {riskLabel(patient.triageLevel)}
                        </span>
                      </td>
                      <td>{patient.status}</td>
                    </tr>
                  )) : (
                    <tr><td colSpan={6}>No patient records exist in MySQL yet. Use New patient to add one.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}
