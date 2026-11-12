import mysql from "mysql2/promise";
import { NextRequest, NextResponse } from "next/server";
import { getStaffSession, unauthenticatedResponse } from "@/lib/staff-session";
import type { StaffSession } from "@/lib/staff-session";

type CaseRow = {
  case_id: number;
  first_name: string;
  last_name: string;
  chief_complaint: string | null;
  case_status: string;
} & mysql.RowDataPacket;

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
  return "Could not save or load clinical orders from MySQL. Check the server log for details.";
}

function doctorOnlyResponse(request: NextRequest):
  | { session: StaffSession; response: null }
  | { session: null; response: Response } {
  const session = getStaffSession(request);
  if (!session) return { session: null, response: unauthenticatedResponse() };
  if (session.role !== "doctor") {
    return {
      session: null,
      response: NextResponse.json({ error: "Only doctors can manage prescriptions and diagnostic tests." }, { status: 403 }),
    };
  }
  return { session, response: null };
}

async function caseIsAvailable(
  connection: mysql.Connection,
  caseId: number,
  departmentId: number,
) {
  const [rows] = await connection.execute<mysql.RowDataPacket[]>(`
    SELECT e.case_id
    FROM EMERGENCY_CASE e
    LEFT JOIN HOSPITAL_BED b ON b.bed_id = e.bed_id
    WHERE e.case_id = ?
      AND e.case_status IN ('Open', 'Under Treatment', 'Admitted')
      AND (
        b.department_id = ?
        OR e.bed_id IS NULL
        OR EXISTS (
          SELECT 1 FROM TREATMENT t
          JOIN DOCTOR d ON d.doctor_id = t.doctor_id
          WHERE t.case_id = e.case_id AND d.department_id = ?
        )
        OR EXISTS (
          SELECT 1 FROM TEST_ORDER o
          JOIN DOCTOR d ON d.doctor_id = o.doctor_id
          WHERE o.case_id = e.case_id AND d.department_id = ?
        )
      )
    LIMIT 1
  `, [caseId, departmentId, departmentId, departmentId]);
  return rows.length > 0;
}

export async function GET(request: NextRequest) {
  const access = doctorOnlyResponse(request);
  if (!access.session) return access.response;
  const { session } = access;

  let connection: mysql.Connection | undefined;
  try {
    connection = await mysql.createConnection(mysqlConfig());
    const [medicineRows] = await connection.execute<mysql.RowDataPacket[]>(`
      SELECT medicine_id, medicine_name, type, stock_quantity
      FROM MEDICINE
      ORDER BY medicine_name
    `);
    const [testRows] = await connection.execute<mysql.RowDataPacket[]>(`
      SELECT test_id, test_name, test_type, cost
      FROM DIAGNOSTIC_TEST
      ORDER BY test_name
    `);
    const [caseRows] = await connection.execute<CaseRow[]>(`
      SELECT e.case_id, p.first_name, p.last_name, e.chief_complaint, e.case_status
      FROM EMERGENCY_CASE e
      JOIN PATIENT p ON p.patient_id = e.patient_id
      LEFT JOIN HOSPITAL_BED b ON b.bed_id = e.bed_id
      WHERE e.case_status IN ('Open', 'Under Treatment', 'Admitted')
        AND (
          b.department_id = ?
          OR e.bed_id IS NULL
          OR EXISTS (
            SELECT 1 FROM TREATMENT t
            JOIN DOCTOR d ON d.doctor_id = t.doctor_id
            WHERE t.case_id = e.case_id AND d.department_id = ?
          )
          OR EXISTS (
            SELECT 1 FROM TEST_ORDER o
            JOIN DOCTOR d ON d.doctor_id = o.doctor_id
            WHERE o.case_id = e.case_id AND d.department_id = ?
          )
        )
      ORDER BY e.arrival_time DESC, e.case_id DESC
    `, [session.departmentId, session.departmentId, session.departmentId]);

    return NextResponse.json({
      medicines: medicineRows.map((row) => ({
        medicineId: Number(row.medicine_id),
        name: String(row.medicine_name),
        type: row.type === null ? null : String(row.type),
        stockQuantity: Number(row.stock_quantity),
      })),
      tests: testRows.map((row) => ({
        testId: Number(row.test_id),
        name: String(row.test_name),
        type: row.test_type === null ? null : String(row.test_type),
        cost: Number(row.cost),
      })),
      cases: caseRows.map((row) => ({
        caseId: Number(row.case_id),
        patientName: `${row.first_name} ${row.last_name}`,
        chiefComplaint: row.chief_complaint,
        status: row.case_status,
      })),
    });
  } catch (error) {
    console.error("Could not load clinical order options", error);
    const message = error instanceof Error && error.message.startsWith("MYSQL_HOST")
      ? error.message
      : databaseError(error);
    return NextResponse.json({ error: message }, { status: 503 });
  } finally {
    if (connection) await connection.end();
  }
}

export async function POST(request: NextRequest) {
  const access = doctorOnlyResponse(request);
  if (!access.session) return access.response;
  const { session } = access;

  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return NextResponse.json({ error: "Request body must be a JSON object." }, { status: 400 });
  }

  const input = value as Record<string, unknown>;
  const caseId = typeof input.caseId === "number" ? input.caseId : 0;
  if (!Number.isInteger(caseId) || caseId < 1) {
    return NextResponse.json({ error: "Choose a valid emergency case." }, { status: 400 });
  }

  const kind = input.kind;
  const dosage = typeof input.dosage === "string" ? input.dosage.trim() : "";
  const frequency = typeof input.frequency === "string" ? input.frequency.trim() : "";
  const resultStatus = typeof input.resultStatus === "string" ? input.resultStatus : "";
  const resultValue = typeof input.resultValue === "string" ? input.resultValue.trim() : "";
  const medicineId = typeof input.medicineId === "number" ? input.medicineId : 0;
  const testId = typeof input.testId === "number" ? input.testId : 0;
  if (kind === "prescription") {
    if (
      !Number.isInteger(medicineId) || medicineId < 1 ||
      !dosage || dosage.length > 100 ||
      !frequency || frequency.length > 100
    ) {
      return NextResponse.json({ error: "Choose a medicine and enter valid dosage and frequency details." }, { status: 400 });
    }
  } else if (kind === "diagnostic_test") {
    if (!Number.isInteger(testId) || testId < 1) {
      return NextResponse.json({ error: "Choose a diagnostic test." }, { status: 400 });
    }
    if (input.resultValue !== undefined && typeof input.resultValue !== "string") {
      return NextResponse.json({ error: "Test result must be text." }, { status: 400 });
    }
    if (!["Ordered", "In Progress", "Completed"].includes(resultStatus)) {
      return NextResponse.json({ error: "Choose a valid diagnostic test status." }, { status: 400 });
    }
    if (resultValue.length > 255 || (resultStatus === "Completed" && !resultValue)) {
      return NextResponse.json({ error: "Enter a result of up to 255 characters for a completed test." }, { status: 400 });
    }
  } else {
    return NextResponse.json({ error: "Choose a prescription or diagnostic test." }, { status: 400 });
  }

  let connection: mysql.Connection | undefined;
  try {
    connection = await mysql.createConnection(mysqlConfig());
    if (!await caseIsAvailable(connection, caseId, session.departmentId)) {
      return NextResponse.json({ error: "Choose an active case assigned to your department or in the unassigned ER queue." }, { status: 400 });
    }

    if (kind === "prescription") {
      const [medicineRows] = await connection.execute<mysql.RowDataPacket[]>(
        "SELECT medicine_id FROM MEDICINE WHERE medicine_id = ?",
        [medicineId],
      );
      if (!medicineRows.length) {
        return NextResponse.json({ error: "The selected medicine is no longer available. Refresh and choose another." }, { status: 400 });
      }

      const [result] = await connection.execute<mysql.ResultSetHeader>(`
        INSERT INTO PRESCRIPTION (dosage, frequency, case_id, medicine_id, doctor_id)
        VALUES (?, ?, ?, ?, ?)
      `, [dosage, frequency, caseId, medicineId, session.staffId]);
      return NextResponse.json({ id: String(result.insertId), kind }, { status: 201 });
    }

    const [testRows] = await connection.execute<mysql.RowDataPacket[]>(
      "SELECT test_id FROM DIAGNOSTIC_TEST WHERE test_id = ?",
      [testId],
    );
    if (!testRows.length) {
      return NextResponse.json({ error: "The selected diagnostic test is no longer available. Refresh and choose another." }, { status: 400 });
    }

    const [result] = await connection.execute<mysql.ResultSetHeader>(`
      INSERT INTO TEST_ORDER (result_status, result_value, case_id, doctor_id, test_id)
      VALUES (?, ?, ?, ?, ?)
    `, [
      resultStatus,
      resultValue || null,
      caseId,
      session.staffId,
      testId,
    ]);
    return NextResponse.json({ id: String(result.insertId), kind }, { status: 201 });
  } catch (error) {
    console.error("Could not save clinical order", error);
    const message = error instanceof Error && error.message.startsWith("MYSQL_HOST")
      ? error.message
      : databaseError(error);
    return NextResponse.json({ error: message }, { status: 503 });
  } finally {
    if (connection) await connection.end();
  }
}
