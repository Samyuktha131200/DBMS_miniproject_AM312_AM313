'use strict';

/**
 * A small checker for the subset of MongoDB's $jsonSchema used in
 * schema/validators.js. It lets the tests check sample data and the
 * validation rules WITHOUT a running MongoDB server.
 *
 * It follows MongoDB's behaviour for bsonType: JavaScript integers in the
 * 32-bit range are "int" (that is how the Node.js driver stores them),
 * other numbers are "double", and "number" matches any numeric type.
 * It is an approximation: the real check is the server-side validator,
 * which the integration tests exercise against a live MongoDB.
 */

const NUMERIC = ['int', 'long', 'double', 'decimal'];

function bsonTypeOf(value) {
  if (value === null) return 'null';
  if (value instanceof Date) return 'date';
  if (Array.isArray(value)) return 'array';
  switch (typeof value) {
    case 'boolean': return 'bool';
    case 'string': return 'string';
    case 'bigint': return 'long';
    case 'number':
      return Number.isInteger(value) && value >= -2147483648 && value <= 2147483647 ? 'int' : 'double';
    case 'object':
      if (value._bsontype === 'ObjectId' || value._bsontype === 'ObjectID') return 'objectId';
      return 'object';
    default: return 'unknown';
  }
}

const typeMatches = (actual, expected) =>
  expected === 'number' ? NUMERIC.includes(actual) : actual === expected;

const same = (a, b) => {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return JSON.stringify(a) === JSON.stringify(b);
};

/** Returns a list of error strings; empty means the value is valid. */
function validate(schema, value, path = '$') {
  const errors = [];
  const type = bsonTypeOf(value);
  const err = (msg) => errors.push(`${path}: ${msg}`);

  if (schema.bsonType !== undefined) {
    const allowed = [].concat(schema.bsonType);
    if (!allowed.some((t) => typeMatches(type, t))) {
      err(`expected bsonType ${allowed.join('|')}, got ${type}`);
      return errors; // other keywords are meaningless on the wrong type
    }
  }
  if (schema.enum && !schema.enum.some((e) => same(e, value))) {
    err(`value ${JSON.stringify(value)} not in enum ${JSON.stringify(schema.enum)}`);
  }

  if (NUMERIC.includes(type)) {
    if (schema.minimum !== undefined && value < schema.minimum) err(`${value} < minimum ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) err(`${value} > maximum ${schema.maximum}`);
    if (schema.multipleOf !== undefined && value % schema.multipleOf !== 0) err(`not a multiple of ${schema.multipleOf}`);
  }

  if (type === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) err(`shorter than ${schema.minLength}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) err(`longer than ${schema.maxLength}`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) err(`does not match ${schema.pattern}`);
  }

  if (type === 'array') {
    if (schema.minItems !== undefined && value.length < schema.minItems) err(`fewer than ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) err(`more than ${schema.maxItems} items`);
    if (schema.uniqueItems && new Set(value.map((v) => JSON.stringify(v))).size !== value.length) err('items not unique');
    if (Array.isArray(schema.items)) {
      schema.items.forEach((s, i) => {
        if (i < value.length) errors.push(...validate(s, value[i], `${path}[${i}]`));
      });
      if (schema.additionalItems === false && value.length > schema.items.length) err('too many items for tuple');
    } else if (schema.items) {
      value.forEach((v, i) => errors.push(...validate(schema.items, v, `${path}[${i}]`)));
    }
  }

  if (type === 'object') {
    const keys = Object.keys(value);
    for (const r of schema.required || []) if (!(r in value)) err(`missing required field "${r}"`);
    if (schema.minProperties !== undefined && keys.length < schema.minProperties) err(`fewer than ${schema.minProperties} fields`);
    if (schema.maxProperties !== undefined && keys.length > schema.maxProperties) err(`more than ${schema.maxProperties} fields`);
    const props = schema.properties || {};
    for (const k of keys) {
      if (props[k]) errors.push(...validate(props[k], value[k], `${path}.${k}`));
      else if (schema.additionalProperties === false) err(`unexpected field "${k}"`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        errors.push(...validate(schema.additionalProperties, value[k], `${path}.${k}`));
      }
    }
  }

  if (schema.allOf) schema.allOf.forEach((s) => errors.push(...validate(s, value, path)));
  if (schema.anyOf && !schema.anyOf.some((s) => validate(s, value, path).length === 0)) {
    err('matches none of anyOf');
  }
  if (schema.oneOf) {
    const n = schema.oneOf.filter((s) => validate(s, value, path).length === 0).length;
    if (n !== 1) err(`matches ${n} of oneOf (expected exactly 1)`);
  }
  if (schema.not && validate(schema.not, value, path).length === 0) err('matches "not" schema');

  return errors;
}

module.exports = { validate, bsonTypeOf };
