"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useStaffSession } from "@/components/app-shell";
import styles from "./page.module.css";

type MongoKind = "observation" | "note" | "incident";
type ClinicalOrderKind = "prescription" | "diagnostic_test";
type ClinicalOrderOptions = {
  cases: Array<{
    caseId: number;
    patientName: string;
    chiefComplaint: string | null;
    status: string;
  }>;
  medicines: Array<{ medicineId: number; name: string; type: string | null; stockQuantity: number }>;
  tests: Array<{ testId: number; name: string; type: string | null; cost: number }>;
};

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
  const { user } = useStaffSession();
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
  const [clinicalOptions, setClinicalOptions] = useState<ClinicalOrderOptions | null>(null);
  const [clinicalLoading, setClinicalLoading] = useState(false);
  const [clinicalError, setClinicalError] = useState("");
  const [orderBusy, setOrderBusy] = useState<ClinicalOrderKind | null>(null);
  const [orderMessage, setOrderMessage] = useState("");
  const [orderError, setOrderError] = useState("");
  const [testResultStatus, setTestResultStatus] = useState("Ordered");

  useEffect(() => {
    if (user?.role !== "doctor") return;
    const controller = new AbortController();

    async function loadClinicalOptions() {
      setClinicalLoading(true);
      setClinicalError("");
      try {
        const response = await fetch("/api/clinical-orders", { cache: "no-store", signal: controller.signal });
        const result = await response.json() as ClinicalOrderOptions & { error?: string };
        if (!response.ok) throw new Error(result.error || `Clinical options request failed (${response.status}).`);
        setClinicalOptions(result);
      } catch (error) {
        if (!controller.signal.aborted) {
          setClinicalError(error instanceof Error ? error.message : "Could not load prescription and test options.");
        }
      } finally {
        if (!controller.signal.aborted) setClinicalLoading(false);
      }
    }

    void loadClinicalOptions();
    return () => controller.abort();
  }, [user?.role]);

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

  async function submitClinicalOrder(event: FormEvent<HTMLFormElement>, kind: ClinicalOrderKind) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setOrderBusy(kind);
    setOrderError("");
    setOrderMessage("");
    const form = new FormData(formElement);
    const data: Record<string, unknown> = kind === "prescription"
      ? {
          kind,
          caseId: Number(form.get("caseId")),
          medicineId: Number(form.get("medicineId")),
          dosage: form.get("dosage"),
          frequency: form.get("frequency"),
        }
      : {
          kind,
          caseId: Number(form.get("caseId")),
          testId: Number(form.get("testId")),
          resultStatus: form.get("resultStatus"),
          resultValue: form.get("resultValue"),
        };

    try {
      const result = await postJson("/api/clinical-orders", data);
      setOrderMessage(kind === "prescription"
        ? `Prescription ${result.id} saved in MySQL.`
        : `Diagnostic test order ${result.id} saved in MySQL.`);
      if (kind === "diagnostic_test") setTestResultStatus("Ordered");
      formElement.reset();
    } catch (error) {
      setOrderError(error instanceof Error ? error.message : "The clinical order could not be saved.");
    } finally {
      setOrderBusy(null);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.pageHeader}>
        <h2 className={styles.pageTitle}>Add a record</h2>
        <p className={styles.pageSubtitle}>
          Create a patient and emergency case, add clinical records, and let doctors prescribe medication or order diagnostic tests.
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

      {user?.role === "doctor" ? (
        <section className={styles.clinicalOrderGrid} aria-label="Doctor prescriptions and diagnostic tests">
          <article className={styles.entryCard}>
            <div className={styles.entryCardHeader}>
              <span className={`${styles.databaseBadge} ${styles.sqlBadge}`}>MySQL</span>
              <h3>Prescribe medication</h3>
              <p>Record the medicine, dosage, and frequency for an active case. Your doctor account is attached automatically.</p>
            </div>
            <form className={styles.entryForm} onSubmit={(event) => void submitClinicalOrder(event, "prescription")}>
              <div className={styles.formGrid}>
                <label className={styles.fullWidth}>Emergency case
                  <select name="caseId" defaultValue="" required disabled={clinicalLoading || !clinicalOptions?.cases.length}>
                    <option value="" disabled>Select a case</option>
                    {clinicalOptions?.cases.map((item) => (
                      <option key={item.caseId} value={item.caseId}>
                        CASE-{String(item.caseId).padStart(3, "0")} · {item.patientName} · {item.chiefComplaint || item.status}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.fullWidth}>Medicine
                  <select name="medicineId" defaultValue="" required disabled={clinicalLoading || !clinicalOptions?.medicines.length}>
                    <option value="" disabled>Select a medicine</option>
                    {clinicalOptions?.medicines.map((medicine) => (
                      <option key={medicine.medicineId} value={medicine.medicineId}>
                        {medicine.name}{medicine.type ? ` · ${medicine.type}` : ""} · stock {medicine.stockQuantity}
                      </option>
                    ))}
                  </select>
                </label>
                <label>Dosage<input name="dosage" maxLength={100} placeholder="e.g. 500 mg" required /></label>
                <label>Frequency<input name="frequency" maxLength={100} placeholder="e.g. Every 6 hours" required /></label>
              </div>
              <button
                className={styles.submitButton}
                type="submit"
                disabled={orderBusy !== null || clinicalLoading || !clinicalOptions?.cases.length || !clinicalOptions.medicines.length}
              >
                {orderBusy === "prescription" ? "Saving prescription…" : "Save prescription"}
              </button>
            </form>
          </article>

          <article className={styles.entryCard}>
            <div className={styles.entryCardHeader}>
              <span className={`${styles.databaseBadge} ${styles.sqlBadge}`}>MySQL</span>
              <h3>Order diagnostic test</h3>
              <p>Choose an active case and test. Completed tests require a result before they can be saved.</p>
            </div>
            <form className={styles.entryForm} onSubmit={(event) => void submitClinicalOrder(event, "diagnostic_test")}>
              <div className={styles.formGrid}>
                <label className={styles.fullWidth}>Emergency case
                  <select name="caseId" defaultValue="" required disabled={clinicalLoading || !clinicalOptions?.cases.length}>
                    <option value="" disabled>Select a case</option>
                    {clinicalOptions?.cases.map((item) => (
                      <option key={item.caseId} value={item.caseId}>
                        CASE-{String(item.caseId).padStart(3, "0")} · {item.patientName} · {item.chiefComplaint || item.status}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.fullWidth}>Diagnostic test
                  <select name="testId" defaultValue="" required disabled={clinicalLoading || !clinicalOptions?.tests.length}>
                    <option value="" disabled>Select a test</option>
                    {clinicalOptions?.tests.map((test) => (
                      <option key={test.testId} value={test.testId}>
                        {test.name}{test.type ? ` · ${test.type}` : ""} · ₹{test.cost.toFixed(2)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>Test status
                  <select
                    name="resultStatus"
                    value={testResultStatus}
                    onChange={(event) => setTestResultStatus(event.target.value)}
                  >
                    <option>Ordered</option>
                    <option>In Progress</option>
                    <option>Completed</option>
                  </select>
                </label>
                <label>Result{testResultStatus === "Completed" ? " (required)" : ""}
                  <input name="resultValue" maxLength={255} required={testResultStatus === "Completed"} />
                </label>
              </div>
              <button
                className={styles.submitButton}
                type="submit"
                disabled={orderBusy !== null || clinicalLoading || !clinicalOptions?.cases.length || !clinicalOptions.tests.length}
              >
                {orderBusy === "diagnostic_test" ? "Saving test order…" : "Save diagnostic test"}
              </button>
            </form>
          </article>
          {clinicalLoading ? <p className={styles.orderStatus} role="status">Loading cases, medicines, and diagnostic tests…</p> : null}
          {clinicalError ? <p className={`${styles.orderStatus} ${styles.errorMessage}`} role="alert">{clinicalError}</p> : null}
          {clinicalOptions && !clinicalOptions.cases.length ? (
            <p className={styles.orderStatus}>There are no active cases available for your department.</p>
          ) : null}
          {clinicalOptions && !clinicalOptions.medicines.length ? (
            <p className={styles.orderStatus}>No medicines are available in the catalog.</p>
          ) : null}
          {clinicalOptions && !clinicalOptions.tests.length ? (
            <p className={styles.orderStatus}>No diagnostic tests are available in the catalog.</p>
          ) : null}
          {orderError ? <p className={`${styles.orderStatus} ${styles.errorMessage}`} role="alert">{orderError}</p> : null}
          {orderMessage ? <p className={`${styles.orderStatus} ${styles.successMessage}`} role="status">{orderMessage}</p> : null}
        </section>
      ) : null}

      <p className={styles.demoNotice}>
        Demo mode: MongoDB records are attributed to the staff member in the current role-based session. Shared role passwords are not individual identity authentication.
      </p>
      <Link href="/" className={styles.backLink}>Back to dashboard</Link>
    </main>
  );
}
