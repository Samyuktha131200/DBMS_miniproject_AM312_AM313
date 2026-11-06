import { MongoClient, type Document } from "mongodb";
import mysql from "mysql2/promise";
import { NextRequest, NextResponse } from "next/server";
import { getStaffSession, unauthenticatedResponse } from "@/lib/staff-session";

type SummaryRow = mysql.RowDataPacket & Record<string, number | string>;
type PatientRow = mysql.RowDataPacket & {
  case_id: number;
  first_name: string;
  last_name: string;
  case_status: string;
  triage_level: number;
  dept_name: string | null;
};
type CaseIdRow = mysql.RowDataPacket & { case_id: number };
type NoteDoc = Document & {
  case_id?: number;
  title?: string;
  body?: string;
  created_at?: Date | string;
};
type IncidentDoc = Document & {
  incident_no?: string;
  incident_type?: string;
  severity?: string;
  status?: string;
  summary?: string;
  created_at?: Date | string;
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

function databaseError(database: "MySQL" | "MongoDB", error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (code === "ECONNREFUSED" || code === "ENOTFOUND") {
    return `Cannot reach ${database}. Check that its server is running and verify the host and port in web/.env.local.`;
  }
  if (code === "ER_ACCESS_DENIED_ERROR") {
    return "MySQL rejected the configured user or password. Check MYSQL_USER and MYSQL_PASSWORD.";
  }
  if (code === "ER_BAD_DB_ERROR") {
    return "The MySQL database was not found. Run 01_schema.sql in MySQL Workbench.";
  }
  if (code === "ER_NO_SUCH_TABLE") {
    return "A required MySQL table is missing. Run 01_schema.sql and 02_sample_data.sql in MySQL Workbench.";
  }
  return `${database} is unavailable. Check its server and web/.env.local configuration.`;
}

export async function GET(request: NextRequest) {
  const session = getStaffSession(request);
  if (!session) return unauthenticatedResponse();

  let connection: mysql.Connection | undefined;
  let mongoClient: MongoClient | undefined;
  let currentDatabase: "MySQL" | "MongoDB" = "MySQL";
  try {
    connection = await mysql.createConnection(mysqlConfig());
    const [summaryRows] = await connection.execute<SummaryRow[]>(`
      SELECT
        (SELECT COUNT(*) FROM PATIENT) AS registered_patients,
        (SELECT COUNT(*) FROM EMERGENCY_CASE
          WHERE case_status IN ('Open', 'Under Treatment', 'Admitted')) AS in_hospital,
        (SELECT COUNT(*) FROM EMERGENCY_CASE
          WHERE case_status = 'Discharged') AS discharged_cases,
        (SELECT COUNT(*) FROM EMERGENCY_CASE
          WHERE triage_level <= 2 AND case_status IN ('Open', 'Under Treatment', 'Admitted')) AS critical_cases,
        (SELECT COUNT(*) FROM HOSPITAL_BED WHERE status = 'Available') AS available_beds,
        (SELECT COUNT(*) FROM HOSPITAL_BED WHERE status = 'Occupied') AS occupied_beds,
        (SELECT COUNT(*) FROM TEST_ORDER WHERE result_status IN ('Ordered', 'In Progress')) AS pending_tests,
        (SELECT COUNT(*) FROM BILLING WHERE payment_status = 'Pending') AS pending_bills,
        (SELECT COUNT(*) FROM EMERGENCY_CASE e
          WHERE e.case_status IN ('Open', 'Under Treatment', 'Admitted')
            AND (EXISTS (SELECT 1 FROM HOSPITAL_BED b
                         WHERE b.bed_id = e.bed_id AND b.department_id = ?)
              OR e.bed_id IS NULL
              OR EXISTS (SELECT 1 FROM TREATMENT t JOIN DOCTOR td ON td.doctor_id = t.doctor_id
                         WHERE t.case_id = e.case_id AND td.department_id = ?)
              OR EXISTS (SELECT 1 FROM TEST_ORDER o JOIN DOCTOR od ON od.doctor_id = o.doctor_id
                         WHERE o.case_id = e.case_id AND od.department_id = ?))) AS department_active_cases,
        (SELECT COUNT(*) FROM TEST_ORDER t
          WHERE t.doctor_id = ? AND t.result_status IN ('Ordered', 'In Progress')) AS doctor_pending_tests,
        (SELECT COUNT(*) FROM EMERGENCY_CASE e
          WHERE e.case_status IN ('Open', 'Under Treatment', 'Admitted')
            AND e.triage_level <= 2
            AND (EXISTS (SELECT 1 FROM HOSPITAL_BED b
                         WHERE b.bed_id = e.bed_id AND b.department_id = ?)
              OR e.bed_id IS NULL
              OR EXISTS (SELECT 1 FROM TREATMENT t JOIN DOCTOR td ON td.doctor_id = t.doctor_id
                         WHERE t.case_id = e.case_id AND td.department_id = ?)
              OR EXISTS (SELECT 1 FROM TEST_ORDER o JOIN DOCTOR od ON od.doctor_id = o.doctor_id
                         WHERE o.case_id = e.case_id AND od.department_id = ?))) AS department_critical_cases
    `, [
      session.departmentId, session.departmentId, session.departmentId,
      session.staffId,
      session.departmentId, session.departmentId, session.departmentId,
    ]);

    const [caseIdRows] = await connection.execute<CaseIdRow[]>(`
      SELECT e.case_id
      FROM EMERGENCY_CASE e
      LEFT JOIN HOSPITAL_BED b ON b.bed_id = e.bed_id
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
    `, [session.departmentId, session.departmentId, session.departmentId]);
    const caseIds = caseIdRows.map((row) => row.case_id);
    const [patientRows] = await connection.execute<PatientRow[]>(`
      SELECT e.case_id, p.first_name, p.last_name, e.case_status, e.triage_level,
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
      FROM EMERGENCY_CASE e
      JOIN PATIENT p ON p.patient_id = e.patient_id
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
      ORDER BY CASE WHEN e.case_status IN ('Open', 'Under Treatment', 'Admitted') THEN 0 ELSE 1 END,
        e.triage_level ASC, e.arrival_time DESC
      LIMIT 8
    `, [session.departmentId, session.departmentId, session.departmentId]);
    const summary = summaryRows[0];
    if (!summary) throw new Error("MySQL returned no dashboard summary.");

    const values = Object.fromEntries(
      Object.entries(summary).map(([key, value]) => [key, Number(value)]),
    );

    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) throw new Error("MONGODB_URI is not set in web/.env.local.");
    currentDatabase = "MongoDB";
    mongoClient = new MongoClient(mongoUri);
    await mongoClient.connect();
    const mongoDb = mongoClient.db(process.env.MONGODB_DB || "hospital_emergency_management");
    const observations = mongoDb.collection("observation_logs");
    const notes = mongoDb.collection<NoteDoc>("clinical_notes");
    const incidents = mongoDb.collection<IncidentDoc>("incident_reports");
    const recorder = session.role === "nurse" ? { "recorded_by.staff_id": session.staffId } : { "recorded_by.doctor_id": session.staffId };
    const author = session.role === "nurse" ? { "author.staff_id": session.staffId } : { "author.doctor_id": session.staffId };
    const noteFilter = { case_id: { $in: caseIds } };
    const incidentFilter = { case_ids: { $in: caseIds } };

    const [
      observationCount,
      staffObservationCount,
      noteCount,
      staffNoteCount,
      incidentCount,
      openIncidentCount,
      noteDocs,
      incidentDocs,
    ] = await Promise.all([
      observations.countDocuments(noteFilter),
      observations.countDocuments({ ...noteFilter, ...recorder }),
      notes.countDocuments(noteFilter),
      notes.countDocuments({ ...noteFilter, ...author }),
      incidents.countDocuments(incidentFilter),
      incidents.countDocuments({ ...incidentFilter, status: { $nin: ["closed", "resolved"] } }),
      notes.find(noteFilter).sort({ created_at: -1 }).limit(5).toArray(),
      incidents.find(incidentFilter).sort({ created_at: -1 }).limit(5).toArray(),
    ]);

    const timestamp = new Date().toISOString();
    return NextResponse.json({
      source: "live",
      updatedAt: timestamp,
      staff: {
        role: session.role,
        name: session.name,
        department: session.departmentName,
      },
      summary: {
        registeredPatients: values.registered_patients,
        inHospital: values.in_hospital,
        dischargedCases: values.discharged_cases,
        criticalCases: values.critical_cases,
        availableBeds: values.available_beds,
        occupiedBeds: values.occupied_beds,
        pendingTests: values.pending_tests,
        pendingBills: values.pending_bills,
        departmentActiveCases: values.department_active_cases,
        departmentCriticalCases: values.department_critical_cases,
        doctorPendingTests: values.doctor_pending_tests,
        observations: observationCount,
        staffObservations: staffObservationCount,
        clinicalNotes: noteCount,
        staffNotes: staffNoteCount,
        incidents: incidentCount,
        openIncidents: openIncidentCount,
      },
      patients: patientRows.map((row) => ({
        id: `CASE-${String(row.case_id).padStart(3, "0")}`,
        name: `${row.first_name} ${row.last_name}`,
        department: row.dept_name || "Unassigned",
        status: row.case_status,
        triageLevel: row.triage_level,
      })),
      incidents: incidentDocs.map((doc) => ({
        no: doc.incident_no || "Incident",
        type: String(doc.incident_type || "Incident").replaceAll("_", " "),
        severity: doc.severity || "Unspecified",
        status: doc.status || "Open",
      })),
      notes: noteDocs.map((doc) => ({
        title: doc.title || "Clinical note",
        patient: doc.case_id ? `Case ${doc.case_id}` : "Clinical record",
        text: doc.body || "MongoDB clinical note",
      })),
      alerts: [
        `${values.department_critical_cases} critical/high-risk cases in ${session.departmentName}`,
        session.role === "doctor"
          ? `${values.doctor_pending_tests} of your test orders are awaiting results`
          : `${staffObservationCount} observations recorded by you`,
        `${openIncidentCount} MongoDB incident reports remain open`,
      ],
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not load live dashboard data", error);
    return NextResponse.json({ error: databaseError(currentDatabase, error) }, { status: 503 });
  } finally {
    if (connection) await connection.end();
    if (mongoClient) await mongoClient.close();
  }
}
