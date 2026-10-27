'use strict';

/** Shared helpers for printing query results and plans. */

/** Show dates in hospital local time (IST), e.g. 2026-10-24T08:15:00+05:30. */
function toIst(date) {
  const shifted = new Date(date.getTime() + 330 * 60000);
  return `${shifted.toISOString().slice(0, 19)}+05:30`;
}

/** JSON.stringify that prints Dates in IST and ObjectIds as strings. */
function pretty(value) {
  const prep = (v) => {
    if (v instanceof Date) return toIst(v);
    if (v && typeof v === 'object' && v._bsontype === 'ObjectId') return `ObjectId(${v.toHexString()})`;
    if (Array.isArray(v)) return v.map(prep);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, prep(x)]));
    return v;
  };
  return JSON.stringify(prep(value), null, 2);
}

/**
 * Pull the interesting bits out of an explain() result: which indexes were
 * used and whether any collection scan happened. Works for find and
 * aggregate plans because it simply walks the whole explain document.
 */
function summarizePlan(explain) {
  const indexes = new Set();
  const stages = new Set();
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (k === 'indexName' && typeof v === 'string') indexes.add(v);
      if (k === 'stage' && typeof v === 'string') stages.add(v);
      if (k === 'rejectedPlans') continue; // only the winning plan matters
      walk(v);
    }
  };
  walk(explain);
  return { indexes: [...indexes], collectionScan: stages.has('COLLSCAN'), stages: [...stages] };
}

/**
 * Like pretty(), but keeps small objects and arrays on one line
 * (used for the expected outputs in docs/QUERIES.md).
 */
function compactJson(value, indent = 0, width = 88) {
  const pad = (n) => '  '.repeat(n);
  if (value instanceof Date) return JSON.stringify(toIst(value));
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  const isArr = Array.isArray(value);
  const parts = isArr
    ? value.map((v) => compactJson(v, indent + 1, width))
    : Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}: ${compactJson(v, indent + 1, width)}`);
  const [open, close] = isArr ? ['[', ']'] : ['{', '}'];
  if (parts.length === 0) return `${open}${close}`;
  const oneLine = isArr ? `[${parts.join(', ')}]` : `{ ${parts.join(', ')} }`;
  if (oneLine.length + indent * 2 <= width && !oneLine.includes('\n')) return oneLine;
  return `${open}\n${parts.map((p) => `${pad(indent + 1)}${p}`).join(',\n')}\n${pad(indent)}${close}`;
}

module.exports = { toIst, pretty, compactJson, summarizePlan };
