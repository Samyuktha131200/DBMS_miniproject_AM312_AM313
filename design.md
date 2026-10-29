# Next.js UI & System Design: Hospital Emergency Room Management System

This design document outlines the end-to-end architecture, information architecture, page layouts, component hierarchy, and design system for the **Hospital Emergency Room Management System (HERMS)**. It is specifically tailored to seamlessly bridge the **MySQL relational core** (`01_schema.sql` through `04_queries.sql`) with the **MongoDB document layer** (`mongodb/lib/repository.js`).

---

## 1. Design Vision & UX Principles

### 1.1 Aesthetic & Operational Persona
- **Clinical Command Center Vibe:** High-contrast, clean typography, dark/light clinical themes with clear color-coded emergency triage levels (Manchester Triage System / ESI 1–5).
- **High-Tempo Ergonomics:** Emergency room staff operate under intense cognitive load. The UI prioritizes:
  - **Zero-clutter high-signal density:** Crucial metrics (NEWS2 early warning scores, red flags, bed availability) are immediately visible.
  - **Single-Click Actions:** Fast triage registration, quick vitals logging, one-click bed allocations.
  - **Fail-Safe Feedback:** Explicit validation matching MySQL triggers (e.g., negative stock / negative billing guards) and MongoDB `$jsonSchema` constraints.
- **Academic Demo-Ready Role Switcher:** A prominent persistent top-bar switcher enabling instructors or evaluators to toggle between **Doctor**, **Nurse/Staff**, and **Admin** personas on the fly.

---

## 2. Technology Stack & Integration Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Next.js App Router (v15+)                       │
│                     React 19 Server & Client Components                │
│                         Vanilla CSS + CSS Modules                      │
└───────────────────▲────────────────────────────────▲───────────────────┘
                    │                                │
                    ▼                                ▼
       ┌────────────────────────┐       ┌────────────────────────┐
       │   MySQL Route Handlers │       │  MongoDB Route Handlers │
       │  (mysql2 / Server SDK) │       │ (mongodb/lib/repo.js)  │
       └────────────┬───────────┘       └────────────┬───────────┘
                    │                                │
                    ▼                                ▼
       ┌────────────────────────┐       ┌────────────────────────┐
       │      MySQL 8.0+        │       │      MongoDB 6.0+      │
       │  12 Relational Tables  │       │ 3 Document Collections │
       │  Views, Procs, Triggers│       │ Pipelines, Text, Geo   │
       └────────────────────────┘       └────────────────────────┘
```

- **Framework:** Next.js (App Router, React 19, TypeScript).
- **Styling:** **Vanilla CSS with CSS Modules** and CSS custom properties (Design Tokens). No heavy third-party CSS utility bloat; clean, responsive, and lightweight.
- **Data Access:**
  - **MySQL Layer:** Direct parameterized queries / stored procedure calls using `mysql2/promise` (executing `GetEmergencyCaseDetails`, `GetPendingBills`, views, transactions).
  - **MongoDB Layer:** Direct consumption of the existing `mongodb/lib/repository.js` through Next.js Route Handlers (`runtime = 'nodejs'`), ensuring identical role verification, audit stamping, and schema validation.
- **Role-Based Session Simulator:** Built-in session provider referencing sample staff:
  - `Dr. Amit Rao` (`doctor`, `doctor_id: 1`, Emergency Medicine)
  - `Dr. Kavya Shetty` (`doctor`, `doctor_id: 2`, Cardiology)
  - `Lakshmi Rao` (`nurse`, `staff_id: 1`, Head Nurse)
  - `Quality & Safety Admin` (`admin`, Hospital Operations)

---

## 3. Information Architecture & Navigation Structure

```
HERMS Application Shell
├── 🔴 Top Navigation Bar (Active Triage Alert Banner, Quick Search, User/Role Switcher)
├── 📂 Sidebar Navigation
│   ├── 📊 ED Command Center (Dashboard & Real-time Triage)      → /dashboard
│   ├── 🚨 Emergency Triage & Intake (New Case / Fast Track)     → /triage
│   ├── 📋 Emergency Cases (All active & historical cases)       → /cases
│   │   └── 🩺 Case 360° Detail View (Vitals, Notes, Tests)     → /cases/[caseId]
│   ├── 🛏️ Bed & Ward Management (Occupancy, Department Grid)    → /beds
│   ├── 🚑 Fleet & Incident Reports (Pre-hospital & In-hospital) → /incidents
│   │   ├── Active Incident Queue & Geo Map                      → /incidents
│   │   └── File New Incident (Ambulance / Safety)               → /incidents/new
│   ├── 💊 Pharmacy & Medicine Stock                             → /pharmacy
│   ├── 🔬 Diagnostic Test Catalog & Orders                     → /diagnostics
│   ├── 💳 Billing & Cashier Desk (Pending Bills & Payments)    → /billing
│   └── 📈 Clinical & Operational Analytics (Aggregations)       → /analytics
```

---

## 4. Screen-by-Screen UI Module Designs

### Module 1: The ED Real-Time Command Center (`/dashboard`)

**Objective:** Give the charge nurse, attending physician, and ER director an immediate pulse of the entire emergency department.

```
+-----------------------------------------------------------------------------------------------+
| HERMS  [Emergency Room Command Center]       [Quick Case Search #...]    [Role: Dr. Amit Rao ▾]|
+-----------------------------------------------------------------------------------------------+
| [Stat: 14 Active Cases]  [Stat: 4 Critical (L1-2)]  [Stat: 8/12 Beds Free]  [Stat: 2 Ambs On Call] |
+-----------------------------------------------------------------------------------------------+
| ⚠️ RED FLAGS BANNER: Case #3 (SPO2: 88%, Resp: 32) | Case #5 (Systolic BP: 210 mmHg) [Dismiss]   |
+-----------------------------------------------------------------------------------------------+
| LIVE TRIAGE QUEUE (Manchester/ESI Levels)         | BED & DEPT CAPACITY (MySQL View)          |
| +----+-----------------+----+--------+----------+ | - Ground Fl - Emergency: [■■■■□□] 66%     |
| | #  | Patient Name    | Lvl| Status | WaitTime | | - 1st Fl - Cardiology:    [■■□□□□] 33%     |
| +----+-----------------+----+--------+----------+ | - 1st Fl - Neurology:     [■■■■■■] 100% ⚠️ |
| | 01 | Arjun Rao       | L1 | Open   | 4m ago   | | - 2nd Fl - Orthopedics:   [■□□□□□] 20%     |
| | 05 | Vikram Singh    | L2 | Trtmnt | 18m ago  | +-----------------------------------------+
| | 03 | Rahul Kumar     | L3 | Admitt | 35m ago  | ACTIVE AMBULANCE FLEET (KA01AB1001)       |
| +----+-----------------+----+--------+----------+ | - KA01AB1001 (Manoj Kumar): On Call       |
|                                                   | - KA01AB1002 (Suresh Gowda): Available    |
+---------------------------------------------------+-------------------------------------------+
| NEWS2 EARLY WARNING BOARD (MongoDB Pipeline Aggregation)                                      |
| [Filter: All Wards ▾] [Risk: High (Score ≥7), Medium (Score 5-6), Low (Score 0-4)]            |
| Case ID | Patient Name | Pulse | Resp | SpO2 | BP     | ACVPU | NEWS2 Score | Clinical Trend  |
| #1      | Arjun Rao    | 125   | 28   | 91%  | 90/60  | V     | 11 [CRIT]   | ↗ Deteriorating |
| #2      | Priya Sharma | 78    | 16   | 98%  | 120/80 | A     | 0  [NORMAL] | → Stable        |
+-----------------------------------------------------------------------------------------------+
```

**Key Features:**
- **Dynamic NEWS2 Matrix:** Directly renders data from MongoDB's `news2Board` aggregation pipeline.
- **Red Flags Watchlist:** Calls `listRedFlags(db, user)` to spotlight critical physiological deviations.
- **Live Bed Availability:** Consumes MySQL view `available_hospital_beds`.

---

### Module 2: Emergency Patient Intake & Triage (`/triage`)

**Objective:** Rapid patient registration or lookup for incoming emergencies (walk-in or ambulance transport).

- **Patient Identification:** Auto-complete search against `PATIENT` (searches by phone or `last_name, first_name` via `idx_patient_name`). Inline "Quick Register" modal for new emergency walk-ins.
- **Arrival Mode Toggle:**
  - *Walk-In:* Bed assignment immediately optional.
  - *Ambulance:* Dropdown selector populated with available ambulances (`AMBULANCE WHERE status = 'On Call' OR 'Available'`). Automatically associates `ambulance_id`.
- **Triage Level Selector (Interactive Color Strip):**
  - **Level 1 (Red / Immediate - Resuscitation):** Immediate physician alert, bypasses waiting queue.
  - **Level 2 (Orange / Very Urgent):** High priority, max 10 min target.
  - **Level 3 (Yellow / Urgent):** Standard ER bed allocation.
  - **Level 4 (Green / Standard):** Minor injuries/illness.
  - **Level 5 (Blue / Non-urgent):** Fast-track or outpatient redirection.
- **Initial Observation Capture:** Embedded initial vitals panel that simultaneously writes to `EMERGENCY_CASE` (MySQL) and `observation_logs` (source: `'triage'`) in MongoDB.

---

### Module 3: Case 360° Comprehensive File (`/cases/[caseId]`)

**Objective:** The primary clinical workspace for doctors and nurses. Aggregates MySQL relational records and MongoDB clinical logs in one unified tabbed layout.

```
+-----------------------------------------------------------------------------------------------+
| < Back to Cases   | Case #001: Arjun Rao (26y / M / O+) | Triage: Level 1 (CRITICAL) | Open   |
| Bed: ED Bed #1 (Ground Floor) | Transported By: KA01AB1001 (Ambulance #1)                     |
+-----------------------------------------------------------------------------------------------+
| [Tab 1: Overview] [Tab 2: Vitals & NEWS2] [Tab 3: Clinical Notes] [Tab 4: Rx & Tests] [Tab 5: Timeline] |
+-----------------------------------------------------------------------------------------------+
| TAB 2: VITALS & OBSERVATIONS LOG                                                              |
| [+ Record New Reading Button]                                                                 |
|                                                                                               |
| Real-time Sparklines:                                                                         |
| Heart Rate: [ 120 --- 125 --- 118 --- 110 bpm ]  (Norm: 60-100)                               |
| Blood Pressure: [ 90/60 --- 95/62 --- 110/70 mmHg ]                                           |
| SpO2: [ 91% --- 92% --- 96% (Supp O2: Yes) ]                                                  |
|                                                                                               |
| Recorded Readings (MongoDB `observation_logs`):                                               |
| Timestamp   | Source   | HR  | RR | SpO2 | O2? | BP     | Temp  | Consciousness | Logged By    |
| 10:15 AM    | Ward     | 110 | 20 | 96%  | Yes | 110/70 | 37.8C | Alert         | Nurse Megha  |
| 09:40 AM    | Triage   | 125 | 28 | 91%  | No  | 90/60  | 38.2C | Voice (V)     | Dr. Amit Rao |
+-----------------------------------------------------------------------------------------------+
| TAB 3: CLINICAL NOTES (SOAP Structure & Amendment Log)                                        |
| [New Note: Draft ▾] [Note Type: Assessment ▾]                                                 |
| Title: "Initial Emergency Evaluation - Acute Dyspnea"                                         |
| Sections:                                                                                     |
|   - Subjective: Patient brought in gasping for breath, acute onset 2h prior to arrival.       |
|   - Objective: Wheezing bilateral, SpO2 91% on room air, tachycardia 125 bpm.                |
|   - Assessment: Acute Severe Asthma exacerbation with mild respiratory fatigue.               |
|   - Plan: Nebulized Salbutamol + Ipratropium, IV Hydrocortisone, supplemental O2 at 4L/min.  |
| Status: [SIGNED by Dr. Amit Rao at 09:48 AM]                                                  |
| History: Amended at 10:30 AM ("Added chest X-ray order confirmation")                         |
+-----------------------------------------------------------------------------------------------+
| TAB 4: ORDERS & TREATMENTS (MySQL)                                                            |
| Prescriptions Issued:                                                                         |
| - Salbutamol 5mg Nebulizer (Frequency: Stat + 20min) - Status: Active                         |
| - Hydrocortisone 100mg IV (Frequency: Stat) - Status: Administered                            |
| Diagnostic Tests Ordered:                                                                     |
| - Chest X-Ray PA View ($45.00) - Status: [Completed] Value: "Hyperinflation, no pneumothorax"|
| - Arterial Blood Gas ($35.00)  - Status: [In Progress]                                        |
+-----------------------------------------------------------------------------------------------+
```

**Clinical Nuances Reflected:**
- **SOAP Framework:** Subjective, Objective, Assessment, Plan structured form matching MongoDB `clinical_notes.sections`.
- **Note Lifecycle:** `Draft` → `Signed` (locked) → `Amended` (appends to `amendments[]` array, restricted to doctors as per RBAC).
- **Full Case Timeline:** Executes MongoDB's `$unionWith` aggregation (`caseTimeline`), displaying admission events, triage notes, vital checks, test orders, and incident alerts in a singular interactive vertical timeline.

---

### Module 4: Incident & Safety Management (`/incidents`)

**Objective:** Manage prehospital ambulance incidents (road collisions, cardiac arrests on call) and in-hospital safety incidents (needle-stick injuries, medication errors, patient falls).

- **Geospatial Hotspot Map:** Map visualization (using Leaflet or SVG radar) plotting prehospital incidents using MongoDB `2dsphere` coordinates and the `$geoNear` aggregation.
- **Workflow State Machine:**
  - `Open` → `Under Review` (assigned reviewer and notes) → `Closed` (actions taken recorded).
- **Atomic Incident Counter:** Display and generate sequential identifiers formatted as `INC-2026-0001` using the MongoDB `counters` collection.
- **Advanced Feature Modal: "Close Incident With Patient Note":**
  - Calls `closeIncidentWithNote(db, user, ...)` which executes a **MongoDB Multi-Document ACID Transaction** ensuring the incident is closed AND a signed clinical note is saved simultaneously.
- **Purge Closed Incidents (Admin Only):**
  - Admin view with retention policy compliance checker (enforces 365-day retention rule before purge).

---

### Module 5: Bed Management & Resource Allocation (`/beds`)

**Objective:** Prevent ER bottlenecks and manage departmental bed states.

- **Visual Ward Map:**
  - Department filter (Emergency Medicine, Cardiology, Neurology, Orthopedics, General Medicine).
  - Cards indicating Bed ID, Ward Type (ICU, Trauma, General, Step-down), Status (`Available`, `Occupied`, `Maintenance`).
- **Interactive Actions:**
  - One-click bed allocation directly from active cases.
  - Quick bed status transfer (`Occupied` → `Maintenance/Cleaning` → `Available`).
- **Doctor & Staff Shift Roster:**
  - Displays doctor status (`Available`, `Busy`, `Unavailable`).
  - Guards against invalid doctor assignments (preventing MySQL trigger violations).

---

### Module 6: Pharmacy, Tests & Inventory (`/pharmacy` & `/diagnostics`)

**Objective:** Manage medicine supplies and lab orders.

- **Low Stock Radar:** Highlights any medicine where `stock_quantity < 60` with a warning badge (based on SQL Query 15).
- **Valuation Dashboard:** Displays real-time total inventory valuation using the `medicine_stock_summary` view.
- **Stock Guard Triggers:** Form validation prevents any input with negative inventory or prices, echoing the SQL triggers `prevent_negative_medicine_stock_insert` and `prevent_negative_medicine_stock_update`.
- **Diagnostic Orders Board:** Tracks lab test orders (`Ordered` → `In Progress` → `Completed`) with inline result entry.

---

### Module 7: Billing & Cashier Desk (`/billing`)

**Objective:** Accurate emergency billing, invoice tracking, and payment processing.

- **Pending Bills Ledger:** Executes procedure `CALL GetPendingBills()` to display outstanding balances sorted by arrival.
- **Case Bill Generator:** Automatically tallies:
  - Base Emergency Room admission charge.
  - Total diagnostic tests ordered (from `TEST_ORDER` + `DIAGNOSTIC_TEST`).
  - Prescriptions dispensed (from `PRESCRIPTION` + `MEDICINE`).
- **Payment Gateway Simulator:** Supports Cash, Card, Insurance (`payment_status: Paid / Partially Paid`).
- **Trigger Integrity:** Validates that `total_amount >= 0` to prevent triggering `prevent_negative_billing_total`.

---

### Module 8: Clinical & Operational Analytics (`/analytics`)

**Objective:** Executive dashboards combining MySQL relational metrics and MongoDB analytics.

1. **Ambulance Response Times:** MongoDB aggregation calculating average dispatch, arrival, and hospital transit minutes vs. target benchmarks.
2. **Incident Trend Analysis:** Breakdown of safety incidents grouped by month, category, and harm level.
3. **ER Case Triage Distribution:** MySQL pie/donut chart breakdown of triage levels (1 through 5) and arrival modes (Ambulance vs. Walk-In).
4. **Physician Workload:** Doctor caseload bar chart (MySQL Query 13).

---

## 5. API Layer & Route Handler Blueprint

All backend communication happens via Next.js Route Handlers (`app/api/...`), adhering to clean architectural separation:

| HTTP Method | Route Path | Handler Purpose | Source Database / Logic |
|---|---|---|---|
| `GET` | `/api/dashboard/stats` | High-level ED metrics, bed counts, triage queue | MySQL Views & Counts |
| `GET` | `/api/dashboard/news2` | Real-time NEWS2 calculation matrix | MongoDB `news2Board` agg |
| `GET` | `/api/cases` | Search and filter emergency cases | MySQL `EMERGENCY_CASE` + `PATIENT` |
| `POST` | `/api/cases` | Register new emergency case | MySQL Transaction (`CASE` + optional `BED`) |
| `GET` | `/api/cases/:id` | Full emergency case details | MySQL `CALL GetEmergencyCaseDetails(:id)` |
| `GET` | `/api/cases/:id/observations`| List vital sign observations | MongoDB `listCaseObservations` |
| `POST` | `/api/cases/:id/observations`| Record new vitals log | MongoDB `recordObservation` (with `caseExists`) |
| `GET` | `/api/cases/:id/notes` | Fetch notes and amendment history | MongoDB `listCaseNotes` |
| `POST` | `/api/cases/:id/notes` | Create draft clinical note | MongoDB `writeNote` |
| `PATCH`| `/api/notes/:id/sign` | Sign clinical note (Doctor/Nurse) | MongoDB `signNote` |
| `PATCH`| `/api/notes/:id/amend` | Amend signed note (Doctor only) | MongoDB `amendNote` |
| `GET` | `/api/cases/:id/timeline` | Unified chronological case stream | MongoDB `caseTimeline` agg |
| `GET` | `/api/incidents` | List open/reviewed incident reports| MongoDB `listOpenIncidents` |
| `POST` | `/api/incidents` | File prehospital or safety incident| MongoDB `reportIncident` (atomic counter) |
| `POST` | `/api/incidents/close-with-note`| Close incident + create note | MongoDB `closeIncidentWithNote` (Replica Tx) |
| `GET` | `/api/beds` | Real-time bed occupancy grid | MySQL `available_hospital_beds` |
| `GET` | `/api/billing/pending` | Retrieve pending/partial bills | MySQL `CALL GetPendingBills()` |
| `POST` | `/api/billing/:caseId` | Settle or generate bill | MySQL `BILLING` update |

---

## 6. Design System & CSS Token Architecture

The UI is built using standard Vanilla CSS variables (`globals.css`) structured around clinical clarity:

```css
:root {
  /* Surface & Base */
  --bg-app: #0b0f19;
  --bg-surface: #111827;
  --bg-surface-elevated: #1f2937;
  --border-subtle: #374151;
  --border-focus: #3b82f6;

  /* Typography */
  --text-primary: #f9fafb;
  --text-secondary: #9ca3af;
  --text-muted: #6b7280;
  --font-family-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --font-family-mono: 'JetBrains Mono', 'Fira Code', monospace;

  /* Clinical Triage Tokens (Standard ESI / MTS) */
  --triage-l1-resus: #ef4444;       /* Level 1: Immediate / Cardiac Arrest */
  --triage-l2-emergent: #f97316;    /* Level 2: Very Urgent / Chest Pain */
  --triage-l3-urgent: #eab308;      /* Level 3: Urgent / Fractures */
  --triage-l4-less-urgent: #10b981; /* Level 4: Standard / Lacerations */
  --triage-l5-non-urgent: #3b82f6;  /* Level 5: Non-urgent */

  /* Physiological NEWS2 Risk Indicators */
  --news2-low: #10b981;             /* Score 0 - 4: Routine observation */
  --news2-medium: #f59e0b;          /* Score 5 - 6: Urgent nurse review */
  --news2-high: #dc2626;            /* Score 7+: Emergency medical review */

  /* Interactive States */
  --btn-primary: #2563eb;
  --btn-primary-hover: #1d4ed8;
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --shadow-card: 0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -2px rgba(0, 0, 0, 0.3);
}
```

---

## 7. Implementation Roadmap & Project Layout

### Proposed Project File Structure (inside `web/` or root):

```
src/
├── app/
│   ├── layout.tsx                # App shell, persistent header, role switcher
│   ├── page.tsx                  # Redirects to /dashboard
│   ├── dashboard/page.tsx        # Command Center, NEWS2 widget, triage queue
│   ├── triage/page.tsx           # New case intake & triage rating
│   ├── cases/
│   │   ├── page.tsx              # Filterable cases list
│   │   └── [caseId]/page.tsx     # Case 360° file (Tabs: Vitals, SOAP, Orders)
│   ├── incidents/
│   │   ├── page.tsx              # Incident queue & hotspot radar
│   │   └── new/page.tsx          # Incident filing form (GeoJSON coordinates)
│   ├── beds/page.tsx             # Ward & bed grid
│   ├── pharmacy/page.tsx         # Inventory & low stock alerts
│   ├── billing/page.tsx          # Cashier desk & invoice generator
│   ├── analytics/page.tsx        # Charts & aggregation summaries
│   └── api/                      # Route handlers connecting MySQL & MongoDB
├── components/
│   ├── Navigation.tsx            # Sidebar and header components
│   ├── RoleSwitcher.tsx          # Quick user/role simulator bar
│   ├── TriageBadge.tsx           # Color-coded triage indicator
│   ├── News2ScoreCard.tsx        # Score calculation badge & alert pill
│   ├── VitalsChart.tsx           # SVG/Canvas vital sign trend sparkline
│   ├── SoapNoteEditor.tsx        # Clinical documentation editor
│   ├── BedStatusGrid.tsx         # Real-time department bed visualizer
│   └── Modal.tsx                 # Accessible modal dialog
├── lib/
│   ├── mysql.ts                  # MySQL pool & query executor
│   ├── auth.ts                   # Role verification & mock session helper
│   └── mongodb.ts                # Wrapper re-exporting mongodb/lib/repository.js
└── styles/
    ├── globals.css               # Design tokens, reset, typography
    └── modules/                  # Scoped CSS modules for each page
```

---

## 8. Summary of How This Fulfills Project Goals

1. **Relational Depth:** Directly leverages MySQL views (`critical_emergency_cases`, `available_hospital_beds`), stored procedures (`GetEmergencyCaseDetails`, `GetPendingBills`), and respects triggers on stock and billing.
2. **Document & NoSQL Power:** Delivers clinical value that relational tables struggle with: flexible prehospital incident details, sparse high-volume vitals with on-the-fly NEWS2 pipelines, full-text clinical note search, and multi-document transactions.
3. **Academic Evaluation Ready:** The built-in interactive role switcher allows instant demonstration of RBAC rules (Doctor vs. Nurse vs. Admin privileges) with zero setup friction.
4. **Clean, Modern Codebase:** Pure Next.js App Router with TypeScript and modular Vanilla CSS, ensuring zero configuration bloat, blazing fast load times, and production-grade maintainability.
