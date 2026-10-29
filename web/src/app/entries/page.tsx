"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import styles from "./page.module.css";

type MongoKind = "observation" | "note" | "incident";

function localDateTime() {
  const date = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
}

async function postJson(url: string, data: Record<string, unknown>) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const body = await response.text();
  let result: Record<string, unknown> = {};

  if (body) {
    try {
      const parsed: unknown = JSON.parse(body);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        result = parsed as Record<string, unknown>;
      }
    } catch {
      if (!response.ok) {
        throw new Error(`Request failed (HTTP ${response.status}). Check the web server terminal for details.`);
      }
      throw new Error(`The server returned an invalid response (HTTP ${response.status}). Check the web server terminal for details.`);
    }
  }

  if (!response.ok) {
    const error = result.error;
    throw new Error(typeof error === "string" ? error : `Request failed (HTTP ${response.status}).`);
  }
  if (Object.keys(result).length === 0) {
    throw new Error(`The server returned an empty response (HTTP ${response.status}). Check the web server terminal for details.`);
  }

  return {
    patientId: typeof result.patientId === "number" ? result.patientId : undefined,
    caseId: typeof result.caseId === "number" ? result.caseId : undefined,
    incidentNo: typeof result.incidentNo === "string" ? result.incidentNo : undefined,
    id: typeof result.id === "string" ? result.id : undefined,
  };
}

export default function EntriesPage() {
  const [mongoKind, setMongoKind] = useState<MongoKind>("observation");
  const [observedAt, setObservedAt] = useState("");
  const [occurredAt, setOccurredAt] = useState("");
  const [sqlBusy, setSqlBusy] = useState(false);
  const [mongoBusy, setMongoBusy] = useState(false);
  const [sqlMessage, setSqlMessage] = useState("");
  const [mongoMessage, setMongoMessage] = useState("");
  const [sqlError, setSqlError] = useState("");
  const [mongoError, setMongoError] = useState("");
  const [newCaseId, setNewCaseId] = useState<number | null>(null);

  async function submitSql(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setSqlBusy(true);
    setSqlError("");
    setSqlMessage("");
    const form = new FormData(formElement);
    try {
      const result = await postJson("/api/entries/sql", {
        firstName: form.get("firstName"),
        lastName: form.get("lastName"),
        dob: form.get("dob"),
        gender: form.get("gender"),
        bloodGroup: form.get("bloodGroup"),
        phone: form.get("phone"),
        address: form.get("address"),
        arrivalMode: form.get("arrivalMode"),
        chiefComplaint: form.get("chiefComplaint"),
        triageLevel: Number(form.get("triageLevel")),
      });
      setNewCaseId(result.caseId ?? null);
      setSqlMessage(`Patient ${result.patientId} and emergency case ${result.caseId} saved in MySQL.`);
      formElement.reset();
    } catch (error) {
      setSqlError(error instanceof Error ? error.message : "The MySQL record could not be saved.");
    } finally {
      setSqlBusy(false);
    }
  }

  async function submitMongo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setMongoBusy(true);
    setMongoError("");
    setMongoMessage("");
    const form = new FormData(formElement);
    const caseId = Number(form.get("caseId"));
    let data: Record<string, unknown>;

    if (mongoKind === "observation") {
      data = {
        kind: mongoKind,
        caseId,
        observedAt: new Date(String(form.get("observedAt"))).toISOString(),
        source: form.get("source"),
        vitals: {
          heart_rate: Number(form.get("heartRate")),
          resp_rate: Number(form.get("respRate")),
          spo2: Number(form.get("spo2")),
          on_supplemental_o2: form.get("oxygen") === "yes",
          bp: {
            systolic: Number(form.get("systolic")),
            diastolic: Number(form.get("diastolic")),
          },
          temp_c: Number(form.get("temperature")),
          consciousness: form.get("consciousness"),
          gcs: Number(form.get("gcs")),
          pain_score: Number(form.get("painScore")),
        },
        notes: form.get("notes"),
      };
    } else if (mongoKind === "note") {
      data = {
        kind: mongoKind,
        caseId,
        noteType: form.get("noteType"),
        title: form.get("title"),
        body: form.get("body"),
        tags: form.get("tags"),
      };
    } else {
      data = {
        kind: mongoKind,
        caseId,
        incidentType: form.get("incidentType"),
        occurredAt: new Date(String(form.get("occurredAt"))).toISOString(),
        location: form.get("location"),
        severity: form.get("severity"),
        harmLevel: form.get("harmLevel"),
        summary: form.get("summary"),
      };
    }

    try {
      const result = await postJson("/api/entries/mongo", data);
      setMongoMessage(result.incidentNo
        ? `Incident ${result.incidentNo} saved in MongoDB.`
        : `${mongoKind === "observation" ? "Observation" : "Clinical note"} saved in MongoDB (record ${result.id}).`);
      formElement.reset();
    } catch (error) {
      setMongoError(error instanceof Error ? error.message : "The MongoDB record could not be saved.");
    } finally {
      setMongoBusy(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.topBar}>
        <div className={styles.brandWrap}>
          <div className={styles.brandMark}>+</div>
          <div>
            <p className={styles.eyebrow}>Hospital ER</p>
            <h1>Emergency Operations Center</h1>
          </div>
        </div>
        <nav className={styles.nav} aria-label="Main navigation">
          <Link href="/" className={styles.navItem}>Overview</Link>
          <Link href="/entries" className={styles.navItemActive}>Data entry</Link>
        </nav>
      </header>

      <section className={styles.pageHeader}>
        <h2 className={styles.pageTitle}>Add a record</h2>
        <p className={styles.pageSubtitle}>
          Create a patient and emergency case in MySQL, then add observations, a clinical note, or an in-hospital incident to MongoDB.
        </p>
      </section>

      <section className={styles.entryGrid}>
        <article className={styles.entryCard}>
          <div className={styles.entryCardHeader}>
            <span className={styles.databaseBadge}>MySQL</span>
            <h3>Patient and emergency case</h3>
            <p>These linked rows are saved together. If either insert fails, neither is kept.</p>
          </div>
          <form className={styles.entryForm} onSubmit={submitSql}>
            <div className={styles.formGrid}>
              <label>First name<input name="firstName" required maxLength={50} /></label>
              <label>Last name<input name="lastName" required maxLength={50} /></label>
              <label>Date of birth<input name="dob" type="date" required /></label>
              <label>Gender
                <select name="gender" defaultValue="F">
                  <option value="F">Female</option><option value="M">Male</option><option value="O">Other</option>
                </select>
              </label>
              <label>Blood group
                <select name="bloodGroup" defaultValue="">
                  <option value="">Not recorded</option>
                  {["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((group) => <option key={group}>{group}</option>)}
                </select>
              </label>
              <label>Phone<input name="phone" maxLength={15} /></label>
              <label className={styles.fullWidth}>Address<input name="address" maxLength={200} /></label>
              <label>Arrival mode
                <select name="arrivalMode" defaultValue="Walk-in">
                  <option>Walk-in</option><option>Ambulance</option><option>Other</option>
                </select>
              </label>
              <label>Triage level
                <select name="triageLevel" defaultValue="3">
                  {[1, 2, 3, 4, 5].map((level) => <option key={level} value={level}>{level}</option>)}
                </select>
              </label>
              <label className={styles.fullWidth}>Chief complaint
                <input name="chiefComplaint" required maxLength={255} />
              </label>
            </div>
            <button className={styles.submitButton} type="submit" disabled={sqlBusy}>
              {sqlBusy ? "Saving to MySQL…" : "Save patient and case"}
            </button>
            {sqlError ? <p className={styles.errorMessage} role="alert">{sqlError}</p> : null}
            {sqlMessage ? <p className={styles.successMessage} role="status">{sqlMessage}</p> : null}
          </form>
        </article>

        <article className={styles.entryCard}>
          <div className={styles.entryCardHeader}>
            <span className={`${styles.databaseBadge} ${styles.mongoBadge}`}>MongoDB</span>
            <h3>Clinical and incident records</h3>
            <p>Each document must link to an emergency case already stored in MySQL.</p>
          </div>
          <form className={styles.entryForm} onSubmit={submitMongo}>
            <div className={styles.formGrid}>
              <label className={styles.fullWidth}>Record type
                <select value={mongoKind} onChange={(event) => setMongoKind(event.target.value as MongoKind)}>
                  <option value="observation">Vital-sign observation</option>
                  <option value="note">Clinical note</option>
                  <option value="incident">In-hospital incident</option>
                </select>
              </label>
              <label className={styles.fullWidth}>MySQL emergency case ID
                <input key={newCaseId} name="caseId" type="number" min="1" defaultValue={newCaseId ?? ""} required />
              </label>
              {mongoKind === "observation" ? (
                <>
                  <label>Observed at<input name="observedAt" type="datetime-local" value={observedAt} onFocus={() => { if (!observedAt) setObservedAt(localDateTime()); }} onChange={(event) => setObservedAt(event.target.value)} required /></label>
                  <label>Source
                    <select name="source" defaultValue="triage">
                      <option value="prehospital">Prehospital</option><option value="triage">Triage</option><option value="ward">Ward</option>
                    </select>
                  </label>
                  <label>Heart rate<input name="heartRate" type="number" min="20" max="250" defaultValue="88" required /></label>
                  <label>Respiratory rate<input name="respRate" type="number" min="4" max="60" defaultValue="18" required /></label>
                  <label>SpO₂<input name="spo2" type="number" min="50" max="100" defaultValue="98" required /></label>
                  <label>Supplemental oxygen
                    <select name="oxygen" defaultValue="no"><option value="no">No</option><option value="yes">Yes</option></select>
                  </label>
                  <label>Systolic BP<input name="systolic" type="number" min="40" max="300" defaultValue="120" required /></label>
                  <label>Diastolic BP<input name="diastolic" type="number" min="20" max="200" defaultValue="80" required /></label>
                  <label>Temperature °C<input name="temperature" type="number" min="30" max="45" step="0.1" defaultValue="36.8" required /></label>
                  <label>Consciousness
                    <select name="consciousness" defaultValue="A">
                      {["A", "C", "V", "P", "U"].map((value) => <option key={value} value={value}>{value}</option>)}
                    </select>
                  </label>
                  <label>GCS<input name="gcs" type="number" min="3" max="15" defaultValue="15" required /></label>
                  <label>Pain score<input name="painScore" type="number" min="0" max="10" defaultValue="1" required /></label>
                  <label className={styles.fullWidth}>Observation notes<input name="notes" maxLength={1000} /></label>
                </>
              ) : null}
              {mongoKind === "note" ? (
                <>
                  <label>Note type
                    <select name="noteType" defaultValue="progress">
                      {["triage", "assessment", "progress", "procedure", "handover", "discharge"].map((type) => <option key={type}>{type}</option>)}
                    </select>
                  </label>
                  <label>Tags (comma-separated)<input name="tags" placeholder="handover, follow-up" /></label>
                  <label className={styles.fullWidth}>Title<input name="title" minLength={3} maxLength={150} required /></label>
                  <label className={styles.fullWidth}>Note body<textarea name="body" minLength={1} maxLength={10000} rows={6} required /></label>
                </>
              ) : null}
              {mongoKind === "incident" ? (
                <>
                  <label>Incident type
                    <select name="incidentType" defaultValue="delay_in_care">
                      <option value="patient_fall">Patient fall</option>
                      <option value="medication_error">Medication error</option>
                      <option value="equipment_device">Equipment/device</option>
                      <option value="delay_in_care">Delay in care</option>
                      <option value="violence_aggression">Violence/aggression</option>
                      <option value="other">Other</option>
                    </select>
                  </label>
                  <label>Occurred at<input name="occurredAt" type="datetime-local" value={occurredAt} onFocus={() => { if (!occurredAt) setOccurredAt(localDateTime()); }} onChange={(event) => setOccurredAt(event.target.value)} required /></label>
                  <label>Severity
                    <select name="severity" defaultValue="moderate">
                      {["low", "moderate", "high", "critical"].map((value) => <option key={value}>{value}</option>)}
                    </select>
                  </label>
                  <label>Harm level
                    <select name="harmLevel" defaultValue="none">
                      {["none", "minor", "moderate", "severe"].map((value) => <option key={value}>{value}</option>)}
                    </select>
                  </label>
                  <label className={styles.fullWidth}>Location<input name="location" minLength={3} maxLength={200} required /></label>
                  <label className={styles.fullWidth}>Incident summary<textarea name="summary" minLength={10} maxLength={1000} rows={5} required /></label>
                </>
              ) : null}
            </div>
            <button className={styles.submitButton} type="submit" disabled={mongoBusy}>
              {mongoBusy ? "Saving to MongoDB…" : `Save ${mongoKind === "note" ? "clinical note" : mongoKind === "incident" ? "incident" : "observation"}`}
            </button>
            {mongoError ? <p className={styles.errorMessage} role="alert">{mongoError}</p> : null}
            {mongoMessage ? <p className={styles.successMessage} role="status">{mongoMessage}</p> : null}
          </form>
        </article>
      </section>

      <p className={styles.demoNotice}>
        Demo mode: MongoDB writes use the role and staff/doctor ID configured in <code>web/.env.local</code>. This is not a substitute for login or authorization in a deployed system.
      </p>
      <Link href="/" className={styles.backLink}>← Back to dashboard</Link>
    </main>
  );
}
