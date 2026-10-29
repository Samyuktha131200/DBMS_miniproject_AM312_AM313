import dbModule from "../../../mongodb/lib/db.js";
import repositoryModule from "../../../mongodb/lib/repository.js";

type MongoDb = Awaited<ReturnType<typeof dbModule.getDb>>;
type ObjectId = { toString(): string };

type DemoUser =
  | { role: "doctor"; doctor_id: number }
  | { role: "nurse"; staff_id: number };

type ObservationInput = {
  caseId: number;
  observedAt: string;
  source: "prehospital" | "triage" | "ward";
  vitals: Record<string, number | boolean | { systolic: number; diastolic: number } | string>;
  notes?: string;
};

type NoteInput = {
  caseId: number;
  noteType: "triage" | "assessment" | "progress" | "procedure" | "handover" | "discharge";
  title: string;
  body: string;
  tags?: string[];
};

type IncidentInput = {
  category: "in_hospital";
  incidentType: "patient_fall" | "medication_error" | "equipment_device" | "delay_in_care" | "violence_aggression" | "other";
  caseIds: number[];
  occurredAt: string;
  reportedAt: string;
  location: { description: string };
  severity: "low" | "moderate" | "high" | "critical";
  harmLevel: "none" | "minor" | "moderate" | "severe";
  summary: string;
};

type CaseExists = (caseId: number) => Promise<boolean>;

type MongoRepository = {
  recordObservation(
    db: MongoDb,
    user: DemoUser,
    input: ObservationInput,
    options: { caseExists: CaseExists },
  ): Promise<{ insertedId: ObjectId }>;
  writeNote(
    db: MongoDb,
    user: DemoUser,
    input: NoteInput,
    options: { caseExists: CaseExists },
  ): Promise<{ insertedId: ObjectId }>;
  reportIncident(
    db: MongoDb,
    user: DemoUser,
    input: IncidentInput,
    options: { caseExists: CaseExists },
  ): Promise<{ insertedId: ObjectId; document: { incident_no: string } }>;
  toHttpError(error: unknown): { status: number; body: { message: string } };
};

const getDb = dbModule.getDb;
const repository = repositoryModule as MongoRepository;

export function getMongoDb() {
  return getDb();
}

export function getMongoRepository() {
  return repository;
}

export function getDemoUser(): DemoUser {
  const role = process.env.MONGODB_DEMO_ROLE;
  const id = Number(process.env.MONGODB_DEMO_ID);

  if (!Number.isInteger(id) || id < 1) {
    throw new Error("Set MONGODB_DEMO_ID to an existing doctor_id or staff_id in web/.env.local.");
  }
  if (role === "doctor") return { role, doctor_id: id };
  if (role === "nurse") return { role, staff_id: id };
  throw new Error("Set MONGODB_DEMO_ROLE to doctor or nurse in web/.env.local.");
}
