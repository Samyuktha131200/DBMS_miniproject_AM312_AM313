'use strict';

/**
 * All MongoDB queries, updates and aggregation pipelines for the
 * Hospital Emergency Management System, written as plain builder
 * functions that return query objects. The same builders are used by
 *   - scripts/run-queries.js   (demo: `npm run queries`)
 *   - queries/queries.mongosh.js (generated copy for mongosh / Compass)
 *   - the Next.js API routes   (Part 4)
 *
 * Writes: C1-C3 inserts, U1-U5 updates, D1-D3 deletes.
 * Requires MongoDB 6.0+ ($setWindowFields, $dateDiff, $sortArray, $unionWith).
 */

const { news2Stages, redScoreFilter } = require('./news2');

/** Fictional hospital location used as the reference point for distances. */
const HOSPITAL_LOCATION = Object.freeze({ type: 'Point', coordinates: [77.6033, 12.9857] });
const TIMEZONE = 'Asia/Kolkata';
const RESPONSE_TARGET_MIN = 15;

const dateRange = (field, { from, to } = {}) => {
  if (!from && !to) return {};
  const range = {};
  if (from) range.$gte = from;
  if (to) range.$lt = to;
  return { [field]: range };
};

const requireId = (value, name) => {
  if (!Number.isInteger(value) || value < 1) throw new TypeError(`${name} must be a positive integer`);
  return value;
};

// ===========================================================================
// FIND QUERIES (filtering + sorting)
// ===========================================================================

/** F1. A case's observations in time order (uses uniq_case_observed_source). */
function observationsForCase(caseId) {
  return {
    collection: 'observation_logs',
    filter: { case_id: requireId(caseId, 'caseId') },
    projection: { _id: 0, schema_version: 0 },
    sort: { observed_at: 1 },
  };
}

/** F2. Observations with any NEWS2 "red" parameter (a single score of 3), newest first. */
function redFlagObservations({ from, to } = {}) {
  return {
    collection: 'observation_logs',
    filter: { ...dateRange('observed_at', { from, to }), ...redScoreFilter() },
    projection: { _id: 0, case_id: 1, observed_at: 1, source: 1, vitals: 1 },
    sort: { observed_at: -1 },
  };
}

/** F3. Incident work queue: everything not yet closed, newest first (uses status_occurred). */
function openIncidents() {
  return {
    collection: 'incident_reports',
    filter: { status: { $in: ['open', 'under_review'] } },
    projection: { _id: 0, incident_no: 1, category: 1, incident_type: 1, severity: 1, status: 1, case_ids: 1, occurred_at: 1, summary: 1 },
    sort: { occurred_at: -1 },
  };
}

/** F4. All incidents linked to one case (uses the multikey case_ids index). */
function incidentsForCase(caseId) {
  return {
    collection: 'incident_reports',
    filter: { case_ids: requireId(caseId, 'caseId') },
    projection: { _id: 0, schema_version: 0 },
    sort: { occurred_at: 1 },
  };
}

/** F5. Full-text search over clinical notes, best match first (uses notes_text). */
function searchNotes(text, { caseId } = {}) {
  if (typeof text !== 'string' || text.trim().length < 2) throw new TypeError('search text must be at least 2 characters');
  return {
    collection: 'clinical_notes',
    filter: { $text: { $search: text.trim() }, ...(caseId ? { case_id: requireId(caseId, 'caseId') } : {}) },
    projection: { _id: 0, case_id: 1, note_type: 1, title: 1, created_at: 1, status: 1, score: { $meta: 'textScore' } },
    sort: { score: { $meta: 'textScore' }, created_at: -1 },
  };
}

/** F6. Draft notes waiting for sign-off, oldest first (uses the partial index draft_queue). */
function draftNotesQueue() {
  return {
    collection: 'clinical_notes',
    filter: { status: 'draft' },
    projection: { case_id: 1, author: 1, title: 1, created_at: 1 },
    sort: { created_at: 1 },
  };
}

/** F7. A case's notes, newest first (uses case_created). */
function notesForCase(caseId) {
  return {
    collection: 'clinical_notes',
    filter: { case_id: requireId(caseId, 'caseId') },
    projection: { schema_version: 0 },
    sort: { created_at: -1 },
  };
}

// ===========================================================================
// UPDATES
// ===========================================================================

/** U1. Close an incident: set status, record reviewer and actions, add a timeline event. */
function closeIncident({ incidentNo, reviewedBy, actions = [], now = new Date() }) {
  if (!reviewedBy || Object.keys(reviewedBy).length !== 1) throw new TypeError('reviewedBy must be {doctor_id} or {staff_id}');
  return {
    collection: 'incident_reports',
    filter: { incident_no: incidentNo, status: { $ne: 'closed' } },
    update: {
      $set: {
        status: 'closed',
        updated_at: now,
        'follow_up.reviewed_by': reviewedBy,
        'follow_up.closed_at': now,
      },
      $push: {
        timeline: { event: 'closed', at: now },
        'follow_up.actions': { $each: actions },
      },
    },
  };
}

/** U2. Sign a draft note. Only drafts match, so signing twice changes nothing. */
function signNote({ noteId, now = new Date() }) {
  return {
    collection: 'clinical_notes',
    filter: { _id: noteId, status: 'draft' },
    update: { $set: { status: 'signed', signed_at: now, updated_at: now } },
  };
}

/**
 * U3. Amend a signed note. A pipeline-style update copies the current body
 * into the amendments array and replaces it in one atomic step, so the
 * old text can never be lost between a read and a write.
 * User-supplied text is wrapped in $literal so a value starting with "$"
 * is stored as text, not read as a field path.
 */
function amendNote({ noteId, newBody, reason, amendedBy, now = new Date() }) {
  return {
    collection: 'clinical_notes',
    filter: { _id: noteId, status: { $in: ['signed', 'amended'] } },
    update: [
      {
        $set: {
          amendments: {
            $concatArrays: [
              { $ifNull: ['$amendments', []] },
              [{
                amended_at: now,
                amended_by: { $literal: amendedBy },
                reason: { $literal: reason },
                previous_body: '$body',
              }],
            ],
          },
          body: { $literal: newBody },
          status: 'amended',
          updated_at: now,
        },
      },
    ],
  };
}

// ===========================================================================
// INSERTS (create)
// Each builder returns { collection, document }. The document is complete:
// schema_version and timestamps are filled in here, so callers (the API)
// only pass what the user typed. The server-side $jsonSchema validator is
// the final check; these builders only reject input that could never be
// valid or that the validator cannot see (e.g. a reading in the future).
// ===========================================================================

const SCHEMA_VERSION = 1;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000; // allow small clock drift between devices

const requireDate = (value, name) => {
  const d = value instanceof Date ? value : new Date(value);
  if (value == null || Number.isNaN(d.getTime())) throw new TypeError(`${name} must be a valid date`);
  return d;
};

const notInFuture = (d, name, now) => {
  if (d.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) throw new RangeError(`${name} cannot be in the future`);
  return d;
};

/** {doctor_id: 2} or {staff_id: 7}; exactly one key with a positive integer id. */
const requirePerson = (value, name) => {
  const keys = value && typeof value === 'object' ? Object.keys(value) : [];
  if (keys.length !== 1 || !['doctor_id', 'staff_id'].includes(keys[0])) {
    throw new TypeError(`${name} must be {doctor_id} or {staff_id}`);
  }
  return { [keys[0]]: requireId(value[keys[0]], `${name}.${keys[0]}`) };
};

/** Drop keys whose value is undefined so optional fields are simply absent. */
const compact = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

/** C1. Record a set of vital signs for a case. */
function newObservation({ caseId, observedAt, source, recordedBy, vitals, additional, notes, now = new Date() }) {
  if (!vitals || typeof vitals !== 'object' || Object.keys(vitals).length === 0) {
    throw new TypeError('vitals must contain at least one reading');
  }
  return {
    collection: 'observation_logs',
    document: compact({
      schema_version: SCHEMA_VERSION,
      case_id: requireId(caseId, 'caseId'),
      observed_at: notInFuture(requireDate(observedAt, 'observedAt'), 'observedAt', now),
      source,
      recorded_by: requirePerson(recordedBy, 'recordedBy'),
      vitals,
      additional,
      notes,
    }),
  };
}

/**
 * C2. File an incident report. New reports always start as "open".
 * `incidentNo` comes from the counter (repository.nextIncidentNo), never
 * from the user, so two people filing at once cannot get the same number.
 */
function newIncident({
  incidentNo, category, incidentType, caseIds, occurredAt, reportedAt, reportedBy,
  location, severity, harmLevel, summary, details, timeline, now = new Date(),
}) {
  if (!Array.isArray(caseIds) || caseIds.length === 0) throw new TypeError('caseIds must list at least one case');
  const occurred = notInFuture(requireDate(occurredAt, 'occurredAt'), 'occurredAt', now);
  const reported = notInFuture(requireDate(reportedAt ?? now, 'reportedAt'), 'reportedAt', now);
  if (reported < occurred) throw new RangeError('reportedAt cannot be before occurredAt');
  return {
    collection: 'incident_reports',
    document: compact({
      schema_version: SCHEMA_VERSION,
      incident_no: incidentNo,
      category,
      incident_type: incidentType,
      case_ids: caseIds.map((c) => requireId(c, 'caseIds[]')),
      occurred_at: occurred,
      reported_at: reported,
      reported_by: requirePerson(reportedBy, 'reportedBy'),
      location,
      severity,
      harm_level: harmLevel,
      summary,
      details,
      timeline: timeline?.map((e) => compact({ event: e.event, at: requireDate(e.at, 'timeline.at'), note: e.note })),
      status: 'open',
      created_at: now,
      updated_at: now,
    }),
  };
}

/** C3. Write a clinical note. New notes are drafts until signed (U2). */
function newNote({ caseId, noteType, author, title, body, sections, tags, links, now = new Date() }) {
  return {
    collection: 'clinical_notes',
    document: compact({
      schema_version: SCHEMA_VERSION,
      case_id: requireId(caseId, 'caseId'),
      note_type: noteType,
      author: requirePerson(author, 'author'),
      created_at: now,
      updated_at: now,
      title,
      body,
      sections,
      tags,
      links,
      status: 'draft',
    }),
  };
}

// ===========================================================================
// MORE UPDATES
// ===========================================================================

/** U4. Start reviewing an open incident: status open -> under_review, add a "reviewed" timeline event. */
function startIncidentReview({ incidentNo, note, now = new Date() }) {
  return {
    collection: 'incident_reports',
    filter: { incident_no: incidentNo, status: 'open' },
    update: {
      $set: { status: 'under_review', updated_at: now },
      $push: { timeline: compact({ event: 'reviewed', at: now, note }) },
    },
  };
}

/**
 * U5. Edit a draft note. Only the author's own drafts match: once a note is
 * signed it can only be changed through an amendment (U3), which keeps history.
 */
function editDraftNote({ noteId, author, title, body, tags, sections, now = new Date() }) {
  const changes = compact({ title, body, tags, sections });
  if (Object.keys(changes).length === 0) throw new TypeError('nothing to change');
  return {
    collection: 'clinical_notes',
    filter: { _id: noteId, status: 'draft', author: requirePerson(author, 'author') },
    update: { $set: { ...changes, updated_at: now } },
  };
}

// ===========================================================================
// DELETES
// Clinical records are normally kept, not deleted. Deletion is therefore
// limited to the three cases where it is correct:
//   D1 an unsigned draft note, by its own author
//   D2 an observation entered against the wrong case, by whoever recorded it
//   D3 closed incident reports past the retention date (admin housekeeping)
// Signed notes are never deletable: they can only be amended (U3).
// ===========================================================================

/** D1. Discard a draft note. Signed / amended notes do not match. */
function deleteDraftNote({ noteId, author }) {
  return {
    collection: 'clinical_notes',
    filter: { _id: noteId, status: 'draft', author: requirePerson(author, 'author') },
  };
}

/**
 * D2. Remove an observation entered in error. Identified by its natural key
 * (case, time, source - the unique index), and only by the person who recorded it.
 */
function deleteObservation({ caseId, observedAt, source, recordedBy }) {
  return {
    collection: 'observation_logs',
    filter: {
      case_id: requireId(caseId, 'caseId'),
      observed_at: requireDate(observedAt, 'observedAt'),
      source,
      recorded_by: requirePerson(recordedBy, 'recordedBy'),
    },
  };
}

/** D3. Purge closed incidents last changed before `closedBefore` (deleteMany). Open ones are never touched. */
function purgeClosedIncidents({ closedBefore }) {
  return {
    collection: 'incident_reports',
    filter: { status: 'closed', updated_at: { $lt: requireDate(closedBefore, 'closedBefore') } },
    many: true,
  };
}

// ===========================================================================
// AGGREGATION PIPELINES
// ===========================================================================

/**
 * A1. NEWS2 deterioration board.
 * Scores every complete observation, compares it with the same case's
 * previous score ($setWindowFields + $shift), and returns one row per case:
 * latest score and risk, peak score, score history, and whether the score
 * ever rose by 2+ points between readings. Highest current risk first.
 */
function news2Board({ caseId, from, to } = {}) {
  return {
    collection: 'observation_logs',
    pipeline: [
      { $match: { ...(caseId ? { case_id: requireId(caseId, 'caseId') } : {}), ...dateRange('observed_at', { from, to }) } },
      ...news2Stages(),
      { $match: { 'news2.total': { $ne: null } } }, // incomplete sets cannot be scored
      {
        $setWindowFields: {
          partitionBy: '$case_id',
          sortBy: { observed_at: 1 },
          output: { previous_total: { $shift: { output: '$news2.total', by: -1 } } },
        },
      },
      {
        $set: {
          'news2.change': {
            $cond: [{ $eq: ['$previous_total', null] }, null, { $subtract: ['$news2.total', '$previous_total'] }],
          },
        },
      },
      { $sort: { case_id: 1, observed_at: 1 } },
      {
        $group: {
          _id: '$case_id',
          scored_observations: { $sum: 1 },
          peak_score: { $max: '$news2.total' },
          latest: {
            $last: { observed_at: '$observed_at', source: '$source', score: '$news2.total', risk: '$news2.risk', change: '$news2.change' },
          },
          history: { $push: { observed_at: '$observed_at', score: '$news2.total', change: '$news2.change' } },
          deterioration_detected: { $max: { $gte: [{ $ifNull: ['$news2.change', 0] }, 2] } },
        },
      },
      { $project: { _id: 0, case_id: '$_id', latest: 1, peak_score: 1, deterioration_detected: 1, scored_observations: 1, history: 1 } },
      { $sort: { 'latest.score': -1, peak_score: -1, case_id: 1 } },
    ],
  };
}

/**
 * A2. Ambulance response-time report.
 * Turns each prehospital timeline into named timestamps, computes the
 * interval between each stage with $dateDiff, flags call-to-scene times
 * over the target, and returns per-incident rows plus summary figures
 * in one round trip ($facet).
 */
function responseTimes({ targetMinutes = RESPONSE_TARGET_MIN, from, to } = {}) {
  const diff = (start, end) => ({ $dateDiff: { startDate: `$t.${start}`, endDate: `$t.${end}`, unit: 'minute' } });
  return {
    collection: 'incident_reports',
    pipeline: [
      { $match: { category: 'prehospital', ...dateRange('occurred_at', { from, to }) } },
      { $set: { t: { $arrayToObject: { $map: { input: '$timeline', as: 'e', in: { k: '$$e.event', v: '$$e.at' } } } } } },
      {
        $set: {
          minutes: {
            call_to_dispatch: diff('call_received', 'dispatched'),
            call_to_scene: diff('call_received', 'on_scene'),
            at_scene: diff('on_scene', 'left_scene'),
            transport: diff('left_scene', 'arrived_hospital'),
            call_to_hospital: diff('call_received', 'arrived_hospital'),
          },
        },
      },
      { $set: { target_breached: { $gt: ['$minutes.call_to_scene', targetMinutes] } } },
      {
        $facet: {
          incidents: [
            { $sort: { 'minutes.call_to_scene': -1, incident_no: 1 } },
            { $project: { _id: 0, incident_no: 1, case_ids: 1, incident_type: 1, severity: 1, minutes: 1, target_breached: 1 } },
          ],
          summary: [
            {
              $group: {
                _id: null,
                incidents: { $sum: 1 },
                avg_call_to_scene: { $avg: '$minutes.call_to_scene' },
                max_call_to_scene: { $max: '$minutes.call_to_scene' },
                avg_at_scene: { $avg: '$minutes.at_scene' },
                avg_transport: { $avg: '$minutes.transport' },
                avg_call_to_hospital: { $avg: '$minutes.call_to_hospital' },
                target_breaches: { $sum: { $cond: ['$target_breached', 1, 0] } },
              },
            },
            {
              $project: {
                _id: 0,
                incidents: 1,
                max_call_to_scene: 1,
                target_breaches: 1,
                avg_call_to_scene: { $round: ['$avg_call_to_scene', 1] },
                avg_at_scene: { $round: ['$avg_at_scene', 1] },
                avg_transport: { $round: ['$avg_transport', 1] },
                avg_call_to_hospital: { $round: ['$avg_call_to_hospital', 1] },
              },
            },
          ],
          by_severity: [
            { $group: { _id: '$severity', incidents: { $sum: 1 }, avg_call_to_scene: { $avg: '$minutes.call_to_scene' } } },
            { $project: { _id: 0, severity: '$_id', incidents: 1, avg_call_to_scene: { $round: ['$avg_call_to_scene', 1] } } },
            { $sort: { severity: 1 } },
          ],
        },
      },
      { $set: { summary: { $first: '$summary' }, target_minutes: targetMinutes } },
    ],
  };
}

/**
 * A3. Incident trend dashboard: several breakdowns in one query ($facet).
 * `asOf` is the "current time" used to age open incidents (pass new Date()
 * in the API; a fixed date makes the output reproducible in tests).
 */
function incidentTrends({ from, to, asOf = new Date(), timezone = TIMEZONE } = {}) {
  const count = (field, label) => [
    { $group: { _id: field, incidents: { $sum: 1 } } },
    { $project: { _id: 0, [label]: '$_id', incidents: 1 } },
  ];
  return {
    collection: 'incident_reports',
    pipeline: [
      { $match: dateRange('occurred_at', { from, to }) },
      {
        $facet: {
          total: [{ $count: 'incidents' }],
          by_type: [
            { $group: { _id: { category: '$category', incident_type: '$incident_type' }, incidents: { $sum: 1 } } },
            { $project: { _id: 0, category: '$_id.category', incident_type: '$_id.incident_type', incidents: 1 } },
            { $sort: { incidents: -1, category: 1, incident_type: 1 } },
          ],
          by_severity: [...count('$severity', 'severity'), { $sort: { severity: 1 } }],
          by_status: [...count('$status', 'status'), { $sort: { status: 1 } }],
          by_hour: [...count({ $hour: { date: '$occurred_at', timezone } }, 'hour'), { $sort: { hour: 1 } }],
          by_day: [
            ...count({ $dateToString: { format: '%Y-%m-%d', date: '$occurred_at', timezone } }, 'day'),
            { $sort: { day: 1 } },
          ],
          in_hospital_harm: [
            { $match: { category: 'in_hospital' } },
            ...count('$harm_level', 'harm_level'),
            { $sort: { harm_level: 1 } },
          ],
          open_items: [
            { $match: { status: { $ne: 'closed' } } },
            {
              $project: {
                _id: 0, incident_no: 1, incident_type: 1, severity: 1, status: 1,
                hours_open: { $dateDiff: { startDate: '$reported_at', endDate: asOf, unit: 'hour' } },
              },
            },
            { $sort: { hours_open: -1, incident_no: 1 } },
          ],
        },
      },
      { $set: { total: { $ifNull: [{ $first: '$total.incidents' }, 0] } } },
    ],
  };
}

/**
 * A4. Incident hotspots around the hospital ($geoNear + $bucket).
 * Lists prehospital incidents by distance and groups them into distance bands.
 */
function incidentHotspots({ center = HOSPITAL_LOCATION, maxKm = 30 } = {}) {
  return {
    collection: 'incident_reports',
    pipeline: [
      {
        $geoNear: {
          near: center,
          key: 'location.geo',
          distanceField: 'distance_m',
          maxDistance: maxKm * 1000,
          spherical: true,
          query: { category: 'prehospital' },
        },
      },
      { $set: { distance_km: { $round: [{ $divide: ['$distance_m', 1000] }, 1] } } },
      {
        $facet: {
          nearest: [
            {
              $project: {
                _id: 0, incident_no: 1, incident_type: 1, severity: 1, distance_km: 1,
                place: '$location.description', coordinates: '$location.geo.coordinates',
              },
            },
          ],
          by_distance_band: [
            {
              $bucket: {
                groupBy: '$distance_km',
                boundaries: [0, 5, 10, 20],
                default: '20+',
                output: { incidents: { $sum: 1 }, incident_nos: { $push: '$incident_no' } },
              },
            },
            {
              $project: {
                _id: 0,
                band_km: {
                  $switch: {
                    branches: [
                      { case: { $eq: ['$_id', 0] }, then: '0-5' },
                      { case: { $eq: ['$_id', 5] }, then: '5-10' },
                      { case: { $eq: ['$_id', 10] }, then: '10-20' },
                    ],
                    default: '20+',
                  },
                },
                incidents: 1,
                incident_nos: 1,
              },
            },
          ],
        },
      },
    ],
  };
}

/**
 * A5. Vital-sign summary per case: ranges and averages over the stay,
 * for handover and discharge summaries.
 */
function vitalsSummary({ caseId } = {}) {
  const round1 = (expr) => ({ $round: [expr, 1] });
  return {
    collection: 'observation_logs',
    pipeline: [
      { $match: caseId ? { case_id: requireId(caseId, 'caseId') } : {} },
      { $sort: { case_id: 1, observed_at: 1 } },
      {
        $group: {
          _id: '$case_id',
          observations: { $sum: 1 },
          sources: { $addToSet: '$source' },
          first_at: { $first: '$observed_at' },
          last_at: { $last: '$observed_at' },
          hr_min: { $min: '$vitals.heart_rate' },
          hr_max: { $max: '$vitals.heart_rate' },
          hr_avg: { $avg: '$vitals.heart_rate' },
          spo2_min: { $min: '$vitals.spo2' },
          rr_max: { $max: '$vitals.resp_rate' },
          sbp_min: { $min: '$vitals.bp.systolic' },
          temp_max: { $max: '$vitals.temp_c' },
          pain_first: { $first: '$vitals.pain_score' },
          pain_last: { $last: '$vitals.pain_score' },
          oxygen_readings: { $sum: { $cond: ['$vitals.on_supplemental_o2', 1, 0] } },
        },
      },
      {
        $project: {
          _id: 0,
          case_id: '$_id',
          observations: 1,
          sources: { $sortArray: { input: '$sources', sortBy: 1 } },
          first_at: 1,
          last_at: 1,
          monitored_minutes: { $dateDiff: { startDate: '$first_at', endDate: '$last_at', unit: 'minute' } },
          heart_rate: { min: '$hr_min', max: '$hr_max', avg: round1('$hr_avg') },
          lowest_spo2: '$spo2_min',
          highest_resp_rate: '$rr_max',
          lowest_systolic: '$sbp_min',
          highest_temp_c: '$temp_max',
          pain: { first: '$pain_first', last: '$pain_last' },
          oxygen_readings: 1,
        },
      },
      { $sort: { case_id: 1 } },
    ],
  };
}

/**
 * A6. Unified case timeline: observations, clinical notes and incidents for
 * one case merged into a single chronological list ($unionWith).
 */
function caseTimeline(caseId) {
  const id = requireId(caseId, 'caseId');
  const str = (path, fallback = '?') => ({ $ifNull: [{ $toString: path }, fallback] });
  return {
    collection: 'observation_logs',
    pipeline: [
      { $match: { case_id: id } },
      {
        $project: {
          _id: 0,
          at: '$observed_at',
          kind: { $literal: 'observation' },
          detail: '$source',
          summary: {
            $concat: [
              'HR ', str('$vitals.heart_rate'),
              ', RR ', str('$vitals.resp_rate'),
              ', SpO2 ', str('$vitals.spo2'), '%',
              { $cond: ['$vitals.on_supplemental_o2', ' on O2', ''] },
              ', BP ', str('$vitals.bp.systolic'), '/', str('$vitals.bp.diastolic'),
            ],
          },
        },
      },
      {
        $unionWith: {
          coll: 'clinical_notes',
          pipeline: [
            { $match: { case_id: id } },
            { $project: { _id: 0, at: '$created_at', kind: { $literal: 'note' }, detail: '$note_type', summary: '$title' } },
          ],
        },
      },
      {
        $unionWith: {
          coll: 'incident_reports',
          pipeline: [
            { $match: { case_ids: id } },
            {
              $project: {
                _id: 0,
                at: '$occurred_at',
                kind: { $literal: 'incident' },
                detail: '$incident_type',
                summary: { $concat: ['$incident_no', ' (', '$severity', '): ', '$summary'] },
              },
            },
          ],
        },
      },
      { $sort: { at: 1, kind: 1 } },
    ],
  };
}

module.exports = {
  HOSPITAL_LOCATION, TIMEZONE, RESPONSE_TARGET_MIN,
  // find
  observationsForCase, redFlagObservations, openIncidents, incidentsForCase,
  searchNotes, draftNotesQueue, notesForCase,
  // insert
  newObservation, newIncident, newNote,
  // update
  closeIncident, signNote, amendNote, startIncidentReview, editDraftNote,
  // delete
  deleteDraftNote, deleteObservation, purgeClosedIncidents,
  // aggregate
  news2Board, responseTimes, incidentTrends, incidentHotspots, vitalsSummary, caseTimeline,
};
