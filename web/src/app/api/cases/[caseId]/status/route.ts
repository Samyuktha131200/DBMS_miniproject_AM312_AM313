import mysql from "mysql2/promise";
import { NextRequest, NextResponse } from "next/server";
import { getStaffSession, unauthenticatedResponse } from "@/lib/staff-session";

const CASE_STATUSES = ["Open", "Under Treatment", "Admitted", "Discharged", "Closed"] as const;
type CaseStatus = (typeof CASE_STATUSES)[number];

type CaseRow = mysql.RowDataPacket & {
  case_id: number;
  case_status: CaseStatus;
  bed_id: number | null;
  bed_status: string | null;
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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ caseId: string }> },
) {
  const session = getStaffSession(request);
  if (!session) return unauthenticatedResponse();

  const { caseId: rawCaseId } = await params;
  const caseId = /^\d+$/.test(rawCaseId) ? Number(rawCaseId) : Number.NaN;
  if (!Number.isSafeInteger(caseId) || caseId < 1) {
    return NextResponse.json({ error: "Case ID must be a positive integer." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const status = body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>).status
    : undefined;
  if (typeof status !== "string" || !CASE_STATUSES.includes(status as CaseStatus)) {
    return NextResponse.json({ error: `Choose a valid case status: ${CASE_STATUSES.join(", ")}.` }, { status: 400 });
  }

  let connection: mysql.Connection | undefined;
  try {
    connection = await mysql.createConnection(mysqlConfig());
    await connection.beginTransaction();

    const [caseRows] = await connection.execute<CaseRow[]>(
      `SELECT e.case_id, e.case_status, e.bed_id, b.status AS bed_status,
        (b.department_id = ?
          OR EXISTS (
            SELECT 1 FROM TREATMENT t JOIN DOCTOR d ON d.doctor_id = t.doctor_id
            WHERE t.case_id = e.case_id AND d.department_id = ?
          )
          OR EXISTS (
            SELECT 1 FROM TEST_ORDER o JOIN DOCTOR d ON d.doctor_id = o.doctor_id
            WHERE o.case_id = e.case_id AND d.department_id = ?
          )
          OR e.bed_id IS NULL) AS in_department
       FROM EMERGENCY_CASE e
       LEFT JOIN HOSPITAL_BED b ON b.bed_id = e.bed_id
       WHERE e.case_id = ?
       FOR UPDATE`,
      [session.departmentId, session.departmentId, session.departmentId, caseId],
    );
    const currentCase = caseRows[0];
    if (!currentCase || !currentCase.in_department) {
      await connection.rollback();
      return NextResponse.json({ error: "Case not found in your department." }, { status: 404 });
    }

    const [updateResult] = await connection.execute<mysql.ResultSetHeader>(
      "UPDATE EMERGENCY_CASE SET case_status = ? WHERE case_id = ?",
      [status, caseId],
    );
    if (updateResult.affectedRows !== 1 && currentCase.case_status !== status) {
      throw new Error("The case status was not updated.");
    }

    if (currentCase.bed_id !== null) {
      const activeStatuses = ["Open", "Under Treatment", "Admitted"];
      if (activeStatuses.includes(status)) {
        if (currentCase.bed_status === "Maintenance") {
          await connection.rollback();
          return NextResponse.json({ error: "This case's assigned bed is under maintenance." }, { status: 409 });
        }
        const [otherActiveCases] = await connection.execute<mysql.RowDataPacket[]>(
          `SELECT case_id FROM EMERGENCY_CASE
           WHERE bed_id = ? AND case_id <> ?
             AND case_status IN ('Open', 'Under Treatment', 'Admitted')
           LIMIT 1 FOR UPDATE`,
          [currentCase.bed_id, caseId],
        );
        if (otherActiveCases.length) {
          await connection.rollback();
          return NextResponse.json({ error: "The assigned bed is already occupied by another active case." }, { status: 409 });
        }
        await connection.execute(
          "UPDATE HOSPITAL_BED SET status = 'Occupied' WHERE bed_id = ?",
          [currentCase.bed_id],
        );
      } else {
        const [otherActiveCases] = await connection.execute<mysql.RowDataPacket[]>(
          `SELECT case_id FROM EMERGENCY_CASE
           WHERE bed_id = ? AND case_id <> ?
             AND case_status IN ('Open', 'Under Treatment', 'Admitted')
           LIMIT 1 FOR UPDATE`,
          [currentCase.bed_id, caseId],
        );
        if (!otherActiveCases.length && currentCase.bed_status === "Occupied") {
          await connection.execute(
            "UPDATE HOSPITAL_BED SET status = 'Available' WHERE bed_id = ?",
            [currentCase.bed_id],
          );
        }
      }
    }

    await connection.commit();
    return NextResponse.json({ caseId, status });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Could not update emergency case status", error);
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    const message = code === "ER_NO_SUCH_TABLE"
      ? "A required MySQL table is missing. Run 01_schema.sql in MySQL Workbench."
      : "Could not update the case status. Check the MySQL server and logs.";
    return NextResponse.json({ error: message }, { status: 503 });
  } finally {
    if (connection) await connection.end();
  }
}
