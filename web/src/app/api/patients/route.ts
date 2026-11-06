import mysql from "mysql2/promise";
import { NextRequest, NextResponse } from "next/server";
import { getStaffSession, unauthenticatedResponse } from "@/lib/staff-session";

type SummaryDbRow = {
  total_patients: number | string;
  active_cases: number | string;
  critical_cases: number | string;
  discharged_cases: number | string;
} & mysql.RowDataPacket;

type PatientDbRow = {
  patient_id: number;
  first_name: string;
  last_name: string;
  case_id: number | null;
  case_status: string | null;
  triage_level: number | null;
  dept_name: string | null;
} & mysql.RowDataPacket;

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
  return "Could not load patient records from MySQL. Check the Next.js server log.";
}

export async function GET(request: NextRequest) {
  const session = getStaffSession(request);
  if (!session) return unauthenticatedResponse();

  const host = process.env.MYSQL_HOST;
  if (!host) {
    return NextResponse.json({ error: "MYSQL_HOST is not set in web/.env.local." }, { status: 503 });
  }

  let connection: mysql.Connection | undefined;
  try {
    connection = await mysql.createConnection({
      host,
      port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER || "root",
      password: process.env.MYSQL_PASSWORD || "",
      database: process.env.MYSQL_DATABASE || "hospital_emergency_management",
    });

    const [summaryRows] = await connection.execute<SummaryDbRow[]>(`
      SELECT
        (SELECT COUNT(*) FROM PATIENT) AS total_patients,
        (SELECT COUNT(*) FROM EMERGENCY_CASE
          WHERE case_status IN ('Open', 'Under Treatment', 'Admitted')) AS active_cases,
        (SELECT COUNT(*) FROM EMERGENCY_CASE
          WHERE triage_level <= 2
            AND case_status IN ('Open', 'Under Treatment', 'Admitted')) AS critical_cases,
        (SELECT COUNT(*) FROM EMERGENCY_CASE WHERE case_status = 'Discharged') AS discharged_cases
    `);
    const [patientRows] = await connection.execute<PatientDbRow[]>(`
      SELECT
        p.patient_id, p.first_name, p.last_name,
        e.case_id, e.case_status, e.triage_level,
        COALESCE(d.dept_name,
          (SELECT td_dept.dept_name FROM TREATMENT t
           JOIN DOCTOR td ON td.doctor_id = t.doctor_id
           JOIN DEPARTMENT td_dept ON td_dept.department_id = td.department_id
           WHERE t.case_id = e.case_id ORDER BY t.start_time DESC LIMIT 1),
          (SELECT od_dept.dept_name FROM TEST_ORDER o
           JOIN DOCTOR od ON od.doctor_id = o.doctor_id
           JOIN DEPARTMENT od_dept ON od_dept.department_id = od.department_id
           WHERE o.case_id = e.case_id ORDER BY o.order_time DESC LIMIT 1),
          'Unassigned ER queue') AS dept_name
      FROM PATIENT p
      LEFT JOIN EMERGENCY_CASE e ON e.patient_id = p.patient_id
      LEFT JOIN HOSPITAL_BED b ON b.bed_id = e.bed_id
      LEFT JOIN DEPARTMENT d ON d.department_id = b.department_id
      WHERE b.department_id = ?
        OR e.bed_id IS NULL
        OR EXISTS (
          SELECT 1 FROM TREATMENT t JOIN DOCTOR td ON td.doctor_id = t.doctor_id
          WHERE t.case_id = e.case_id AND td.department_id = ?
        )
        OR EXISTS (
          SELECT 1 FROM TEST_ORDER o JOIN DOCTOR od ON od.doctor_id = o.doctor_id
          WHERE o.case_id = e.case_id AND od.department_id = ?
        )
      ORDER BY e.arrival_time DESC, p.patient_id DESC
    `, [session.departmentId, session.departmentId, session.departmentId]);

    const summary = summaryRows[0];
    return NextResponse.json({
      source: "live",
      department: session.departmentName,
      summary: {
        totalPatients: Number(summary?.total_patients ?? 0),
        activeCases: Number(summary?.active_cases ?? 0),
        criticalCases: Number(summary?.critical_cases ?? 0),
        dischargedCases: Number(summary?.discharged_cases ?? 0),
      },
      patients: patientRows.map((row) => ({
        patientId: row.patient_id,
        name: `${row.first_name} ${row.last_name}`,
        caseId: row.case_id,
        status: row.case_status || "No emergency case",
        triageLevel: row.triage_level,
        department: row.dept_name || "Unassigned",
      })),
    });
  } catch (error) {
    console.error("Could not load patient records", error);
    return NextResponse.json({ error: databaseError(error) }, { status: 503 });
  } finally {
    if (connection) await connection.end();
  }
}
