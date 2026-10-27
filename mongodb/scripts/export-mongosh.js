'use strict';

/**
 * Writes queries/queries.mongosh.js: every demo query from lib/demos.js in
 * plain mongosh syntax, for running in mongosh or pasting into Compass.
 * Generated from the same builders the app uses, so it cannot drift.
 *
 *   npm run export:mongosh
 */

const fs = require('node:fs');
const path = require('node:path');
const { demos, collectRefs, isRef, WRITE_TYPES } = require('../lib/demos');
const { DEFAULT_DB_NAME } = require('../lib/config');

const OUT_FILE = path.join(__dirname, '..', 'queries', 'queries.mongosh.js');
const IDENT = /^[A-Za-z_$][\w$]*$/;

/**
 * Serialize a value as mongosh JavaScript source.
 * `ints: true` writes integers as NumberInt(n) so documents written by
 * updates satisfy the validators' bsonType "int" rules.
 */
function toJs(value, { ints = false } = {}, indent = 0) {
  const pad = (n) => '  '.repeat(n);
  const inner = (v, i) => toJs(v, { ints }, i);
  if (value instanceof Date) return `ISODate("${value.toISOString()}")`;
  if (isRef(value)) return value.__ref;
  if (value === null) return 'null';
  if (typeof value === 'number') return ints && Number.isInteger(value) ? `NumberInt(${value})` : String(value);
  if (typeof value !== 'object') return JSON.stringify(value);

  const isArr = Array.isArray(value);
  const parts = isArr
    ? value.map((v) => inner(v, indent + 1))
    : Object.entries(value).map(([k, v]) => `${IDENT.test(k) ? k : JSON.stringify(k)}: ${inner(v, indent + 1)}`);
  const [open, close] = isArr ? ['[', ']'] : ['{', '}'];
  if (parts.length === 0) return `${open}${close}`;
  const oneLine = isArr ? `[${parts.join(', ')}]` : `{ ${parts.join(', ')} }`;
  if (oneLine.length + indent * 2 <= 90 && !oneLine.includes('\n')) return oneLine;
  return `${open}\n${parts.map((p) => `${pad(indent + 1)}${p}`).join(',\n')}\n${pad(indent)}${close}`;
}

/** Word-wrap text into // comment lines of at most ~78 characters. */
const comment = (text) =>
  text.split(/\s+/).reduce((lines, word) => {
    const last = lines[lines.length - 1];
    if (last !== undefined && `${last} ${word}`.length <= 75) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
    return lines;
  }, []).map((l) => `// ${l}`).join('\n');

function renderDemo(demo) {
  const query = demo.build();
  const c = `db.${query.collection}`;
  const head = `// ${'-'.repeat(74)}\n// ${demo.title}\n${comment(demo.purpose)}\nprint(${JSON.stringify(`\n${demo.title}`)});\n`;

  if (demo.type === 'find') {
    return `${head}printjson(\n  ${c}\n    .find(${toJs(query.filter, {}, 2)}, ${toJs(query.projection, {}, 2)})\n    .sort(${toJs(query.sort, {}, 2)})\n    .toArray()\n);\n`;
  }
  if (demo.type === 'aggregate') {
    return `${head}printjson(${c}.aggregate(${toJs(query.pipeline, {}, 0)}).toArray());\n`;
  }
  const lookups = [...collectRefs(query).values()]
    .map((r) => `  const ${r.__ref} = db.${r.collection}.findOne(${toJs(r.filter)})._id;\n`)
    .join('');
  const show = `db.${demo.show.collection}`;
  let body;
  if (demo.type === 'insert') {
    body =
      `  printjson(${c}.insertOne(${toJs(query.document, { ints: true }, 2)}));\n` +
      `  printjson(${show}.findOne(${toJs(demo.show.filter, { ints: true })}, { _id: 0 }));\n`;
  } else if (demo.type === 'delete') {
    body =
      `  print("before: " + ${show}.countDocuments(${toJs(demo.show.filter, { ints: true })}));\n` +
      `  printjson(${c}.${query.many ? 'deleteMany' : 'deleteOne'}(${toJs(query.filter, { ints: true }, 2)}));\n` +
      `  print("after: " + ${show}.countDocuments(${toJs(demo.show.filter, { ints: true })}));\n`;
  } else {
    body =
      `  printjson(${c}.updateOne(\n    ${toJs(query.filter, { ints: true }, 2)},\n    ${toJs(query.update, { ints: true }, 2)}\n  ));\n` +
      `  printjson(${show}.findOne(${toJs(demo.show.filter)}, { _id: 0 }));\n`;
  }
  return `${head}if (RUN_UPDATES) {\n${lookups}${body}}\n`;
}

function render() {
  const reads = demos.filter((d) => !WRITE_TYPES.includes(d.type)).map(renderDemo).join('\n');
  const writes = demos.filter((d) => WRITE_TYPES.includes(d.type)).map(renderDemo).join('\n');
  return `// GENERATED FILE - do not edit by hand. Regenerate with: npm run export:mongosh
// Source: lib/queries.js and lib/demos.js (the same code the API uses).
//
// Hospital Emergency Management System - MongoDB demo queries for mongosh.
// Run all read queries:
//   mongosh "mongodb://localhost:27017" queries/queries.mongosh.js
// Dates are stored in UTC; 2026-10-24T02:30:00Z is 08:00 IST.

db = db.getSiblingDB(${JSON.stringify(DEFAULT_DB_NAME)});

// Inserts, updates and deletes change the sample data. Set to true to run them, then restore
// the data afterwards with: npm run seed -- --reset
const RUN_UPDATES = false;

${reads}
// ${'='.repeat(74)}
// INSERTS, UPDATES AND DELETES (only run when RUN_UPDATES is true)
// ${'='.repeat(74)}

${writes}`;
}

if (require.main === module) {
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, render());
  console.log(`Wrote ${path.relative(process.cwd(), OUT_FILE)}`);
}

module.exports = { render, toJs, OUT_FILE };
