"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./page.module.css";

type DataSource = "live" | "mock";

type Stats = { label: string; value: string; delta: string; tone: "primary" | "danger" | "success" | "neutral" };
type Patient = { id: string; name: string; age: number; dept: string; status: string; color: "amber" | "red" | "blue" | "purple" };
type Incident = { no: string; type: string; severity: string; status: string };
type Note = { title: string; patient: string; text: string };

type DashboardResponse = {
  source: DataSource;
  stats: Stats[];
  patients: Patient[];
  alerts: string[];
  incidents: Incident[];
  notes: Note[];
  warning?: string;
};

const defaultData: DashboardResponse = {
  source: "mock",
  stats: [
    { label: "Patients in ED", value: "128", delta: "+12%", tone: "primary" },
    { label: "Critical cases", value: "07", delta: "2 high risk", tone: "danger" },
    { label: "Avg. wait time", value: "16 min", delta: "-3 min", tone: "success" },
    { label: "Discharged today", value: "41", delta: "+9", tone: "neutral" },
  ],
  patients: [
    { id: "CASE-008", name: "Asha Menon", age: 34, dept: "Cardiology", status: "Monitoring", color: "amber" },
    { id: "CASE-003", name: "Rohan Das", age: 52, dept: "Trauma", status: "Critical", color: "red" },
    { id: "CASE-005", name: "Vikram Nair", age: 46, dept: "Respiratory", status: "Observation", color: "blue" },
    { id: "CASE-009", name: "Anjali Rao", age: 28, dept: "Neurology", status: "Awaiting scan", color: "purple" },
  ],
  alerts: [
    "NEWS2 deterioration detected in Case 008",
    "Ambulance response breach: INC-2026-0005",
    "Two CT slots blocked for delayed review",
    "Pharmacy request pending for case 003",
  ],
  incidents: [
    { no: "INC-2026-0007", type: "Delay in care", severity: "Moderate", status: "Open" },
    { no: "INC-2026-0005", type: "Respiratory escalation", severity: "Critical", status: "Under review" },
    { no: "INC-2026-0002", type: "Head injury transfer", severity: "High", status: "Closed" },
  ],
  notes: [
    { title: "Progress note", patient: "Case 005", text: "Chest pain subsiding; repeat vitals in 30 mins." },
    { title: "Consult update", patient: "Case 008", text: "Oxygen requirement increased, escalate to ICU review." },
    { title: "Discharge plan", patient: "Case 009", text: "Neurology follow-up arranged for morning rounds." },
  ],
};

function csvCell(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export default function Home() {
  const [source, setSource] = useState<DataSource>("live");
  const [data, setData] = useState<DashboardResponse>(defaultData);
  const [loading, setLoading] = useState(false);

  function exportReport() {
    const rows: Array<Array<string | number>> = [
      ["ER dashboard report"],
      ["Data source", data.source],
      [],
      ["Metric", "Value", "Details"],
      ...data.stats.map((stat) => [stat.label, stat.value, stat.delta]),
      [],
      ["Patient queue"],
      ["Case", "Patient", "Age", "Department", "Status"],
      ...data.patients.map((patient) => [patient.id, patient.name, patient.age, patient.dept, patient.status]),
      [],
      ["Incidents"],
      ["Incident", "Type", "Severity", "Status"],
      ...data.incidents.map((incident) => [incident.no, incident.type, incident.severity, incident.status]),
      [],
      ["Clinical notes"],
      ["Title", "Patient", "Text"],
      ...data.notes.map((note) => [note.title, note.patient, note.text]),
      [],
      ["Alerts"],
      ...data.alerts.map((alert) => [alert]),
    ];
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `er-dashboard-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const response = await fetch(`/api/dashboard?source=${source}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`Dashboard request failed (${response.status}).`);
        const json = (await response.json()) as DashboardResponse;
        setData(json);
      } catch (error) {
        setData({
          ...defaultData,
          warning: error instanceof Error ? error.message : "Dashboard request failed. Check the Next.js server output.",
        });
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [source]);

  return (
    <div className={styles.page}>
      <header className={styles.topBar}>
        <div className={styles.brandWrap}>
          <div className={styles.brandMark}>+</div>
          <div>
            <p className={styles.eyebrow}>Hospital ER</p>
            <h1>Emergency Operations Center</h1>
          </div>
        </div>

        <nav className={styles.nav} aria-label="Main navigation">
          <Link href="/" className={styles.navItemActive}>Overview</Link>
          <Link href="/entries" className={styles.navItem}>Data entry</Link>
          <Link href="/patients" className={styles.navItem}>Patients</Link>
          <Link href="/incidents" className={styles.navItem}>Incidents</Link>
          <Link href="/notes" className={styles.navItem}>Notes</Link>
        </nav>

        <div className={styles.userChip}>
          <span className={styles.avatar}>DR</span>
          <div>
            <strong>Dr. Meera</strong>
            <small>Shift lead</small>
          </div>
        </div>
      </header>

      <main className={styles.dashboard}>
        <section className={styles.heroPanel}>
          <div>
            <p className={styles.badge}>{data.source === "live" ? "Live dashboard" : "Mock dashboard"}</p>
            <h2>ER capacity and patient risk at a glance</h2>
          </div>

          <div className={styles.heroActions}>
            <div className={styles.sourceToggle}>
              <button
                type="button"
                className={source === "live" ? styles.sourceButtonActive : styles.sourceButton}
                onClick={() => setSource("live")}
              >
                Live DB
              </button>
              <button
                type="button"
                className={source === "mock" ? styles.sourceButtonActive : styles.sourceButton}
                onClick={() => setSource("mock")}
              >
                Mock data
              </button>
            </div>
            <button className={styles.secondaryAction} type="button" onClick={exportReport}>
              Export report
            </button>
          </div>
        </section>

        {data.warning ? <div className={styles.statusBanner}>{data.warning}</div> : null}

        {loading ? <div className={styles.loadingText}>Loading dashboard data…</div> : null}

        <section className={styles.statsGrid}>
          {data.stats.map((stat) => (
            <article key={stat.label} className={`${styles.statCard} ${styles[stat.tone]}`}>
              <p>{stat.label}</p>
              <div className={styles.statRow}>
                <strong>{stat.value}</strong>
                <span>{stat.delta}</span>
              </div>
            </article>
          ))}
        </section>

        <section className={styles.contentGrid}>
          <article className={styles.panel}>
            <div className={styles.panelHead}>
              <h3>Active patient queue</h3>
              <button>View all</button>
            </div>

            <div className={styles.tableWrap}>
              <table>
                <thead>
                  <tr>
                    <th>Case</th>
                    <th>Patient</th>
                    <th>Dept</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.patients.length ? data.patients.map((patient) => (
                    <tr key={patient.id}>
                      <td>{patient.id}</td>
                      <td>
                        <div className={styles.patientName}>
                          <span className={styles.patientDot} />
                          {patient.name}
                        </div>
                        <small>{patient.age} yrs</small>
                      </td>
                      <td>{patient.dept}</td>
                      <td>
                        <span className={`${styles.statusPill} ${styles[patient.color]}`}>
                          {patient.status}
                        </span>
                      </td>
                    </tr>
                  )) : (
                    <tr><td colSpan={4}>No emergency cases are in MySQL yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </article>

          <article className={styles.panel}>
            <div className={styles.panelHead}>
              <h3>Escalation alerts</h3>
              <button>Review</button>
            </div>

            <ul className={styles.alertList}>
              {data.alerts.length ? data.alerts.map((alert) => (
                <li key={alert}>
                  <span className={styles.alertDot} />
                  {alert}
                </li>
              )) : <li>No live alerts are available.</li>}
            </ul>
          </article>
        </section>

        <section className={styles.contentGrid}>
          <article className={styles.panel}>
            <div className={styles.panelHead}>
              <h3>Incident tracker</h3>
              <button>Open queue</button>
            </div>

            <div className={styles.incidentList}>
              {data.incidents.length ? data.incidents.map((incident) => (
                <div key={incident.no} className={styles.incidentRow}>
                  <div>
                    <strong>{incident.no}</strong>
                    <p>{incident.type}</p>
                  </div>
                  <span className={`${styles.severity} ${styles[incident.severity.toLowerCase()]}`}>
                    {incident.severity}
                  </span>
                  <span className={styles.statusText}>{incident.status}</span>
                </div>
              )) : <p>No incident reports are in MongoDB yet.</p>}
            </div>
          </article>

          <article className={styles.panel}>
            <div className={styles.panelHead}>
              <h3>Clinical notes</h3>
              <button>All notes</button>
            </div>

            <div className={styles.noteList}>
              {data.notes.length ? data.notes.map((note) => (
                <div key={note.title} className={styles.noteCard}>
                  <div className={styles.noteHeader}>
                    <strong>{note.title}</strong>
                    <span>{note.patient}</span>
                  </div>
                  <p>{note.text}</p>
                </div>
              )) : <p>No clinical notes are in MongoDB yet.</p>}
            </div>
          </article>
        </section>
      </main>
    </div>
  );
}
