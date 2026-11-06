# Hospital ER web app

## Run locally

1. Start MySQL and MongoDB.
2. In MySQL Workbench, run the repository-root SQL files in order: `01_schema.sql`,
   `02_sample_data.sql`, then `03_advanced_features.sql`.
3. Configure `web/.env.local` using `.env.example`. Set `MYSQL_PASSWORD` to the
   password for your local MySQL account. For local MongoDB, the URI is usually
   `mongodb://localhost:27017`. Set `SESSION_SECRET` to a private random value
   of at least 32 characters (for example, generate one with
   `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`).
4. Create and seed MongoDB from PowerShell:

   ```powershell
   cd ..\mongodb
   npm.cmd install
   Copy-Item .env.example .env
   npm.cmd run setup
   npm.cmd run seed
   ```

5. From `web`, run `npm.cmd install` and `npm.cmd run dev`, then open
   [http://localhost:3000](http://localhost:3000).
6. Open [http://localhost:3000](http://localhost:3000), choose **Doctor** or
   **Nurse**, and enter an ID that exists in `DOCTOR.doctor_id` or
   `NURSE_STAFF.staff_id`. Then open **Data entry**. Save a MySQL patient and emergency case first; then use
   its case ID to save an observation, clinical note, or in-hospital incident to
   MongoDB. Inspect the records in Workbench or Compass.

The login is passwordless demo access: it checks the staff ID against MySQL and
issues a signed HTTP-only session cookie, but does not verify a person's
identity. The API requires this session and MongoDB writes use the selected
doctor/nurse role. Identity-only sign-in is disabled in production. Do not expose
the app publicly or use real patient information.

The role-aware dashboard combines live MySQL counts (patients, active and
discharged cases, triage, beds, tests, and billing) with department-scoped
MongoDB observations, clinical notes, and incidents. It refreshes every five
seconds; the patient registry refreshes every 15 seconds. MySQL owns patient and
case status; the MongoDB collections do not store patient counts or discharge
state. If either database is unavailable, check the page error and Next.js
terminal output.

On **Patients**, select a new value in the row's **Update status** control and
choose **Save**. Supported statuses are `Open`, `Under Treatment`, `Admitted`,
`Discharged`, and `Closed`. The update requires a valid staff session and a case
linked to the staff member's department (unassigned ER queue cases are shared).
The MySQL status update and any related bed occupancy/release change are
committed together.

## Development

```powershell
npm.cmd run dev
npm.cmd run lint
npm.cmd run build
```
