import mysql from "mysql2/promise";
import { NextRequest, NextResponse } from "next/server";
import { getStaffSession, unauthenticatedResponse } from "@/lib/staff-session";

type PaymentRow = mysql.RowDataPacket & {
  patient_id: number;
  first_name: string;
  last_name: string;
  patient_case_count: number;
  case_id: number;
  case_status: string;
  chief_complaint: string | null;
  department: string;
  bill_id: number | null;
  total_amount: number | string | null;
  payment_status: string | null;
  payment_mode: string | null;
  bill_date: Date | string | null;
};

const PAYMENT_STATUSES = ["Pending", "Partially Paid", "Paid"] as const;
const PAYMENT_MODES = ["Cash", "Card", "UPI", "Insurance", "Other"] as const;

function mysqlConfig() {
  const host = process.env.MYSQL_HOST;
  if (!host) throw new Error("MYSQL_HOST is not set in web/.env.local.");
  return {
    host,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || "root",
    password: process.env.MYSQL_PASSWORD || "",
    database: process.env.MYSQL_DATABASE || "hospital_emergency_management",
  };
}

function databaseError(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (code === "ECONNREFUSED" || code === "ENOTFOUND") {
    return "Could not reach MySQL. Start the server and verify MYSQL_HOST and MYSQL_PORT.";
  }
  if (code === "ER_ACCESS_DENIED_ERROR") {
    return "MySQL rejected the configured user or password. Check MYSQL_USER and MYSQL_PASSWORD.";
  }
  if (code === "ER_BAD_DB_ERROR") {
    return "The configured MySQL database does not exist. Run 01_schema.sql in MySQL Workbench.";
  }
  if (code === "ER_NO_SUCH_TABLE") {
    return "A required MySQL table is missing. Run 01_schema.sql in MySQL Workbench.";
  }
  if (code === "ER_DUP_ENTRY") {
    return "A bill already exists for this emergency case. Refresh the payment page.";
  }
  return "Could not load or update payments. Check the MySQL server and logs.";
}

function caseScopeSql(alias: string) {
  return `(
    ${alias}.bed_id IS NULL
    OR EXISTS (
      SELECT 1 FROM HOSPITAL_BED scoped_bed
      WHERE scoped_bed.bed_id = ${alias}.bed_id
        AND scoped_bed.department_id = ?
    )
    OR EXISTS (
      SELECT 1 FROM TREATMENT scoped_treatment
      JOIN DOCTOR scoped_doctor ON scoped_doctor.doctor_id = scoped_treatment.doctor_id
      WHERE scoped_treatment.case_id = ${alias}.case_id
        AND scoped_doctor.department_id = ?
    )
    OR EXISTS (
      SELECT 1 FROM TEST_ORDER scoped_order
      JOIN DOCTOR scoped_doctor ON scoped_doctor.doctor_id = scoped_order.doctor_id
      WHERE scoped_order.case_id = ${alias}.case_id
        AND scoped_doctor.department_id = ?
    )
  )`;
}

async function caseIsInDepartment(
  connection: mysql.Connection,
  caseId: number,
  departmentId: number,
) {
  const [rows] = await connection.execute<mysql.RowDataPacket[]>(
    `SELECT e.case_id FROM EMERGENCY_CASE e
     WHERE e.case_id = ? AND ${caseScopeSql("e")}
     LIMIT 1 FOR UPDATE`,
    [caseId, departmentId, departmentId, departmentId],
  );
  return rows.length > 0;
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export async function GET(request: NextRequest) {
  const session = getStaffSession(request);
  if (!session) return unauthenticatedResponse();

  let connection: mysql.Connection | undefined;
  try {
    connection = await mysql.createConnection(mysqlConfig());
    const [rows] = await connection.execute<PaymentRow[]>(`
      SELECT
        p.patient_id, p.first_name, p.last_name,
        (SELECT COUNT(*) FROM EMERGENCY_CASE patient_case
         WHERE patient_case.patient_id = p.patient_id) AS patient_case_count,
        e.case_id, e.case_status, e.chief_complaint,
        COALESCE(dept.dept_name,
          (SELECT treatment_dept.dept_name FROM TREATMENT t
           JOIN DOCTOR td ON td.doctor_id = t.doctor_id
           JOIN DEPARTMENT treatment_dept ON treatment_dept.department_id = td.department_id
           WHERE t.case_id = e.case_id ORDER BY t.start_time DESC LIMIT 1),
          (SELECT test_dept.dept_name FROM TEST_ORDER o
           JOIN DOCTOR od ON od.doctor_id = o.doctor_id
           JOIN DEPARTMENT test_dept ON test_dept.department_id = od.department_id
           WHERE o.case_id = e.case_id ORDER BY o.order_time DESC LIMIT 1),
          'Unassigned ER queue') AS department,
        b.bill_id, b.total_amount, b.payment_status, b.payment_mode, b.bill_date
      FROM EMERGENCY_CASE e
      JOIN PATIENT p ON p.patient_id = e.patient_id
      LEFT JOIN HOSPITAL_BED bed ON bed.bed_id = e.bed_id
      LEFT JOIN DEPARTMENT dept ON dept.department_id = bed.department_id
      LEFT JOIN BILLING b ON b.case_id = e.case_id
      WHERE bed.department_id = ?
        OR e.bed_id IS NULL
        OR EXISTS (
          SELECT 1 FROM TREATMENT t JOIN DOCTOR d ON d.doctor_id = t.doctor_id
          WHERE t.case_id = e.case_id AND d.department_id = ?
        )
        OR EXISTS (
          SELECT 1 FROM TEST_ORDER o JOIN DOCTOR d ON d.doctor_id = o.doctor_id
          WHERE o.case_id = e.case_id AND d.department_id = ?
        )
      ORDER BY e.arrival_time DESC, e.case_id DESC
    `, [session.departmentId, session.departmentId, session.departmentId]);

    const patientCases = new Map<number, PaymentRow[]>();
    for (const row of rows) {
      const current = patientCases.get(row.patient_id) ?? [];
      current.push(row);
      patientCases.set(row.patient_id, current);
    }
    const deletablePatientIds = new Set<number>();
    for (const [patientId, cases] of patientCases) {
      if (
        cases.length === Number(cases[0]?.patient_case_count) &&
        cases.every((caseRow) => caseRow.case_status === "Discharged" && caseRow.payment_status === "Paid")
      ) {
        deletablePatientIds.add(patientId);
      }
    }

    return NextResponse.json({
      department: session.departmentName,
      payments: rows.map((row) => ({
        patientId: row.patient_id,
        patientName: `${row.first_name} ${row.last_name}`,
        patientCaseCount: Number(row.patient_case_count),
        caseId: row.case_id,
        caseStatus: row.case_status,
        chiefComplaint: row.chief_complaint,
        department: row.department,
        billId: row.bill_id,
        totalAmount: row.total_amount === null ? null : Number(row.total_amount),
        paymentStatus: row.payment_status,
        paymentMode: row.payment_mode,
        billDate: row.bill_date,
        canDeletePatient: deletablePatientIds.has(row.patient_id),
      })),
    });
  } catch (error) {
    console.error("Could not load payment records", error);
    const message = error instanceof Error && error.message.startsWith("MYSQL_HOST")
      ? error.message
      : databaseError(error);
    return NextResponse.json({ error: message }, { status: 503 });
  } finally {
    if (connection) await connection.end();
  }
}

export async function POST(request: NextRequest) {
  const session = getStaffSession(request);
  if (!session) return unauthenticatedResponse();

  let body: Record<string, unknown> | null;
  try {
    body = parseJsonObject(await request.json());
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  if (!body) return NextResponse.json({ error: "Request body must be a JSON object." }, { status: 400 });

  const caseId = typeof body.caseId === "number" ? body.caseId : 0;
  const totalAmount = typeof body.totalAmount === "number" ? body.totalAmount : Number.NaN;
  const paymentMode = typeof body.paymentMode === "string" ? body.paymentMode : "";
  if (
    !Number.isSafeInteger(caseId) || caseId < 1 ||
    !Number.isFinite(totalAmount) || totalAmount < 0 || totalAmount > 99_999_999.99 ||
    Math.abs(totalAmount * 100 - Math.round(totalAmount * 100)) > 1e-8 ||
    !PAYMENT_MODES.includes(paymentMode as (typeof PAYMENT_MODES)[number])
  ) {
    return NextResponse.json({ error: "Enter a valid case, bill amount, and payment method." }, { status: 400 });
  }

  let connection: mysql.Connection | undefined;
  try {
    connection = await mysql.createConnection(mysqlConfig());
    await connection.beginTransaction();
    if (!await caseIsInDepartment(connection, caseId, session.departmentId)) {
      await connection.rollback();
      return NextResponse.json({ error: "Case not found in your department." }, { status: 404 });
    }
    const [result] = await connection.execute<mysql.ResultSetHeader>(
      `INSERT INTO BILLING (total_amount, payment_status, payment_mode, case_id)
       VALUES (?, 'Pending', ?, ?)`,
      [totalAmount, paymentMode, caseId],
    );
    await connection.commit();
    return NextResponse.json({ billId: result.insertId, paymentStatus: "Pending" }, { status: 201 });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Could not create bill", error);
    if (error && typeof error === "object" && "code" in error && error.code === "ER_DUP_ENTRY") {
      return NextResponse.json({ error: databaseError(error) }, { status: 409 });
    }
    const message = error instanceof Error && error.message.startsWith("MYSQL_HOST")
      ? error.message
      : databaseError(error);
    return NextResponse.json({ error: message }, { status: 503 });
  } finally {
    if (connection) await connection.end();
  }
}

export async function PATCH(request: NextRequest) {
  const session = getStaffSession(request);
  if (!session) return unauthenticatedResponse();

  let body: Record<string, unknown> | null;
  try {
    body = parseJsonObject(await request.json());
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  if (!body) return NextResponse.json({ error: "Request body must be a JSON object." }, { status: 400 });

  const billId = typeof body.billId === "number" ? body.billId : 0;
  const paymentStatus = typeof body.paymentStatus === "string" ? body.paymentStatus : "";
  const paymentMode = typeof body.paymentMode === "string" ? body.paymentMode : "";
  if (
    !Number.isSafeInteger(billId) || billId < 1 ||
    !PAYMENT_STATUSES.includes(paymentStatus as (typeof PAYMENT_STATUSES)[number]) ||
    !PAYMENT_MODES.includes(paymentMode as (typeof PAYMENT_MODES)[number])
  ) {
    return NextResponse.json({ error: "Choose a valid payment status and method." }, { status: 400 });
  }

  let connection: mysql.Connection | undefined;
  try {
    connection = await mysql.createConnection(mysqlConfig());
    await connection.beginTransaction();
    const [billRows] = await connection.execute<mysql.RowDataPacket[]>(
      `SELECT b.bill_id, e.case_id
       FROM BILLING b JOIN EMERGENCY_CASE e ON e.case_id = b.case_id
       WHERE b.bill_id = ? AND ${caseScopeSql("e")}
       LIMIT 1 FOR UPDATE`,
      [billId, session.departmentId, session.departmentId, session.departmentId],
    );
    const bill = billRows[0];
    if (!bill) {
      await connection.rollback();
      return NextResponse.json({ error: "Bill not found in your department." }, { status: 404 });
    }

    await connection.execute(
      "UPDATE BILLING SET payment_status = ?, payment_mode = ? WHERE bill_id = ?",
      [paymentStatus, paymentMode, billId],
    );
    await connection.commit();
    return NextResponse.json({ billId, caseId: Number(bill.case_id), paymentStatus, paymentMode });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Could not update payment", error);
    const message = error instanceof Error && error.message.startsWith("MYSQL_HOST")
      ? error.message
      : databaseError(error);
    return NextResponse.json({ error: message }, { status: 503 });
  } finally {
    if (connection) await connection.end();
  }
}