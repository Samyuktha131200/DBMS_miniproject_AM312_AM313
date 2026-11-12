import mysql from "mysql2/promise";
import { NextRequest, NextResponse } from "next/server";
import { getStaffSession, unauthenticatedResponse } from "@/lib/staff-session";

type PatientRow = mysql.RowDataPacket & { patient_id: number };
type PatientCaseRow = mysql.RowDataPacket & {
  case_id: number;
  case_status: string;
  payment_status: string | null;
  in_department: number;
};

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
  if (code === "ER_BAD_DB_ERROR" || code === "ER_NO_SUCH_TABLE") {
    return "A required MySQL database or table is missing. Run 01_schema.sql in MySQL Workbench.";
  }
  return "Could not remove the patient record. Check the MySQL server and logs.";
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ patientId: string }> },
) {
  const session = getStaffSession(request);
  if (!session) return unauthenticatedResponse();

  const { patientId: rawPatientId } = await params;
  const patientId = /^\d+$/.test(rawPatientId) ? Number(rawPatientId) : Number.NaN;
  if (!Number.isSafeInteger(patientId) || patientId < 1) {
    return NextResponse.json({ error: "Patient ID must be a positive integer." }, { status: 400 });
  }

  let connection: mysql.Connection | undefined;
  try {
    connection = await mysql.createConnection(mysqlConfig());
    await connection.beginTransaction();

    const [patients] = await connection.execute<PatientRow[]>(
      "SELECT patient_id FROM PATIENT WHERE patient_id = ? FOR UPDATE",
      [patientId],
    );
    if (!patients.length) {
      await connection.rollback();
      return NextResponse.json({ error: "Patient record not found." }, { status: 404 });
    }

    const [cases] = await connection.execute<PatientCaseRow[]>(`
      SELECT e.case_id, e.case_status, bill.payment_status,
        (bed.department_id = ?
          OR e.bed_id IS NULL
          OR EXISTS (
            SELECT 1 FROM TREATMENT t JOIN DOCTOR d ON d.doctor_id = t.doctor_id
            WHERE t.case_id = e.case_id AND d.department_id = ?
          )
          OR EXISTS (
            SELECT 1 FROM TEST_ORDER o JOIN DOCTOR d ON d.doctor_id = o.doctor_id
            WHERE o.case_id = e.case_id AND d.department_id = ?
          )) AS in_department
      FROM EMERGENCY_CASE e
      LEFT JOIN HOSPITAL_BED bed ON bed.bed_id = e.bed_id
      LEFT JOIN BILLING bill ON bill.case_id = e.case_id
      WHERE e.patient_id = ?
      FOR UPDATE
    `, [session.departmentId, session.departmentId, session.departmentId, patientId]);

    if (!cases.length) {
      await connection.rollback();
      return NextResponse.json({ error: "Only patients with discharged, paid emergency cases can be removed." }, { status: 409 });
    }
    if (cases.some((caseRow) => !caseRow.in_department)) {
      await connection.rollback();
      return NextResponse.json({ error: "This patient has cases outside your department." }, { status: 403 });
    }
    if (cases.some((caseRow) => caseRow.case_status !== "Discharged" || caseRow.payment_status !== "Paid")) {
      await connection.rollback();
      return NextResponse.json({ error: "Every emergency case must be discharged and have a paid bill before removing this patient." }, { status: 409 });
    }

    // The database trigger validates eligibility; foreign keys remove dependent SQL rows.
    const [deleteResult] = await connection.execute<mysql.ResultSetHeader>(
      "DELETE FROM PATIENT WHERE patient_id = ?",
      [patientId],
    );
    if (deleteResult.affectedRows !== 1) throw new Error("The patient record was not removed.");

    await connection.commit();
    return NextResponse.json({ patientId, deletedCases: cases.length });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Could not delete patient record", error);
    const message = error instanceof Error && error.message.startsWith("MYSQL_HOST")
      ? error.message
      : databaseError(error);
    return NextResponse.json({ error: message }, { status: 503 });
  } finally {
    if (connection) await connection.end();
  }
}