# Hospital ER web app

## Run locally

1. Start MySQL and MongoDB.
2. In MySQL Workbench, run the repository-root SQL files in order:
   `01_schema.sql`, `02_sample_data.sql`, `03_advanced_features.sql`,
   `04_queries.sql`, then `05_security.sql`.
   These instructions are for a fresh local database. If you already have an
   older database, do not rerun the sample-data script against it. Back it up
   first; rebuilding with `DROP DATABASE hospital_emergency_management;` deletes
   all its data, so only do that if the database is disposable.
3. In `web`, create `.env.local` from `.env.example` only if you do not already
   have a `.env.local` file. Set `MYSQL_PASSWORD` to your local MySQL password.
   For local MongoDB, the URI is usually `mongodb://localhost:27017`. Set
   `SESSION_SECRET` to a private random value of at least 32 characters (for
   example, generate one with
   `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`).
4. Create and seed MongoDB from PowerShell:

   ```powershell
   cd ..\mongodb
   npm.cmd install
   if (!(Test-Path .env)) { Copy-Item .env.example .env }
   npm.cmd run setup
   npm.cmd run seed
   ```

5. From `web`, run `npm.cmd install` and `npm.cmd run dev`, then open
   [http://localhost:3000](http://localhost:3000).
6. Open [http://localhost:3000](http://localhost:3000) and sign in with a seeded
   account: `doctor1`-`doctor8` / `Doctor@123` or `nurse1`-`nurse8` / `Nurse@123`.
   Then open **Data entry**. Save a MySQL patient and emergency case first; then use
   its case ID to save an observation, clinical note, or in-hospital incident to
   MongoDB. Inspect the records in Workbench or Compass.

Sign-in checks the username and password against `USER_ACCOUNT` in MySQL, where
passwords are stored only as salted scrypt hashes (`src/lib/password.ts`). The
role and department come from the account, never from the browser. A signed
HTTP-only session cookie is required by every API route. Five failed attempts
lock a username for 15 minutes. To add an account or reset a password, run
`node scripts/hash-password.mjs "<password>"` from `web/` and store the printed
hash in `USER_ACCOUNT.password_hash`. Use only synthetic data; do not expose the
app publicly.

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
