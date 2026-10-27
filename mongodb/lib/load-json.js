'use strict';

const fs = require('node:fs');

// Full ISO-8601 timestamps with a time zone, e.g. 2026-10-24T08:15:00+05:30
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** JSON.parse reviver: turns ISO timestamp strings into Date objects (stored as BSON dates). */
function reviveDates(_key, value) {
  if (typeof value === 'string' && ISO_DATE.test(value)) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return value;
}

/** Read a JSON array of sample documents, converting timestamps to Dates. */
function loadJsonDocuments(filePath) {
  const docs = JSON.parse(fs.readFileSync(filePath, 'utf8'), reviveDates);
  if (!Array.isArray(docs)) throw new Error(`${filePath} must contain a JSON array`);
  return docs;
}

module.exports = { ISO_DATE, reviveDates, loadJsonDocuments };
