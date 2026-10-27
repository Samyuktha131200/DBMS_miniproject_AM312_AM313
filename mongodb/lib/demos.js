'use strict';

/**
 * The demo catalogue: each query from lib/queries.js with fixed example
 * parameters that make sense for the sample data (24 Oct 2026). Used by
 *   scripts/run-queries.js      (runs them)
 *   scripts/export-mongosh.js   (writes queries/queries.mongosh.js)
 * so the demo, the mongosh file and the docs always show the same query.
 */

const q = require('./queries');

const ist = (s) => new Date(`${s}+05:30`);
const SAMPLE_DAY = { from: ist('2026-10-24T00:00:00'), to: ist('2026-10-25T00:00:00') };
const AS_OF = ist('2026-10-24T18:00:00'); // fixed "now" so outputs are reproducible
const BOARD_TIME = ist('2026-10-24T12:45:00');

/**
 * Placeholder for a value that must be looked up at run time (an _id).
 * `lookup` is the find used to get it; `mongosh` is how the exported
 * script refers to it.
 */
const ref = (name, collection, filter) => ({ __ref: name, collection, filter });

const demos = [
  // ---- find --------------------------------------------------------------
  {
    id: 'case-observations',
    type: 'find',
    title: 'F1. Observation history for case 8',
    purpose: 'Shows every vital-sign reading for one patient in time order, from the ambulance to the ward. This is the data behind the observation chart on the case screen.',
    build: () => q.observationsForCase(8),
  },
  {
    id: 'red-flags',
    type: 'find',
    title: 'F2. Observations with a NEWS2 red flag',
    purpose: 'Finds readings where any single vital sign is in the most dangerous NEWS2 band (score 3): for example SpO2 91% or less, breathing rate 25 or more, or new confusion. Nurses use this list to see who needs urgent review.',
    build: () => q.redFlagObservations(SAMPLE_DAY),
  },
  {
    id: 'open-incidents',
    type: 'find',
    title: 'F3. Incident work queue (open and under review)',
    purpose: 'Lists incidents that still need action, newest first. Uses the status_occurred index.',
    build: () => q.openIncidents(),
  },
  {
    id: 'case-incidents',
    type: 'find',
    title: 'F4. All incidents linked to case 3',
    purpose: 'One case can have both an ambulance incident and an in-hospital incident. Uses the multikey index on case_ids.',
    build: () => q.incidentsForCase(3),
  },
  {
    id: 'search-notes',
    type: 'find',
    title: 'F5. Full-text search of clinical notes: "oxygen breathless"',
    purpose: 'Searches note titles, tags and text, ranked by relevance (title matches weigh most). Lets a clinician find e.g. every note mentioning oxygen without knowing the case number.',
    build: () => q.searchNotes('oxygen breathless'),
  },
  {
    id: 'draft-queue',
    type: 'find',
    title: 'F6. Draft notes waiting for sign-off',
    purpose: 'The sign-off queue, oldest first. Served by a partial index that only contains draft notes, so it stays small however many signed notes accumulate.',
    build: () => q.draftNotesQueue(),
  },

  // ---- aggregate ---------------------------------------------------------
  {
    id: 'news2-board',
    type: 'aggregate',
    title: 'A1. NEWS2 deterioration board as at 12:45',
    purpose: 'Calculates the NEWS2 early-warning score for every complete set of observations, compares each score with the same patient\'s previous one, and returns one row per patient: current score and risk, peak score, history, and whether the score rose by 2 or more between readings. Sorted so the sickest patients are at the top. The demo looks at the ward as it was at 12:45, when case 8 was at its worst; the API uses the current time.',
    build: () => q.news2Board({ from: SAMPLE_DAY.from, to: BOARD_TIME }),
  },
  {
    id: 'response-times',
    type: 'aggregate',
    title: 'A2. Ambulance response times (target 15 minutes call-to-scene)',
    purpose: 'Measures each stage of every ambulance call (call to dispatch, call to scene, time at scene, transport, call to hospital) and flags calls that missed the 15-minute target. Returns per-incident rows and summary averages in one query.',
    build: () => q.responseTimes({ targetMinutes: 15, ...SAMPLE_DAY }),
  },
  {
    id: 'incident-trends',
    type: 'aggregate',
    title: 'A3. Incident trend dashboard',
    purpose: 'Breaks incidents down by type, severity, status, hour of day (IST), day, and harm level for in-hospital incidents, and lists open items with how long they have been open. All panels come from a single $facet query.',
    build: () => q.incidentTrends({ ...SAMPLE_DAY, asOf: AS_OF }),
  },
  {
    id: 'hotspots',
    type: 'aggregate',
    title: 'A4. Incident hotspots around the hospital',
    purpose: 'Orders ambulance incidents by distance from the hospital and groups them into distance bands. Helps plan where to station ambulances.',
    build: () => q.incidentHotspots({ maxKm: 30 }),
  },
  {
    id: 'vitals-summary',
    type: 'aggregate',
    title: 'A5. Vital-sign summary per case',
    purpose: 'Ranges, averages and pain trend for each patient\'s stay, for handover and discharge summaries.',
    build: () => q.vitalsSummary(),
  },
  {
    id: 'case-timeline',
    type: 'aggregate',
    title: 'A6. Unified timeline for case 8',
    purpose: 'Merges observations, clinical notes and incident reports for one case into a single chronological list, so a doctor taking over can read the whole story in order.',
    build: () => q.caseTimeline(8),
  },

  // ---- writes: insert / update / delete ------------------------------------
  // Run only with --updates (or --writes); restore with `npm run seed -- --reset`.
  // They run in this order, and a few build on the one before (noted below).
  {
    id: 'record-observation',
    type: 'insert',
    title: 'C1. Record a new set of vital signs for case 5',
    purpose: 'A nurse enters a ward observation. The builder fills in schema_version and checks the time is not in the future; the server-side validator checks every value is in range, and the unique index blocks a double submit of the same reading.',
    build: () => q.newObservation({
      caseId: 5,
      observedAt: ist('2026-10-24T15:00:00'),
      source: 'ward',
      recordedBy: { staff_id: 6 },
      vitals: {
        heart_rate: 92, resp_rate: 18, spo2: 97, on_supplemental_o2: false,
        bp: { systolic: 118, diastolic: 76 }, temp_c: 37.6, consciousness: 'A', pain_score: 4,
      },
      notes: 'Pain improving after analgesia',
      now: ist('2026-10-24T15:02:00'),
    }),
    show: { collection: 'observation_logs', filter: { case_id: 5, observed_at: ist('2026-10-24T15:00:00') } },
  },
  {
    id: 'report-incident',
    type: 'insert',
    title: 'C2. File an in-hospital incident (patient fall, case 9)',
    purpose: 'Files a new safety incident. New reports always start as "open". In the API the number comes from an atomic counter (repository.nextIncidentNo); the demo uses the next free number.',
    build: () => q.newIncident({
      incidentNo: 'INC-2026-0009',
      category: 'in_hospital',
      incidentType: 'patient_fall',
      caseIds: [9],
      occurredAt: ist('2026-10-24T15:10:00'),
      reportedAt: ist('2026-10-24T15:20:00'),
      reportedBy: { staff_id: 5 },
      location: { description: 'Orthopedics ward, bay 2' },
      severity: 'low',
      harmLevel: 'none',
      summary: 'Patient slipped while walking to the bathroom; no injury found on review.',
      timeline: [
        { event: 'detected', at: ist('2026-10-24T15:10:00') },
        { event: 'reported', at: ist('2026-10-24T15:20:00') },
      ],
      now: ist('2026-10-24T15:20:00'),
    }),
    show: { collection: 'incident_reports', filter: { incident_no: 'INC-2026-0009' } },
  },
  {
    id: 'write-note',
    type: 'insert',
    title: 'C3. Write a draft progress note for case 9',
    purpose: 'Creates a clinical note as a draft. It becomes part of the record only when signed (U2); until then the author can edit (U5) or discard it (D1).',
    build: () => q.newNote({
      caseId: 9,
      noteType: 'progress',
      author: { doctor_id: 4 },
      title: 'Progress: fall on ward, no injury',
      body: 'Reviewed after a fall on the ward. No head strike, no new pain, dressing intact. Falls risk assessment updated.',
      tags: ['fall', 'review'],
      links: { incident_no: 'INC-2026-0009' },
      now: ist('2026-10-24T15:40:00'),
    }),
    show: { collection: 'clinical_notes', filter: { case_id: 9, note_type: 'progress' } },
  },
  {
    id: 'start-review',
    type: 'update',
    title: 'U4. Start reviewing incident INC-2026-0007',
    purpose: 'Moves an open incident to "under_review" and adds a "reviewed" event to its timeline. Only open incidents match, so the status can only move forward.',
    build: () => q.startIncidentReview({
      incidentNo: 'INC-2026-0007',
      note: 'Radiology and ED leads asked for a timeline of the CT request',
      now: ist('2026-10-24T14:00:00'),
    }),
    show: { collection: 'incident_reports', filter: { incident_no: 'INC-2026-0007' } },
  },
  {
    id: 'close-incident',
    type: 'update',
    title: 'U1. Close incident INC-2026-0007',
    purpose: 'Closes the CT-delay incident: sets the status, records who reviewed it and what was done, and adds a "closed" event to its timeline in a single update. Already-closed incidents are not matched, so the update cannot run twice.',
    build: () => q.closeIncident({
      incidentNo: 'INC-2026-0007',
      reviewedBy: { doctor_id: 3 },
      actions: ['Added a priority slot for head-injury CT requests'],
      now: ist('2026-10-24T16:00:00'),
    }),
    show: { collection: 'incident_reports', filter: { incident_no: 'INC-2026-0007' } },
  },
  {
    id: 'sign-note',
    type: 'update',
    title: 'U2. Sign the draft progress note for case 5',
    purpose: 'Moves a draft note to signed and records the time. Only drafts match the filter, so signing twice changes nothing.',
    build: () => q.signNote({
      noteId: ref('draftNoteId', 'clinical_notes', { case_id: 5, status: 'draft' }),
      now: ist('2026-10-24T12:20:00'),
    }),
    show: { collection: 'clinical_notes', filter: { case_id: 5, note_type: 'progress' } },
  },
  {
    id: 'amend-note',
    type: 'update',
    title: 'U3. Amend the signed procedure note for case 4',
    purpose: 'Corrects a signed note without losing the original: a pipeline update copies the current text into the amendments history and replaces it, in one atomic step.',
    build: () => q.amendNote({
      noteId: ref('procedureNoteId', 'clinical_notes', { case_id: 4, note_type: 'procedure' }),
      newBody: 'X-ray confirms distal radius fracture. Left wrist immobilised in a below-elbow backslab. Distal pulses present and sensation intact after application. Fracture clinic follow-up in 7 days.',
      reason: 'Added follow-up interval',
      amendedBy: { doctor_id: 4 },
      now: ist('2026-10-24T13:00:00'),
    }),
    show: { collection: 'clinical_notes', filter: { case_id: 4, note_type: 'procedure' } },
  },
  {
    id: 'edit-draft',
    type: 'update',
    title: 'U5. Edit the draft progress note for case 1',
    purpose: 'The author changes the text of a note they have not signed yet. The filter requires status "draft" and the same author, so nobody can silently rewrite a signed note or someone else\'s draft.',
    build: () => q.editDraftNote({
      noteId: ref('case1DraftId', 'clinical_notes', { case_id: 1, status: 'draft' }),
      author: { doctor_id: 2 },
      body: 'Chest pain settling after treatment. Repeat troponin pending. Continue monitoring.',
      now: ist('2026-10-24T10:30:00'),
    }),
    show: { collection: 'clinical_notes', filter: { case_id: 1, note_type: 'progress' } },
  },
  {
    id: 'delete-draft',
    type: 'delete',
    title: 'D1. Discard the draft progress note for case 1',
    purpose: 'Deletes a draft note. Only drafts written by the same author match: signed and amended notes are part of the medical record and can never be deleted, only amended.',
    build: () => q.deleteDraftNote({
      noteId: ref('case1DraftId', 'clinical_notes', { case_id: 1, status: 'draft' }),
      author: { doctor_id: 2 },
    }),
    show: { collection: 'clinical_notes', filter: { case_id: 1 } },
  },
  {
    id: 'delete-observation',
    type: 'delete',
    title: 'D2. Remove an observation entered in error',
    purpose: 'Removes the reading added by C1, identified by its natural key (case, time, source), and only if the same person recorded it. Run C1 first.',
    build: () => q.deleteObservation({
      caseId: 5,
      observedAt: ist('2026-10-24T15:00:00'),
      source: 'ward',
      recordedBy: { staff_id: 6 },
    }),
    show: { collection: 'observation_logs', filter: { case_id: 5 } },
  },
  {
    id: 'purge-incidents',
    type: 'delete',
    title: 'D3. Purge closed incidents last updated before 09:15',
    purpose: 'Housekeeping with deleteMany: removes closed incident reports older than a retention date. Open and under-review incidents never match.',
    build: () => q.purgeClosedIncidents({ closedBefore: ist('2026-10-24T09:15:00') }),
    show: { collection: 'incident_reports', filter: {} },
  },
];

/** Demo types that change data (only run with --updates / --writes). */
const WRITE_TYPES = ['insert', 'update', 'delete'];

const isRef = (v) => v && typeof v === 'object' && '__ref' in v;

/** Replace placeholder refs with real values using `resolve(ref) -> value`. */
async function resolveRefs(value, resolve) {
  if (isRef(value)) return resolve(value);
  if (Array.isArray(value)) return Promise.all(value.map((v) => resolveRefs(v, resolve)));
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = await resolveRefs(v, resolve);
    return out;
  }
  return value;
}

/** Collect the refs used by a query (for the mongosh export). */
function collectRefs(value, found = new Map()) {
  if (isRef(value)) found.set(value.__ref, value);
  else if (Array.isArray(value)) value.forEach((v) => collectRefs(v, found));
  else if (value && typeof value === 'object' && !(value instanceof Date)) Object.values(value).forEach((v) => collectRefs(v, found));
  return found;
}

module.exports = { demos, WRITE_TYPES, SAMPLE_DAY, AS_OF, BOARD_TIME, isRef, resolveRefs, collectRefs };
