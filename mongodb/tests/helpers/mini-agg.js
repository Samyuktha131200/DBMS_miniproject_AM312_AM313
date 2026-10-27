'use strict';

/**
 * A tiny evaluator for the aggregation operators used by the NEWS2 stages
 * and a matcher for the operators used by the red-flag filter. Lets the
 * unit tests run the GENERATED MongoDB expressions over the sample data
 * without a server. Approximation only: the integration tests run the
 * real thing.
 */

const MISSING = Symbol('missing');

const lookup = (doc, path) =>
  path.split('.').reduce((v, k) => (v === MISSING || v == null || !(k in Object(v)) ? MISSING : v[k]), doc);

const typeName = (v) => {
  if (v === MISSING) return 'missing';
  if (v === null) return 'null';
  if (typeof v === 'boolean') return 'bool';
  if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'double';
  if (typeof v === 'string') return 'string';
  if (v instanceof Date) return 'date';
  return Array.isArray(v) ? 'array' : 'object';
};

// BSON comparison order for the types that occur here: missing/null < numbers < strings < bool
const rank = (v) => (v === MISSING || v === null ? 0 : typeof v === 'number' ? 1 : typeof v === 'string' ? 2 : 3);
const cmp = (a, b) => (rank(a) !== rank(b) ? rank(a) - rank(b) : a < b ? -1 : a > b ? 1 : 0);
const norm = (v) => (v === MISSING ? null : v);

function evalExpr(expr, doc) {
  if (typeof expr === 'string') return expr.startsWith('$') ? lookup(doc, expr.slice(1)) : expr;
  if (expr === null || typeof expr !== 'object') return expr;
  if (Array.isArray(expr)) return expr.map((e) => norm(evalExpr(e, doc)));
  const keys = Object.keys(expr);
  if (keys.length === 1 && keys[0].startsWith('$')) {
    const [op] = keys;
    const arg = expr[op];
    const args = () => arg.map((a) => evalExpr(a, doc));
    switch (op) {
      case '$literal': return arg;
      case '$cond': {
        const [c, t, e] = Array.isArray(arg) ? arg : [arg.if, arg.then, arg.else];
        const v = evalExpr(c, doc);
        return v && v !== MISSING ? evalExpr(t, doc) : evalExpr(e, doc);
      }
      case '$switch': {
        for (const b of arg.branches) {
          const v = evalExpr(b.case, doc);
          if (v && v !== MISSING) return evalExpr(b.then, doc);
        }
        if (!('default' in arg)) throw new Error('$switch: no branch matched and no default');
        return evalExpr(arg.default, doc);
      }
      case '$type': return typeName(evalExpr(arg, doc));
      case '$eq': { const [a, b] = args(); return cmp(norm(a), norm(b)) === 0 && typeof norm(a) === typeof norm(b); }
      case '$lte': { const [a, b] = args(); return cmp(a, b) <= 0; }
      case '$lt': { const [a, b] = args(); return cmp(a, b) < 0; }
      case '$gte': { const [a, b] = args(); return cmp(a, b) >= 0; }
      case '$gt': { const [a, b] = args(); return cmp(a, b) > 0; }
      case '$in': { const [x, arr] = [evalExpr(arg[0], doc), evalExpr(arg[1], doc)]; return arr.some((y) => norm(y) === norm(x)); }
      case '$add': { const v = args().map(norm); return v.includes(null) ? null : v.reduce((s, x) => s + x, 0); }
      case '$subtract': { const [a, b] = args().map(norm); return a === null || b === null ? null : a - b; }
      case '$max': {
        const v = (Array.isArray(arg) ? args() : [evalExpr(arg, doc)]).map(norm).filter((x) => x !== null);
        return v.length ? Math.max(...v) : null;
      }
      default: throw new Error(`mini-agg: unsupported operator ${op}`);
    }
  }
  // embedded document of expressions
  return Object.fromEntries(keys.map((k) => [k, norm(evalExpr(expr[k], doc))]));
}

const setPath = (obj, path, value) => {
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts.slice(0, -1)) cur = cur[p] ??= {};
  cur[parts[parts.length - 1]] = value;
};

/** Apply a list of $set stages to one document. */
function applySetStages(stages, doc) {
  let out = structuredClone(doc);
  for (const stage of stages) {
    const [[name, spec]] = Object.entries(stage);
    if (name !== '$set') throw new Error(`mini-agg: unsupported stage ${name}`);
    const next = structuredClone(out);
    for (const [path, expr] of Object.entries(spec)) setPath(next, path, norm(evalExpr(expr, out)));
    out = next;
  }
  return out;
}

/** Does `doc` match a find() filter (subset: $or, $and, $lt, $lte, $gt, $gte, $in, $eq, equality)? */
function matches(filter, doc) {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === '$or') return cond.some((f) => matches(f, doc));
    if (key === '$and') return cond.every((f) => matches(f, doc));
    const v = lookup(doc, key);
    if (cond && typeof cond === 'object' && !Array.isArray(cond) && !(cond instanceof Date)) {
      return Object.entries(cond).every(([op, x]) => {
        if (v === MISSING) return false;
        const a = v instanceof Date ? v.getTime() : v;
        const b = x instanceof Date ? x.getTime() : x;
        switch (op) {
          case '$lt': return a < b;
          case '$lte': return a <= b;
          case '$gt': return a > b;
          case '$gte': return a >= b;
          case '$eq': return a === b;
          case '$in': return x.includes(v);
          default: throw new Error(`mini-agg: unsupported query operator ${op}`);
        }
      });
    }
    return v === cond;
  });
}

module.exports = { evalExpr, applySetStages, matches, MISSING };
