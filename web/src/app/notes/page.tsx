import styles from "../page.module.css";

const notes = [
  { title: "Morning handoff", author: "Dr. Mehta", time: "08:30 AM", category: "Clinical" },
  { title: "Transfer summary", author: "Nurse Singh", time: "09:10 AM", category: "Operational" },
  { title: "Medication review", author: "Dr. Kapoor", time: "10:05 AM", category: "Safety" },
  { title: "Family communication", author: "Social worker", time: "11:15 AM", category: "Care coordination" },
];

export default function NotesPage() {
  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Clinical notes</h1>
        <p className={styles.pageSubtitle}>Review case narratives, handoff documentation, and operational updates across the emergency department.</p>
      </header>

      <section className={styles.summaryGrid}>
        <div className={styles.metricCard}>
          <p>New notes</p>
          <div className={styles.value}>27</div>
          <div className={styles.meta}>Last 24 hours</div>
        </div>
        <div className={styles.metricCard}>
          <p>Pending signoff</p>
          <div className={styles.value}>06</div>
          <div className={styles.meta}>2 high priority</div>
        </div>
        <div className={styles.metricCard}>
          <p>Reviewed</p>
          <div className={styles.value}>93%</div>
          <div className={styles.meta}>Compliance target</div>
        </div>
        <div className={styles.metricCard}>
          <p>Avg. time</p>
          <div className={styles.value}>11m</div>
          <div className={styles.meta}>To document update</div>
        </div>
      </section>

      <section className={styles.cardGrid}>
        <div className={styles.largeCard}>
          <div className={styles.panelHead}>
            <h3>Recent notes</h3>
            <button>New note</button>
          </div>
          <div className={styles.listGrid}>
            {notes.map((note) => (
              <div key={note.title} className={styles.listRow}>
                <div>
                  <strong>{note.title}</strong>
                  <p>{note.author}</p>
                </div>
                <small>{note.time}</small>
                <span className={`${styles.inlineTag} ${styles.info}`}>{note.category}</span>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.largeCard}>
          <div className={styles.panelHead}>
            <h3>Documentation flags</h3>
            <button>Audit trail</button>
          </div>
          <div className={styles.listGrid}>
            <div className={styles.listRow}>
              <div>
                <strong>Incomplete handoff entry</strong>
                <p>CASE-003</p>
              </div>
              <span className={`${styles.inlineTag} ${styles.warn}`}>Needs action</span>
            </div>
            <div className={styles.listRow}>
              <div>
                <strong>Medication reconciliation required</strong>
                <p>CASE-008</p>
              </div>
              <span className={`${styles.inlineTag} ${styles.info}`}>Queued</span>
            </div>
            <div className={styles.listRow}>
              <div>
                <strong>Family consent signed</strong>
                <p>CASE-009</p>
              </div>
              <span className={`${styles.inlineTag} ${styles.success}`}>Complete</span>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
