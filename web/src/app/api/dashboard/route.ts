import { MongoClient, type Document } from "mongodb";
import mysql from "mysql2/promise";
import { NextRequest, NextResponse } from "next/server";

type Tone = "primary" | "danger" | "success" | "neutral";

type PatientRow = {
  id: string;
  name: string;
  age: number;
  dept: string;
  status: string;
  color: "amber" | "red" | "blue" | "purple";
};

type IncidentRow = {
  no: string;
  type: string;
  severity: string;
  status: string;
};

type NoteRow = {
  title: string;
  patient: string;
  text: string;
};

type CountRow = { total: number } & mysql.RowDataPacket;
type PatientDbRow = {
  case_id: number;
  first_name: string;
  last_name: string;
  dob: Date | string;
  case_status: string;
  triage_level: number;
  dept_name: string | null;
} & mysql.RowDataPacket;
type IncidentDoc = Document & {
  incident_no?: string;
  incident_type?: string;
  severity?: string;
  status?: string;
  title?: string;
  created_at?: Date;
};
type ClinicalNoteDoc = Document & {
  case_id?: number;
  title?: string;
  body?: string;
  note?: string;
  text?: string;
  content?: string;
  created_at?: Date;
};

type DashboardData = {
  source: "live" | "mock";
  stats: Array<{ label: string; value: string; delta: string; tone: Tone }>;
  patients: PatientRow[];
  alerts: string[];
  incidents: IncidentRow[];
  notes: NoteRow[];
  warning?: string;
};

const mockData: DashboardData = {
  source: "mock",
  stats: [
    { label: "Patients in ED", value: "128", delta: "+12%", tone: "primary" },
    { label: "Critical cases", value: "07", delta: "2 high risk", tone: "danger" },
    { label: "Avg. wait time", value: "16 min", delta: "-3 min", tone: "success" },
    { label: "Discharged today", value: "41", delta: "+9", tone: "neutral" },
  ],
  patients: [
    { id: "CASE-008", name: "Asha Menon", age: 34, dept: "Cardiology", status: "Monitoring", color: "amber" },
    { id: "CASE-003", name: "Rohan Das", age: 52, dept: "Trauma", status: "Critical", color: "red" },
    { id: "CASE-005", name: "Vikram Nair", age: 46, dept: "Respiratory", status: "Observation", color: "blue" },
    { id: "CASE-009", name: "Anjali Rao", age: 28, dept: "Neurology", status: "Awaiting scan", color: "purple" },
  ],
  alerts: [
    "NEWS2 deterioration detected in Case 008",
    "Ambulance response breach: INC-2026-0005",
    "Two CT slots blocked for delayed review",
    "Pharmacy request pending for case 003",
  ],
  incidents: [
    { no: "INC-2026-0007", type: "Delay in care", severity: "Moderate", status: "Open" },
    { no: "INC-2026-0005", type: "Respiratory escalation", severity: "Critical", status: "Under review" },
    { no: "INC-2026-0002", type: "Head injury transfer", severity: "High", status: "Closed" },
  ],
  notes: [
    { title: "Progress note", patient: "Case 005", text: "Chest pain subsiding; repeat vitals in 30 mins." },
    { title: "Consult update", patient: "Case 008", text: "Oxygen requirement increased, escalate to ICU review." },
    { title: "Discharge plan", patient: "Case 009", text: "Neurology follow-up arranged for morning rounds." },
  ],
};

function makeStatusColor(status: string): PatientRow["color"] {
  if (status.toLowerCase().includes("critical")) return "red";
  if (status.toLowerCase().includes("monitor") || status.toLowerCase().includes("observation")) return "amber";
  if (status.toLowerCase().includes("scan")) return "purple";
  return "blue";
};

function explainDatabaseError(database: "MySQL" | "MongoDB", error: unknown) {
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

async function getLiveDashboard(): Promise<DashboardData> {
  const mysqlHost = process.env.MYSQL_HOST;
  const mysqlDatabase = process.env.MYSQL_DATABASE || "hospital_emergency_management";

  if (!mysqlHost) {
    return { ...mockData, source: "mock", warning: "MYSQL_HOST is not set in web/.env.local. Showing mock data." };
  }

  let connection: mysql.Connection | undefined;
  try {
    connection = await mysql.createConnection({
      host: mysqlHost,
      port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER || "root",
      password: process.env.MYSQL_PASSWORD || "",
      database: mysqlDatabase,
    });
    const [patientCount] = await connection.execute<CountRow[]>("SELECT COUNT(*) AS total FROM PATIENT");
    const [caseRows] = await connection.execute<CountRow[]>("SELECT COUNT(*) AS total FROM EMERGENCY_CASE");
    const [criticalRows] = await connection.execute<CountRow[]>("SELECT COUNT(*) AS total FROM EMERGENCY_CASE WHERE triage_level <= 2 AND case_status IN ('Open', 'Under Treatment', 'Admitted')");
    const [openRows] = await connection.execute<CountRow[]>("SELECT COUNT(*) AS total FROM EMERGENCY_CASE WHERE case_status IN ('Open', 'Under Treatment', 'Admitted')");
    const [dischargedRows] = await connection.execute<CountRow[]>("SELECT COUNT(*) AS total FROM EMERGENCY_CASE WHERE case_status = 'Discharged' AND DATE(arrival_time) = CURRENT_DATE()");

    const [patientRows] = await connection.execute<PatientDbRow[]>(`SELECT e.case_id, p.first_name, p.last_name, p.dob,
      e.case_status, e.triage_level, d.dept_name
      FROM EMERGENCY_CASE e
      JOIN PATIENT p ON p.patient_id = e.patient_id
      LEFT JOIN HOSPITAL_BED b ON b.bed_id = e.bed_id
      LEFT JOIN DEPARTMENT d ON d.department_id = b.department_id
      ORDER BY e.arrival_time DESC
      LIMIT 4`);

    const livePatients: PatientRow[] = patientRows.map((row) => {
      const birthDate = row.dob instanceof Date ? row.dob : new Date(row.dob);
      return {
        id: `CASE-${String(row.case_id).padStart(3, "0")}`,
        name: `${row.first_name} ${row.last_name}`,
        age: Math.max(0, new Date().getFullYear() - birthDate.getFullYear()),
        dept: row.dept_name || "General",
        status: row.case_status || "Open",
        color: makeStatusColor(row.case_status || "Open"),
      };
    });

    const patientTotal = Number(patientCount[0]?.total || 0);
    const caseTotal = Number(caseRows[0]?.total || 0);
    const criticalTotal = Number(criticalRows[0]?.total || 0);
    const openTotal = Number(openRows[0]?.total || 0);
    const dischargedTotal = Number(dischargedRows[0]?.total || 0);

    const liveStats = [
      { label: "Registered patients", value: String(patientTotal), delta: `${caseTotal} emergency cases`, tone: "primary" as const },
      { label: "Critical cases", value: String(criticalTotal), delta: "Current queue", tone: "danger" as const },
      { label: "Avg. wait time", value: "16 min", delta: "-3 min", tone: "success" as const },
      { label: "Discharged today", value: String(dischargedTotal), delta: `${openTotal} active cases`, tone: "neutral" as const },
    ];

    const liveAlerts = [
      "Live MySQL data loaded successfully",
      `${caseTotal} total emergency cases in the system`,
      `${openTotal} active treatment cases currently visible`,
    ];

    const mongoUri = process.env.MONGODB_URI;
    const mongoDbName = process.env.MONGODB_DB || "hospital_emergency_management";
    let mongoAlerts: string[] = [];
    let liveIncidents: IncidentRow[] = [];
    let mongoNotes: NoteRow[] = [];
    let warning: string | undefined;
    if (mongoUri) {
      const client = new MongoClient(mongoUri);
      try {
        await client.connect();
        const db = client.db(mongoDbName);
        const incidentDocs = await db.collection<IncidentDoc>("incident_reports").find({}).sort({ created_at: -1 }).limit(3).toArray();
        const noteDocs = await db.collection<ClinicalNoteDoc>("clinical_notes").find({}).sort({ created_at: -1 }).limit(3).toArray();

        if (incidentDocs.length) {
          mongoAlerts = incidentDocs.map((doc) => doc.title || `Incident: ${doc.incident_no || "Live"}`);
          liveIncidents = incidentDocs.map((doc) => ({
            no: doc.incident_no || "Incident",
            type: String(doc.incident_type || "Incident").replaceAll("_", " "),
            severity: doc.severity || "Unspecified",
            status: doc.status || "Open",
          }));
        }

        if (noteDocs.length) {
          mongoNotes = noteDocs.map((doc) => ({
            title: doc.title || "Clinical note",
            patient: doc.case_id ? `Case ${doc.case_id}` : "Live feed",
            text: doc.body || doc.note || doc.text || doc.content || "MongoDB note received.",
          }));
        }
      } catch (error) {
        console.error("Could not load MongoDB dashboard data", error);
        warning = explainDatabaseError("MongoDB", error);
      } finally {
        await client.close();
      }
    } else {
      warning = "MongoDB is not configured. Set MONGODB_URI in web/.env.local.";
    }

    return {
      source: "live",
      stats: liveStats,
      patients: livePatients,
      alerts: mongoAlerts.length ? mongoAlerts : liveAlerts,
      incidents: liveIncidents,
      notes: mongoNotes,
      warning,
    };
  } catch (error) {
    console.error("Could not load live dashboard data", error);
    return { ...mockData, source: "mock", warning: `${explainDatabaseError("MySQL", error)} Showing mock data until MySQL is available.` };
  } finally {
    if (connection) await connection.end();
  }
}

export async function GET(request: NextRequest) {
  const source = request.nextUrl.searchParams.get("source") || "live";

  if (source === "mock") {
    return NextResponse.json({ ...mockData, source: "mock" });
  }

  const dashboard = await getLiveDashboard();
  return NextResponse.json(dashboard);
}
