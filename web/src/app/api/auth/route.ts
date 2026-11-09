import mysql from "mysql2/promise";
import { NextRequest, NextResponse } from "next/server";
import { DUMMY_HASH, verifyPassword } from "@/lib/password";
import { clearStaffSession, createStaffSession, getStaffSession, setStaffSessionCookie } from "@/lib/staff-session";

type AccountRow = mysql.RowDataPacket & {
  user_id: number;
  password_hash: string;
  role: string;
  is_active: number;
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

const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;
const failures = new Map<string, { count: number; until: number }>();

function isLocked(username: string) {
  const entry = failures.get(username);
  if (!entry) return false;
  if (entry.until && entry.until > Date.now()) return true;
  if (entry.until && entry.until <= Date.now()) failures.delete(username);
  return false;
}

function recordFailure(username: string) {
  const entry = failures.get(username) ?? { count: 0, until: 0 };
  entry.count += 1;
  if (entry.count >= MAX_FAILURES) entry.until = Date.now() + LOCK_MS;
  failures.set(username, entry);
}

const INVALID_LOGIN = "Incorrect username or password.";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Enter your username and password." }, { status: 400 });
  }

  const input = body as Record<string, unknown>;
  const username = typeof input.username === "string" ? input.username.trim().toLowerCase() : "";
  const password = typeof input.password === "string" ? input.password : "";
  if (!/^[a-z0-9._-]{3,50}$/.test(username) || password.length < 1 || password.length > 200) {
    return NextResponse.json({ error: "Enter your username and password." }, { status: 400 });
  }
  if (isLocked(username)) {
    return NextResponse.json({ error: "Too many failed attempts. Try again in 15 minutes." }, { status: 429 });
  }

  let connection: mysql.Connection | undefined;
  try {
    connection = await mysql.createConnection(mysqlConfig());
    const [rows] = await connection.execute<AccountRow[]>(
      `SELECT a.user_id, a.password_hash, a.role, a.is_active,
              COALESCE(a.doctor_id, a.staff_id) AS staff_id,
              COALESCE(d.name, n.name) AS name,
              dep.department_id, dep.dept_name
       FROM USER_ACCOUNT a
       LEFT JOIN DOCTOR d ON d.doctor_id = a.doctor_id
       LEFT JOIN NURSE_STAFF n ON n.staff_id = a.staff_id
       JOIN DEPARTMENT dep ON dep.department_id = COALESCE(d.department_id, n.department_id)
       WHERE a.username = ?`,
      [username],
    );
    const account = rows[0];
    const passwordOk = await verifyPassword(password, account?.password_hash ?? DUMMY_HASH);
    if (!account || !passwordOk || !account.is_active || (account.role !== "doctor" && account.role !== "nurse")) {
      recordFailure(username);
      return NextResponse.json({ error: INVALID_LOGIN }, { status: 401 });
    }

    failures.delete(username);
    await connection.execute("UPDATE USER_ACCOUNT SET last_login = NOW() WHERE user_id = ?", [account.user_id]);
    const session = createStaffSession({
      role: account.role as "doctor" | "nurse",
      staffId: account.staff_id,
      name: account.name,
      departmentId: account.department_id,
      departmentName: account.dept_name,
    });
    const result = NextResponse.json({ session });
    setStaffSessionCookie(session, result);
    return result;
  } catch (error) {
    console.error("Staff sign-in failed", error);
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    const message = code === "ER_NO_SUCH_TABLE"
      ? "The USER_ACCOUNT table is missing. Run 01_schema.sql and 02_sample_data.sql in MySQL Workbench."
      : "Could not sign in. Check that MySQL is running and web/.env.local is set up.";
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
