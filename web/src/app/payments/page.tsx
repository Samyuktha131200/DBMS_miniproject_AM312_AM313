"use client";

import { useEffect, useState } from "react";
import { useStaffSession } from "@/components/app-shell";
import styles from "../page.module.css";
import pageStyles from "./page.module.css";

type PaymentRecord = {
  patientId: number;
  patientName: string;
  patientCaseCount: number;
  caseId: number;
  caseStatus: string;
  chiefComplaint: string | null;
  department: string;
  billId: number | null;
  totalAmount: number | null;
  paymentStatus: string | null;
  paymentMode: string | null;
  billDate: string | null;
  canDeletePatient: boolean;
};

type PaymentsResponse = { department: string; payments: PaymentRecord[] };

async function sendJson(url: string, method: "POST" | "PATCH" | "DELETE", data?: Record<string, unknown>) {
  const response = await fetch(url, {
    method,
    ...(data ? {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    } : {}),
  });
  const result = await response.json() as { error?: string; patientId?: number; deletedCases?: number };
  if (!response.ok) throw new Error(result.error || `Payment request failed (${response.status}).`);
  return result;
}

function paymentTone(status: string | null) {
  if (status === "Paid") return `${styles.inlineTag} ${styles.success}`;
  if (status === "Partially Paid") return `${styles.inlineTag} ${styles.warn}`;
  return `${styles.inlineTag} ${styles.info}`;
}

export default function PaymentsPage() {
  const { user } = useStaffSession();
  const [data, setData] = useState<PaymentsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [savingBillId, setSavingBillId] = useState<number | null>(null);
  const [creatingCaseId, setCreatingCaseId] = useState<number | null>(null);
  const [deletingPatientId, setDeletingPatientId] = useState<number | null>(null);
  const [statusDrafts, setStatusDrafts] = useState<Record<number, string>>({});
  const [modeDrafts, setModeDrafts] = useState<Record<number, string>>({});
  const [amountDrafts, setAmountDrafts] = useState<Record<number, string>>({});
  const [newModeDrafts, setNewModeDrafts] = useState<Record<number, string>>({});

  useEffect(() => {
    const controller = new AbortController();

    async function loadPayments() {
      try {
        const response = await fetch("/api/payments", { cache: "no-store", signal: controller.signal });
        const result = await response.json() as PaymentsResponse & { error?: string };
        if (!response.ok) throw new Error(result.error || `Payment request failed (${response.status}).`);
        setData(result);
        setError("");
      } catch (requestError) {
        if (!controller.signal.aborted) {
          setError(requestError instanceof Error ? requestError.message : "Could not load payment records.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadPayments();
    const interval = window.setInterval(() => void loadPayments(), 15000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [refreshVersion]);

  function refresh() {
    setLoading(true);
    setRefreshVersion((version) => version + 1);
  }

  async function savePayment(payment: PaymentRecord) {
    if (payment.billId === null) return;
    setSavingBillId(payment.billId);
    setError("");
    setMessage("");
    try {
      const paymentStatus = statusDrafts[payment.billId] ?? payment.paymentStatus ?? "Pending";
      const paymentMode = modeDrafts[payment.billId] ?? payment.paymentMode ?? "Other";
      await sendJson("/api/payments", "PATCH", {
        billId: payment.billId,
        paymentStatus,
        paymentMode,
      });
      setMessage(`Payment for case ${payment.caseId} updated to ${paymentStatus}.`);
      setStatusDrafts((drafts) => Object.fromEntries(
        Object.entries(drafts).filter(([id]) => Number(id) !== payment.billId),
      ));
      setModeDrafts((drafts) => Object.fromEntries(
        Object.entries(drafts).filter(([id]) => Number(id) !== payment.billId),
      ));
      setLoading(true);
      setRefreshVersion((version) => version + 1);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not update the payment.");
    } finally {
      setSavingBillId(null);
    }
  }

  async function createBill(payment: PaymentRecord) {
    const totalAmount = Number(amountDrafts[payment.caseId]);
    const paymentMode = newModeDrafts[payment.caseId] ?? "Other";
    setCreatingCaseId(payment.caseId);
    setError("");
    setMessage("");
    try {
      await sendJson("/api/payments", "POST", {
        caseId: payment.caseId,
        totalAmount,
        paymentMode,
      });
      setMessage(`A bill was created for case ${payment.caseId}.`);
      setLoading(true);
      setRefreshVersion((version) => version + 1);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not create the bill.");
    } finally {
      setCreatingCaseId(null);
    }
  }

  async function deletePatient(payment: PaymentRecord) {
    const confirmed = window.confirm(
      `Permanently remove ${payment.patientName} and all ${payment.patientCaseCount} discharged, paid emergency case records from MySQL? Associated billing, treatments, prescriptions, and test orders will also be deleted. MongoDB notes, observations, and incident reports are retained.`,
    );
    if (!confirmed) return;

    setDeletingPatientId(payment.patientId);
    setError("");
    setMessage("");
    try {
      const result = await sendJson(`/api/patients/${payment.patientId}`, "DELETE");
      setMessage(`Patient PAT-${String(result.patientId).padStart(4, "0")} and ${result.deletedCases} case record(s) were removed.`);
      setLoading(true);
      setRefreshVersion((version) => version + 1);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not remove the patient record.");
    } finally {
      setDeletingPatientId(null);
    }
  }

  const payments = data?.payments ?? [];
  const billedTotal = payments.reduce((sum, payment) => sum + (payment.totalAmount ?? 0), 0);
  const paidTotal = payments.reduce(
    (sum, payment) => sum + (payment.paymentStatus === "Paid" ? payment.totalAmount ?? 0 : 0),
    0,
  );
  const unpaidBillCount = payments.filter(
    (payment) => payment.billId !== null && payment.paymentStatus !== "Paid",
  ).length;
  const deleteActionCaseIds = new Set(
    payments
      .filter((payment, index, records) =>
        payment.canDeletePatient && records.findIndex((record) => record.patientId === payment.patientId) === index)
      .map((payment) => payment.caseId),
  );

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <p className={styles.eyebrow}>MySQL billing · {data?.department ?? user?.departmentName}</p>
        <h1 className={styles.pageTitle}>Payments</h1>
        <p className={styles.pageSubtitle}>
          Review case bills and payment status. Patient removal is available only after every case is discharged and paid.
        </p>
      </header>

      {error ? <div className={styles.statusBanner} role="alert">{error}</div> : null}
      {message ? <div className={pageStyles.successBanner} role="status">{message}</div> : null}
      {loading && !data ? <div className={styles.loadingText}>Loading billing records from MySQL…</div> : null}

      {data ? (
        <>
          <section className={styles.summaryGrid} aria-label="Payment summary">
            <div className={styles.metricCard}>
              <p>Total billed</p><div className={styles.value}>₹{billedTotal.toFixed(2)}</div>
              <div className={styles.meta}>{payments.filter((payment) => payment.billId !== null).length} case bills</div>
            </div>
            <div className={styles.metricCard}>
              <p>Paid</p><div className={styles.value}>₹{paidTotal.toFixed(2)}</div>
              <div className={styles.meta}>Bills marked paid</div>
            </div>
            <div className={styles.metricCard}>
              <p>Unpaid / partial bills</p><div className={styles.value}>{unpaidBillCount}</div>
              <div className={styles.meta}>Pending or partially paid</div>
            </div>
            <div className={styles.metricCard}>
              <p>Cases</p><div className={styles.value}>{payments.length}</div>
              <div className={styles.meta}>Cases in your department</div>
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <div>
                <h3>{data.department} payments</h3>
                <p>Payment updates are shared by doctors and nurses.</p>
              </div>
              <button type="button" onClick={refresh} disabled={loading}>
                {loading ? "Refreshing…" : "Refresh"}
              </button>
            </div>
            <div className={`${styles.tableWrap} ${pageStyles.paymentTable}`}>
              <table>
                <thead>
                  <tr>
                    <th>Patient / case</th>
                    <th>Department</th>
                    <th>Case status</th>
                    <th>Bill amount</th>
                    <th>Payment status</th>
                    <th>Method</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((payment) => (
                    <tr key={payment.caseId}>
                      <td>
                        <strong>{payment.patientName}</strong>
                        <small className={pageStyles.caseLabel}>
                          PAT-{String(payment.patientId).padStart(4, "0")} · CASE-{String(payment.caseId).padStart(3, "0")}
                          {payment.chiefComplaint ? ` · ${payment.chiefComplaint}` : ""}
                        </small>
                      </td>
                      <td>{payment.department}</td>
                      <td><span className={payment.caseStatus === "Discharged" ? `${styles.inlineTag} ${styles.success}` : `${styles.inlineTag} ${styles.info}`}>{payment.caseStatus}</span></td>
                      <td>
                        {payment.billId === null ? (
                          <label className={pageStyles.amountField}>
                            <span className={pageStyles.visuallyHidden}>Bill amount for case {payment.caseId}</span>
                            <span>₹</span>
                            <input
                              type="number"
                              min="0"
                              max="99999999.99"
                              step="0.01"
                              value={amountDrafts[payment.caseId] ?? ""}
                              onChange={(event) => setAmountDrafts((drafts) => ({ ...drafts, [payment.caseId]: event.target.value }))}
                              aria-label={`Bill amount for case ${payment.caseId}`}
                              placeholder="Add bill"
                            />
                          </label>
                        ) : `₹${(payment.totalAmount ?? 0).toFixed(2)}`}
                      </td>
                      <td>
                        {payment.billId === null
                          ? <span className={`${styles.inlineTag} ${styles.warn}`}>No bill</span>
                          : <span className={paymentTone(payment.paymentStatus)}>{payment.paymentStatus}</span>}
                      </td>
                      <td>
                        {payment.billId === null ? (
                          <select
                            className={pageStyles.methodSelect}
                            aria-label={`Payment method for case ${payment.caseId}`}
                            value={newModeDrafts[payment.caseId] ?? "Other"}
                            onChange={(event) => setNewModeDrafts((drafts) => ({ ...drafts, [payment.caseId]: event.target.value }))}
                          >
                            {["Cash", "Card", "UPI", "Insurance", "Other"].map((mode) => <option key={mode}>{mode}</option>)}
                          </select>
                        ) : (
                          <select
                            className={pageStyles.methodSelect}
                            aria-label={`Payment method for bill ${payment.billId}`}
                            value={modeDrafts[payment.billId] ?? payment.paymentMode ?? "Other"}
                            onChange={(event) => setModeDrafts((drafts) => ({ ...drafts, [payment.billId!]: event.target.value }))}
                          >
                            {["Cash", "Card", "UPI", "Insurance", "Other"].map((mode) => <option key={mode}>{mode}</option>)}
                          </select>
                        )}
                      </td>
                      <td>
                        {payment.billId === null ? (
                          <button
                            className={pageStyles.actionButton}
                            type="button"
                            disabled={creatingCaseId === payment.caseId || amountDrafts[payment.caseId] === undefined || amountDrafts[payment.caseId] === ""}
                            onClick={() => void createBill(payment)}
                          >
                            {creatingCaseId === payment.caseId ? "Creating…" : "Create bill"}
                          </button>
                        ) : (
                          <div className={pageStyles.actionGroup}>
                            <select
                              className={pageStyles.methodSelect}
                              aria-label={`Payment status for bill ${payment.billId}`}
                              value={statusDrafts[payment.billId] ?? payment.paymentStatus ?? "Pending"}
                              onChange={(event) => setStatusDrafts((drafts) => ({ ...drafts, [payment.billId!]: event.target.value }))}
                            >
                              {["Pending", "Partially Paid", "Paid"].map((status) => <option key={status}>{status}</option>)}
                            </select>
                            <button
                              className={pageStyles.actionButton}
                              type="button"
                              disabled={
                                savingBillId === payment.billId ||
                                ((statusDrafts[payment.billId] ?? payment.paymentStatus) === payment.paymentStatus &&
                                  (modeDrafts[payment.billId] ?? payment.paymentMode ?? "Other") === (payment.paymentMode ?? "Other"))
                              }
                              onClick={() => void savePayment(payment)}
                            >
                              {savingBillId === payment.billId ? "Saving…" : "Save"}
                            </button>
                          </div>
                        )}
                        {deleteActionCaseIds.has(payment.caseId) ? (
                          <button
                            className={pageStyles.deleteButton}
                            type="button"
                            disabled={deletingPatientId === payment.patientId}
                            onClick={() => void deletePatient(payment)}
                          >
                            {deletingPatientId === payment.patientId ? "Removing…" : "Remove patient"}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                  {!payments.length ? (
                    <tr><td colSpan={7}>No cases are available in your department.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
          <p className={pageStyles.retentionNotice}>
            Removing a patient permanently deletes the patient, their discharged cases, bills, treatments, prescriptions, and test orders from MySQL. MongoDB notes, observations, and incident reports remain as clinical audit records.
          </p>
        </>
      ) : null}
    </main>
  );
}