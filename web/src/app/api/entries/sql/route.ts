import mysql from "mysql2/promise";
import { NextRequest, NextResponse } from "next/server";

type PatientEntry = {
  firstName: string;
  lastName: string;
  dob: string;
  gender: "M" | "F" | "O";
  bloodGroup?: string;
  phone?: string;
  address?: string;
  arrivalMode: string;
  chiefComplaint: string;
  triageLevel: number;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseEntry(value: unknown): PatientEntry | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  const dob = typeof body.dob === "string" ? new Date(`${body.dob}T00:00:00Z`) : null;

  if (
    !isNonEmptyString(body.firstName) ||
    body.firstName.length > 50 ||
    !isNonEmptyString(body.lastName) ||
    body.lastName.length > 50 ||
    !dob ||
    Number.isNaN(dob.getTime()) ||
    dob.toISOString().slice(0, 10) !== body.dob ||
    typeof body.gender !== "string" ||
    !["M", "F", "O"].includes(body.gender) ||
    !isNonEmptyString(body.arrivalMode) ||
    body.arrivalMode.length > 30 ||
    !isNonEmptyString(body.chiefComplaint) ||
    body.chiefComplaint.length > 255 ||
    !Number.isInteger(body.triageLevel) ||
    Number(body.triageLevel) < 1 ||
    Number(body.triageLevel) > 5
  ) {
    return null;
  }

  return {
    firstName: body.firstName.trim(),
    lastName: body.lastName.trim(),
    dob: body.dob as string,
    gender: body.gender as PatientEntry["gender"],
    bloodGroup: typeof body.bloodGroup === "string" ? body.bloodGroup.trim() : "",
    phone: typeof body.phone === "string" ? body.phone.trim() : "",
    address: typeof body.address === "string" ? body.address.trim() : "",
    arrivalMode: body.arrivalMode.trim(),
    chiefComplaint: body.chiefComplaint.trim(),
    triageLevel: Number(body.triageLevel),
  };
}

function databaseError(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (code === "ECONNREFUSED" || code === "ENOTFOUND") {
    return "Could not reach MySQL. Start the MySQL server and verify MYSQL_HOST and MYSQL_PORT.";
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
  return "Could not save to MySQL. Check the server log for the database error.";
}

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Unauthenticated demo writes are disabled in production." }, { status: 403 });
  }

  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const entry = parseEntry(value);
  if (!entry) {
    return NextResponse.json({ error: "Enter valid patient, arrival, complaint, and triage details." }, { status: 400 });
  }

  const host = process.env.MYSQL_HOST;
  if (!host) {
    return NextResponse.json({ error: "MYSQL_HOST is not set in web/.env.local." }, { status: 503 });
  }

  let connection: mysql.Connection;
  try {
    connection = await mysql.createConnection({
      host,
      port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER || "root",
      password: process.env.MYSQL_PASSWORD || "",
      database: process.env.MYSQL_DATABASE || "hospital_emergency_management",
    });
  } catch (error) {
    console.error("MySQL connection failed while saving an entry", error);
    return NextResponse.json({ error: databaseError(error) }, { status: 503 });
  }

  try {
    await connection.beginTransaction();
    const [patientResult] = await connection.execute<mysql.ResultSetHeader>(
      `INSERT INTO PATIENT
        (first_name, last_name, dob, gender, blood_group, phone, address)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [entry.firstName, entry.lastName, entry.dob, entry.gender, entry.bloodGroup || null, entry.phone || null, entry.address || null],
    );
    const [caseResult] = await connection.execute<mysql.ResultSetHeader>(
      `INSERT INTO EMERGENCY_CASE
        (arrival_mode, chief_complaint, triage_level, case_status, patient_id)
       VALUES (?, ?, ?, 'Open', ?)`,
      [entry.arrivalMode, entry.chiefComplaint, entry.triageLevel, patientResult.insertId],
    );
    await connection.commit();
    return NextResponse.json({
      patientId: patientResult.insertId,
      caseId: caseResult.insertId,
    }, { status: 201 });
  } catch (error) {
    await connection.rollback();
    console.error("MySQL insert failed", error);
    return NextResponse.json({ error: databaseError(error) }, { status: 500 });
  } finally {
    await connection.end();
  }
}
