import mysql from "mysql2/promise";
import { NextRequest, NextResponse } from "next/server";
import { getDemoUser, getMongoDb, getMongoRepository } from "@/lib/server-databases";

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
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return NextResponse.json({ error: "Request body must be a JSON object." }, { status: 400 });
  }
  const input = value as Record<string, unknown>;
  if (!["observation", "note", "incident"].includes(String(input.kind))) {
    return NextResponse.json({ error: "Choose an observation, clinical note, or incident report." }, { status: 400 });
  }

  try {
    const user = getDemoUser();
    const db = await getMongoDb();
    const repository = getMongoRepository();
    const caseExists = async (caseId: number) => {
      const connection = await mysql.createConnection(mysqlConfig());
      try {
        const [rows] = await connection.execute<mysql.RowDataPacket[]>(
          "SELECT case_id FROM EMERGENCY_CASE WHERE case_id = ?",
          [caseId],
        );
        return rows.length > 0;
      } finally {
        await connection.end();
      }
    };

    if (input.kind === "observation") {
      const result = await repository.recordObservation(db, user, {
        caseId: input.caseId as number,
        observedAt: input.observedAt as string,
        source: input.source as "prehospital" | "triage" | "ward",
        vitals: input.vitals as Record<string, number | boolean | { systolic: number; diastolic: number } | string>,
        notes: input.notes as string | undefined,
      }, { caseExists });
      return NextResponse.json({ id: String(result.insertedId) }, { status: 201 });
    }

    if (input.kind === "note") {
      const result = await repository.writeNote(db, user, {
        caseId: input.caseId as number,
        noteType: input.noteType as "triage" | "assessment" | "progress" | "procedure" | "handover" | "discharge",
        title: input.title as string,
        body: input.body as string,
        tags: typeof input.tags === "string"
          ? input.tags.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean)
          : undefined,
      }, { caseExists });
      return NextResponse.json({ id: String(result.insertedId) }, { status: 201 });
    }

    if (input.kind === "incident") {
      const occurredAt = input.occurredAt as string;
      const result = await repository.reportIncident(db, user, {
        category: "in_hospital",
        incidentType: input.incidentType as "patient_fall" | "medication_error" | "equipment_device" | "delay_in_care" | "violence_aggression" | "other",
        caseIds: [input.caseId as number],
        occurredAt,
        reportedAt: new Date().toISOString(),
        location: { description: input.location as string },
        severity: input.severity as "low" | "moderate" | "high" | "critical",
        harmLevel: input.harmLevel as "none" | "minor" | "moderate" | "severe",
        summary: input.summary as string,
      }, { caseExists });
      return NextResponse.json({
        id: String(result.insertedId),
        incidentNo: result.document.incident_no,
      }, { status: 201 });
    }

    throw new Error("Unsupported MongoDB entry type.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "MongoDB write failed.";
    console.error("MongoDB insert failed", error);
    const { status, body } = getMongoRepository().toHttpError(error);
    return NextResponse.json({ error: status === 500 ? message : body.message }, { status });
  }
}
