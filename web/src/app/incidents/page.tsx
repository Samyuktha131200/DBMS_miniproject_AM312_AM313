import styles from "../page.module.css";

const incidents = [
  { no: "INC-2026-0007", type: "Delay in care", severity: "Moderate", status: "Open" },
  { no: "INC-2026-0005", type: "Respiratory escalation", severity: "Critical", status: "Under review" },
  { no: "INC-2026-0002", type: "Head injury transfer", severity: "High", status: "Closed" },
  { no: "INC-2026-0001", type: "Ambulance handover delay", severity: "Moderate", status: "Closed" },
];

export default function IncidentsPage() {
  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Incident management</h1>
        <p className={styles.pageSubtitle}>
          Review open safety events, escalation notes, and closure timelines across the emergency department.
        </p>
      </header>

      <section className={styles.summaryGrid}>
        <div className={styles.metricCard}>
          <p>Open cases</p>
          <div className={styles.value}>05</div>
          <div className={styles.meta}>2 active investigations</div>
        </div>
        <div className={styles.metricCard}>
          <p>Escalations</p>
          <div className={styles.value}>03</div>
          <div className={styles.meta}>1 requires review</div>
        </div>
        <div className={styles.metricCard}>
          <p>Closed this week</p>
          <div className={styles.value}>14</div>
          <div className={styles.meta}>Across all departments</div>
        </div>
        <div className={styles.metricCard}>
          <p>Avg. closure</p>
          <div className={styles.value}>4.6h</div>
          <div className={styles.meta}>Target: 6h</div>
        </div>
      </section>

      <section className={styles.cardGrid}>
        <div className={styles.largeCard}>
          <div className={styles.listGrid}>
            {incidents.map((incident) => (
              <div key={incident.no} className={styles.listRow}>
                <div>
                  <strong>{incident.no}</strong>
                  <p>{incident.type}</p>
                </div>
                <span
                  className={`${styles.inlineTag} ${
                    incident.severity === "Critical"
                      ? styles.danger
                      : incident.severity === "High"
                        ? styles.warn
                        : styles.info
                  }`}
                >
                  {incident.severity}
                </span>
                <span
                  className={`${styles.inlineTag} ${
                    incident.status === "Open"
                      ? styles.info
                      : incident.status === "Under review"
                        ? styles.warn
                        : styles.success
                  }`}
                >
                  {incident.status}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.largeCard}>
          <div className={styles.listGrid}>
            <div className={styles.listRow}>
              <div>
                <strong>Review CT queue delay</strong>
                <p>INC-2026-0007</p>
              </div>
              <span className={`${styles.inlineTag} ${styles.warn}`}>Pending</span>
            </div>
            <div className={styles.listRow}>
              <div>
                <strong>Confirm respiratory escalation</strong>
                <p>INC-2026-0005</p>
              </div>
              <span className={`${styles.inlineTag} ${styles.danger}`}>Urgent</span>
            </div>
            <div className={styles.listRow}>
              <div>
                <strong>Close transfer review</strong>
                <p>INC-2026-0002</p>
              </div>
              <span className={`${styles.inlineTag} ${styles.success}`}>Ready</span>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
