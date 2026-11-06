import mysql from "mysql2/promise";
import { NextRequest, NextResponse } from "next/server";
import { clearStaffSession, createStaffSession, getStaffSession, setStaffSessionCookie } from "@/lib/staff-session";

type StaffRow = mysql.RowDataPacket & {
  staff_id: number;
  name: string;
  department_id: number;
  dept_name: string;
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

export async function GET(request: NextRequest) {
  try {
    return NextResponse.json({ session: getStaffSession(request) });
  } catch (error) {
    console.error("Could not verify the staff session", error);
    return NextResponse.json({ error: "SESSION_SECRET is missing or invalid in web/.env.local." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Identity-only demo sign-in is disabled in production." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Choose a staff role and enter a valid staff ID." }, { status: 400 });
  }

  const input = body as Record<string, unknown>;
  const role = input.role;
  const staffId = typeof input.staffId === "string" && /^\d+$/.test(input.staffId)
    ? Number(input.staffId)
    : typeof input.staffId === "number" ? input.staffId : Number.NaN;
  if (
    (role !== "doctor" && role !== "nurse") ||
    !Number.isSafeInteger(staffId) ||
    Number(staffId) < 1
  ) {
    return NextResponse.json({ error: "Choose doctor or nurse and enter a positive staff ID." }, { status: 400 });
  }

  let connection: mysql.Connection | undefined;
  try {
    connection = await mysql.createConnection(mysqlConfig());
    const table = role === "doctor" ? "DOCTOR" : "NURSE_STAFF";
    const idColumn = role === "doctor" ? "doctor_id" : "staff_id";
    const [rows] = await connection.execute<StaffRow[]>(
      `SELECT s.${idColumn} AS staff_id, s.name, s.department_id, d.dept_name
       FROM ${table} s JOIN DEPARTMENT d ON d.department_id = s.department_id
       WHERE s.${idColumn} = ?`,
      [staffId],
    );
    const staff = rows[0];
    if (!staff) {
      return NextResponse.json({ error: `No ${role} staff member has ID ${staffId}.` }, { status: 401 });
    }

    const session = createStaffSession({
      role,
      staffId: staff.staff_id,
      name: staff.name,
      departmentId: staff.department_id,
      departmentName: staff.dept_name,
    });
    const result = NextResponse.json({ session });
    setStaffSessionCookie(session, result);
    return result;
  } catch (error) {
    console.error("Staff sign-in failed", error);
    const message = error instanceof Error ? error.message : "Could not sign in.";
    return NextResponse.json({ error: message }, { status: 503 });
  } finally {
    if (connection) await connection.end();
  }
}

export async function DELETE() {
  const response = NextResponse.json({ success: true });
  clearStaffSession(response);
  return response;
}
