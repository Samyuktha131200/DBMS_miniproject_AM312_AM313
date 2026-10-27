'use strict';

const { validators, ENUMS, SCHEMA_VERSION } = require('./validators');
const { indexes } = require('./indexes');

/** Collection names, used everywhere instead of string literals. */
const COLLECTION_NAMES = Object.freeze({
  incidentReports: 'incident_reports',
  observationLogs: 'observation_logs',
  clinicalNotes: 'clinical_notes',
});

/** Everything setup needs to create one collection. */
const COLLECTIONS = Object.values(COLLECTION_NAMES).map((name) => ({
  name,
  schema: validators[name],
  indexes: indexes[name],
}));

module.exports = { COLLECTION_NAMES, COLLECTIONS, ENUMS, SCHEMA_VERSION, validators, indexes };
