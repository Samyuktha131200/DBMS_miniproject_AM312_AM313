# Using the MongoDB layer from the Next.js API

The Next.js route handlers do not write MongoDB queries themselves. They call
`mongodb/lib/repository.js`, which checks the user's role, builds the query, runs it
and maps errors to HTTP status codes.

## 1. Configuration

In the Next.js app's `.env.local` (git-ignored):

```bash
MONGODB_URI=mongodb://localhost:27017            # or the Atlas URI for the er_app user
MONGODB_DB=hospital_emergency_management
```

Install the driver in the Next.js app (`npm install mongodb`). The repository code is
CommonJS and works from route handlers with `require` or `import`.

Route handlers that use MongoDB must run on the Node.js runtime, not Edge:

```js
export const runtime = 'nodejs';
```

## 2. The user object

Each repository function takes the signed-in user from the session. It is never
taken from the request body.

```js
{ role: 'doctor', doctor_id: 2 }   // DOCTOR.doctor_id in MySQL
{ role: 'nurse',  staff_id: 6 }    // NURSE_STAFF.staff_id in MySQL
{ role: 'admin',  staff_id: 1 }    // staff_id optional; needed only to be recorded as a reviewer
```

The application's login (users table in MySQL with hashed passwords) decides who the
user is. This layer decides what they may do with MongoDB data (see the
permission table in `docs/DATA_MODEL.md` §7).

## 3. Example route handler

`app/api/cases/[caseId]/observations/route.js`

```js
import { getDb } from '@/mongodb/lib/db';
import * as repo from '@/mongodb/lib/repository';
import { getSessionUser } from '@/lib/auth';      // your auth helper
import { caseExists } from '@/lib/mysql';         // SELECT 1 FROM EMERGENCY_CASE WHERE case_id = ?

export const runtime = 'nodejs';

export async function GET(_req, { params }) {
  try {
    const db = await getDb();
    const user = await getSessionUser();
    const { caseId } = await params;
    return Response.json(await repo.listCaseObservations(db, user, { caseId }));
  } catch (err) {
    const { status, body } = repo.toHttpError(err);
    return Response.json(body, { status });
  }
}

export async function POST(req, { params }) {
  try {
    const db = await getDb();
    const user = await getSessionUser();
    const { caseId } = await params;
    const input = await req.json();                   // { observedAt, source, vitals, additional?, notes? }
    const result = await repo.recordObservation(db, user, { ...input, caseId }, { caseExists });
    return Response.json(result, { status: 201 });
  } catch (err) {
    const { status, body } = repo.toHttpError(err);
    return Response.json(body, { status });
  }
}
```

## 4. Errors

| Thrown by the repository | HTTP | When |
|---|---|---|
| `ValidationError` | 400 | bad input, or the MongoDB validator rejected the document (`details` lists why) |
| `AccessDeniedError` | 403 | not signed in, or the role may not do this |
| `NotFoundError` | 404 | the case does not exist in MySQL, or nothing matched (for example the note is already signed, or it belongs to someone else) |
| `ConflictError` | 409 | duplicate reading or incident number |
| `TransactionUnsupportedError` | 501 | `closeIncidentWithNote` on a server that is not a replica set |
| anything else | 500 | the body is a generic message; the details are not sent to the browser |

## 5. Functions and suggested routes

| Function | Permission | Suggested route |
|---|---|---|
| `listCaseObservations(db, user, { caseId })` | observations:read | `GET /api/cases/:caseId/observations` |
| `recordObservation(db, user, { caseId, observedAt, source, vitals, additional?, notes? }, { caseExists })` | observations:create | `POST /api/cases/:caseId/observations` |
| `deleteObservation(db, user, { caseId, observedAt, source })` | observations:delete | `DELETE /api/cases/:caseId/observations` |
| `listRedFlags(db, user, { from?, to? })` | observations:read | `GET /api/observations/red-flags` |
| `news2Board(db, user, { caseId?, from?, to? })` | reports:clinical | `GET /api/dashboard/news2` |
| `vitalsSummary(db, user, { caseId? })` | reports:clinical | `GET /api/cases/:caseId/vitals-summary` |
| `caseTimeline(db, user, { caseId })` | reports:clinical | `GET /api/cases/:caseId/timeline` |
| `listCaseNotes(db, user, { caseId })` | notes:read | `GET /api/cases/:caseId/notes` |
| `searchNotes(db, user, { text, caseId? })` | notes:read | `GET /api/notes/search?q=` |
| `listDraftNotes(db, user)` | notes:read | `GET /api/notes/drafts` |
| `writeNote(db, user, { caseId, noteType, title, body, sections?, tags?, links? }, { caseExists })` | notes:create | `POST /api/cases/:caseId/notes` |
| `editDraftNote(db, user, { noteId, title?, body?, tags?, sections? })` | notes:edit | `PATCH /api/notes/:noteId` |
| `signNote(db, user, { noteId })` | notes:sign | `POST /api/notes/:noteId/sign` |
| `amendNote(db, user, { noteId, newBody, reason })` | notes:amend | `POST /api/notes/:noteId/amend` |
| `deleteDraftNote(db, user, { noteId })` | notes:delete | `DELETE /api/notes/:noteId` |
| `listOpenIncidents(db, user)` | incidents:read | `GET /api/incidents?status=open` |
| `listCaseIncidents(db, user, { caseId })` | incidents:read | `GET /api/cases/:caseId/incidents` |
| `reportIncident(db, user, { category, incidentType, caseIds, occurredAt, reportedAt?, location, severity, harmLevel?, summary, details?, timeline? }, { caseExists })` | incidents:create | `POST /api/incidents` |
| `startIncidentReview(db, user, { incidentNo, note? })` | incidents:review | `POST /api/incidents/:no/review` |
| `closeIncident(db, user, { incidentNo, actions? })` | incidents:close | `POST /api/incidents/:no/close` |
| `closeIncidentWithNote(db, user, { incidentNo, caseId, title, body, actions? })` | incidents:close + notes | `POST /api/incidents/:no/close-with-note` |
| `purgeClosedIncidents(db, user, { closedBefore })` | incidents:purge | `DELETE /api/incidents/closed?before=` |
| `responseTimes(db, user, { targetMinutes?, from?, to? })` | reports:operational | `GET /api/dashboard/response-times` |
| `incidentTrends(db, user, { from?, to? })` | reports:operational | `GET /api/dashboard/incident-trends` |
| `incidentHotspots(db, user, { maxKm? })` | reports:operational | `GET /api/dashboard/hotspots` |

Notes:

* Dates can be `Date` objects or ISO strings with a time zone (`2026-10-24T15:00:00+05:30`).
* `noteId` can be the 24-character hex string the browser sends back.
* `require('mongodb/lib/access').permissionsFor(user.role)` returns the actions a role
  may perform, so the UI can hide buttons the user cannot use. The server still checks
  every request.
* List functions return at most 500 documents, and text search returns at most 50.
