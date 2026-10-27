'use strict';

/**
 * Index definitions, in the format accepted by collection.createIndexes().
 * Each index exists for a specific query the API or reports run; the
 * comment above it names that query.
 */

const indexes = {
  incident_reports: [
    // look up a report by its human-readable number; also blocks duplicates
    { key: { incident_no: 1 }, name: 'uniq_incident_no', unique: true },
    // "all incidents for case 3" (multikey index over the case_ids array)
    { key: { case_ids: 1 }, name: 'case_ids' },
    // incident trend reports: filter by category/type, newest first
    { key: { category: 1, incident_type: 1, occurred_at: -1 }, name: 'category_type_occurred' },
    // open / under-review work queue, newest first
    { key: { status: 1, occurred_at: -1 }, name: 'status_occurred' },
    // geospatial queries ($near / $geoWithin) for incident hotspots;
    // in-hospital incidents have no geo field and are simply not indexed
    { key: { 'location.geo': '2dsphere' }, name: 'location_geo_2dsphere' },
  ],

  observation_logs: [
    // main access pattern: a case's observations in time order.
    // unique also stops the same reading being saved twice (double submit)
    {
      key: { case_id: 1, observed_at: 1, source: 1 },
      name: 'uniq_case_observed_source',
      unique: true,
    },
    // department-wide time-window reports ("all observations in the last hour")
    { key: { observed_at: -1 }, name: 'observed_at' },
  ],

  clinical_notes: [
    // a case's notes, newest first
    { key: { case_id: 1, created_at: -1 }, name: 'case_created' },
    // full-text search over the note text (only one text index per collection)
    {
      key: { title: 'text', body: 'text', tags: 'text' },
      name: 'notes_text',
      weights: { title: 5, tags: 3, body: 1 },
      default_language: 'english',
    },
    // sign-off queue: only draft notes are indexed, so the index stays small
    {
      key: { created_at: 1 },
      name: 'draft_queue',
      partialFilterExpression: { status: { $eq: 'draft' } },
    },
    // "notes written by doctor 2"; staff-authored notes are left out of the index
    {
      key: { 'author.doctor_id': 1, created_at: -1 },
      name: 'author_doctor_created',
      partialFilterExpression: { 'author.doctor_id': { $exists: true } },
    },
  ],
};

module.exports = { indexes };
