import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";

export type StaffSession = {
  role: "doctor" | "nurse";
  staffId: number;
  name: string;
  departmentId: number;
  departmentName: string;
  expiresAt: number;
};

const COOKIE_NAME = "er_staff_session";
const SESSION_DURATION_SECONDS = 60 * 60 * 8;

function sessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("Set SESSION_SECRET to a random value of at least 32 characters in web/.env.local.");
  }
  return secret;
}

function signature(payload: string) {
  return createHmac("sha256", sessionSecret()).update(payload).digest();
}

export function createStaffSession(staff: Omit<StaffSession, "expiresAt">): StaffSession {
  return { ...staff, expiresAt: Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS };
}

export function setStaffSessionCookie(session: StaffSession, response: NextResponse) {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  const token = `${payload}.${signature(payload).toString("base64url")}`;

  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DURATION_SECONDS,
  });
}

export function clearStaffSession(response: NextResponse) {
  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export function getStaffSession(request: NextRequest): StaffSession | null {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const [payload, encodedSignature, ...extra] = token.split(".");
  if (!payload || !encodedSignature || extra.length) return null;

  let actualSignature: Buffer;
  try {
    actualSignature = Buffer.from(encodedSignature, "base64url");
  } catch {
    return null;
  }
  const expectedSignature = signature(payload);
  if (
    actualSignature.length !== expectedSignature.length ||
    !timingSafeEqual(actualSignature, expectedSignature)
  ) return null;

  try {
    const value: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!value || typeof value !== "object") return null;
    const session = value as Partial<StaffSession>;
    if (
      (session.role !== "doctor" && session.role !== "nurse") ||
      !Number.isInteger(session.staffId) || Number(session.staffId) < 1 ||
      !Number.isInteger(session.departmentId) || Number(session.departmentId) < 1 ||
      typeof session.name !== "string" ||
      typeof session.departmentName !== "string" ||
      !Number.isInteger(session.expiresAt) ||
      Number(session.expiresAt) <= Math.floor(Date.now() / 1000)
    ) return null;
    return session as StaffSession;
  } catch {
    return null;
  }
}

export function unauthenticatedResponse() {
  return Response.json({ error: "Sign in with your username and password to continue." }, { status: 401 });
}
