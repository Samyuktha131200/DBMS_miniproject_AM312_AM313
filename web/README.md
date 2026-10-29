# Hospital ER web app

## Run locally

1. Start MySQL and MongoDB.
2. In MySQL Workbench, run the repository-root SQL files in order: `01_schema.sql`,
   `02_sample_data.sql`, then `03_advanced_features.sql`.
3. Configure `web/.env.local` using `.env.example`. Set `MYSQL_PASSWORD` to the
   password for your local MySQL account. For local MongoDB, the URI is usually
   `mongodb://localhost:27017`. Set `MONGODB_DEMO_ROLE` to `nurse` or `doctor` and
   `MONGODB_DEMO_ID` to an existing `NURSE_STAFF.staff_id` or `DOCTOR.doctor_id`.
4. Create and seed MongoDB from PowerShell:

   ```powershell
   cd ..\mongodb
   npm install
   Copy-Item .env.example .env
   npm run setup
   npm run seed
   ```

5. From `web`, run `npm install` and `npm run dev`, then open
   [http://localhost:3000](http://localhost:3000).
6. Open **Data entry**. Save a MySQL patient and emergency case first; then use
   its case ID to save an observation, clinical note, or in-hospital incident to
   MongoDB. Inspect the records in Workbench or Compass.

The MongoDB form uses the configured demo identity because this project does not
yet implement login. This is only for local demonstration; do not expose the app
publicly or use real patient information until authentication and authorization
are implemented.

The dashboard reports whether it is displaying live MySQL data or mock data. If
MySQL is unavailable, check the page warning and the Next.js terminal output.

## Development

```powershell
npm run dev
npm run lint
npm run build
```
