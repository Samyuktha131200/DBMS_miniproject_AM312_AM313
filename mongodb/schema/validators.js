'use strict';

/**
 * $jsonSchema validators for the MongoDB part of the
 * Hospital Emergency Management System.
 *
 * Design rule: MongoDB stores only the flexible, document-shaped data
 * (incident reports, observation logs, clinical notes). Anything that
 * already lives in MySQL (patient details, doctor/staff names, beds,
 * ambulances, medicines, bills) is referenced by its MySQL integer ID
 * and never copied here.
 *
 * Each validator has a strict "envelope" (additionalProperties: false)
 * and one deliberately open object for the type-specific part:
 *   incident_reports.details, observation_logs.additional,
 *   clinical_notes.sections
 */

const SCHEMA_VERSION = 1;

// ---- shared building blocks ------------------------------------------

const mysqlId = (description) => ({
  bsonType: 'int',
  minimum: 1,
  description,
});

const date = (description) => ({ bsonType: 'date', description });

/** Exactly one of staff_id (NURSE_STAFF) or doctor_id (DOCTOR). */
const personRef = (description) => ({
  bsonType: 'object',
  description,
  additionalProperties: false,
  minProperties: 1,
  maxProperties: 1,
  properties: {
    staff_id: mysqlId('NURSE_STAFF.staff_id in MySQL'),
    doctor_id: mysqlId('DOCTOR.doctor_id in MySQL'),
  },
});

const schemaVersion = {
  bsonType: 'int',
  enum: [SCHEMA_VERSION],
  description: 'Document schema version, bumped when the shape changes',
};

// ---- enums (exported so the API can reuse them) ----------------------

const ENUMS = {
  incidentCategory: ['prehospital', 'in_hospital'],
  incidentType: [
    // prehospital (scene of the emergency)
    'medical_cardiac', 'medical_respiratory', 'medical_abdominal',
    'medical_neurological', 'medical_other', 'trauma_fall', 'road_traffic',
    'burn', 'allergic_reaction', 'assault',
    // in-hospital safety incidents
    'patient_fall', 'medication_error', 'equipment_device',
    'delay_in_care', 'violence_aggression',
    'other',
  ],
  severity: ['low', 'moderate', 'high', 'critical'],
  harmLevel: ['none', 'minor', 'moderate', 'severe'],
  incidentStatus: ['open', 'under_review', 'closed'],
  timelineEvent: [
    // prehospital
    'call_received', 'dispatched', 'on_scene', 'left_scene', 'arrived_hospital',
    // in-hospital
    'detected', 'reported', 'reviewed', 'closed',
  ],
  observationSource: ['prehospital', 'triage', 'ward'],
  // ACVPU scale used by NEWS2: Alert, new Confusion, Voice, Pain, Unresponsive
  consciousness: ['A', 'C', 'V', 'P', 'U'],
  noteType: ['triage', 'assessment', 'progress', 'procedure', 'handover', 'discharge'],
  noteStatus: ['draft', 'signed', 'amended'],
};

// ---- incident_reports --------------------------------------------------

const incidentReports = {
  bsonType: 'object',
  title: 'Emergency incident report',
  required: [
    'schema_version', 'incident_no', 'category', 'incident_type', 'case_ids',
    'occurred_at', 'reported_at', 'reported_by', 'location', 'severity',
    'summary', 'status', 'created_at', 'updated_at',
  ],
  additionalProperties: false,
  properties: {
    _id: { bsonType: 'objectId' },
    schema_version: schemaVersion,
    incident_no: {
      bsonType: 'string',
      pattern: '^INC-[0-9]{4}-[0-9]{4}$',
      description: 'Human-readable reference, e.g. INC-2026-0001',
    },
    category: { enum: ENUMS.incidentCategory },
    incident_type: { enum: ENUMS.incidentType },
    case_ids: {
      bsonType: 'array',
      minItems: 1,
      uniqueItems: true,
      items: mysqlId('EMERGENCY_CASE.case_id in MySQL'),
      description: 'One incident can involve several cases (e.g. a multi-casualty crash)',
    },
    occurred_at: date('When the incident happened'),
    reported_at: date('When it was reported (call received / report filed)'),
    reported_by: personRef('Who filed the report'),
    location: {
      bsonType: 'object',
      required: ['description'],
      additionalProperties: false,
      properties: {
        description: { bsonType: 'string', minLength: 3, maxLength: 200 },
        geo: {
          bsonType: 'object',
          description: 'GeoJSON Point, coordinates are [longitude, latitude]',
          required: ['type', 'coordinates'],
          additionalProperties: false,
          properties: {
            type: { enum: ['Point'] },
            coordinates: {
              bsonType: 'array',
              items: [
                { bsonType: 'number', minimum: -180, maximum: 180 },
                { bsonType: 'number', minimum: -90, maximum: 90 },
              ],
              additionalItems: false,
              minItems: 2,
            },
          },
        },
      },
    },
    severity: { enum: ENUMS.severity },
    harm_level: { enum: ENUMS.harmLevel, description: 'Patient harm (in-hospital incidents)' },
    summary: { bsonType: 'string', minLength: 10, maxLength: 1000 },
    details: {
      bsonType: 'object',
      description: 'Type-specific fields; shape varies by incident_type',
    },
    timeline: {
      bsonType: 'array',
      items: {
        bsonType: 'object',
        required: ['event', 'at'],
        additionalProperties: false,
        properties: {
          event: { enum: ENUMS.timelineEvent },
          at: { bsonType: 'date' },
          note: { bsonType: 'string', maxLength: 500 },
        },
      },
    },
    status: { enum: ENUMS.incidentStatus },
    follow_up: {
      bsonType: 'object',
      additionalProperties: false,
      properties: {
        actions: { bsonType: 'array', items: { bsonType: 'string', minLength: 3 } },
        reviewed_by: personRef('Who reviewed the incident'),
        closed_at: { bsonType: 'date' },
      },
    },
    created_at: date('Document creation time'),
    updated_at: date('Last modification time'),
  },
  // Category-specific rules:
  //  - prehospital incidents need a map location and a response timeline
  //  - in-hospital incidents need a harm level
  oneOf: [
    {
      properties: {
        category: { enum: ['prehospital'] },
        location: { required: ['description', 'geo'] },
      },
      required: ['timeline'],
    },
    {
      properties: { category: { enum: ['in_hospital'] } },
      required: ['harm_level'],
    },
  ],
};

// ---- observation_logs --------------------------------------------------

const observationLogs = {
  bsonType: 'object',
  title: 'Patient observation (vital signs) log entry',
  required: ['schema_version', 'case_id', 'observed_at', 'source', 'recorded_by', 'vitals'],
  additionalProperties: false,
  properties: {
    _id: { bsonType: 'objectId' },
    schema_version: schemaVersion,
    case_id: mysqlId('EMERGENCY_CASE.case_id in MySQL'),
    observed_at: date('When the observation was taken'),
    source: { enum: ENUMS.observationSource },
    recorded_by: personRef('Who took the observation'),
    vitals: {
      bsonType: 'object',
      description: 'NEWS2 parameters plus common extras; any subset may be recorded',
      minProperties: 1,
      additionalProperties: false,
      properties: {
        heart_rate: { bsonType: 'int', minimum: 20, maximum: 250, description: 'beats/min' },
        resp_rate: { bsonType: 'int', minimum: 4, maximum: 60, description: 'breaths/min' },
        spo2: { bsonType: 'int', minimum: 50, maximum: 100, description: '%' },
        on_supplemental_o2: { bsonType: 'bool' },
        bp: {
          bsonType: 'object',
          required: ['systolic', 'diastolic'],
          additionalProperties: false,
          properties: {
            systolic: { bsonType: 'int', minimum: 40, maximum: 300 },
            diastolic: { bsonType: 'int', minimum: 20, maximum: 200 },
          },
        },
        temp_c: { bsonType: 'number', minimum: 30, maximum: 45 },
        consciousness: { enum: ENUMS.consciousness, description: 'ACVPU' },
        gcs: { bsonType: 'int', minimum: 3, maximum: 15 },
        pain_score: { bsonType: 'int', minimum: 0, maximum: 10 },
      },
    },
    additional: {
      bsonType: 'object',
      description: 'Situation-specific findings (pupils, peak flow, burn area, glucose...)',
    },
    notes: { bsonType: 'string', maxLength: 1000 },
  },
};

// ---- clinical_notes ----------------------------------------------------

const clinicalNotes = {
  bsonType: 'object',
  title: 'Clinical note',
  required: [
    'schema_version', 'case_id', 'note_type', 'author', 'created_at',
    'updated_at', 'title', 'body', 'status',
  ],
  additionalProperties: false,
  properties: {
    _id: { bsonType: 'objectId' },
    schema_version: schemaVersion,
    case_id: mysqlId('EMERGENCY_CASE.case_id in MySQL'),
    note_type: { enum: ENUMS.noteType },
    author: personRef('Note author'),
    created_at: date('When the note was written'),
    updated_at: date('Last modification time'),
    title: { bsonType: 'string', minLength: 3, maxLength: 150 },
    body: { bsonType: 'string', minLength: 1, maxLength: 10000 },
    sections: {
      bsonType: 'object',
      description: 'Optional structured parts, e.g. SOAP: subjective/objective/assessment/plan',
      additionalProperties: { bsonType: 'string' },
    },
    tags: {
      bsonType: 'array',
      maxItems: 20,
      uniqueItems: true,
      items: { bsonType: 'string', pattern: '^[a-z0-9-]+$' },
    },
    status: { enum: ENUMS.noteStatus },
    signed_at: { bsonType: 'date' },
    amendments: {
      bsonType: 'array',
      description: 'Append-only audit trail: the old text is kept, never overwritten',
      items: {
        bsonType: 'object',
        required: ['amended_at', 'amended_by', 'reason', 'previous_body'],
        additionalProperties: false,
        properties: {
          amended_at: { bsonType: 'date' },
          amended_by: personRef('Who made the amendment'),
          reason: { bsonType: 'string', minLength: 5, maxLength: 500 },
          previous_body: { bsonType: 'string' },
        },
      },
    },
    links: {
      bsonType: 'object',
      description: 'Optional references to related MySQL rows / incident reports',
      additionalProperties: false,
      properties: {
        treatment_id: mysqlId('TREATMENT.treatment_id'),
        test_order_id: mysqlId('TEST_ORDER.test_order_id'),
        prescription_id: mysqlId('PRESCRIPTION.prescription_id'),
        incident_no: { bsonType: 'string', pattern: '^INC-[0-9]{4}-[0-9]{4}$' },
      },
    },
  },
  allOf: [
    // signed or amended notes must record when they were signed
    { anyOf: [{ properties: { status: { enum: ['draft'] } } }, { required: ['signed_at'] }] },
    // an amended note must carry at least one amendment entry
    {
      anyOf: [
        { properties: { status: { enum: ['draft', 'signed'] } } },
        { required: ['amendments'], properties: { amendments: { minItems: 1 } } },
      ],
    },
  ],
};

module.exports = {
  SCHEMA_VERSION,
  ENUMS,
  validators: {
    incident_reports: incidentReports,
    observation_logs: observationLogs,
    clinical_notes: clinicalNotes,
  },
};
