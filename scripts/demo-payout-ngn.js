#!/usr/bin/env node
/**
 * BOS DEMO — Nigeria Payout (USDCx → NGN via yellowcard) reproduction runner.
 *
 * DEMO_MODE (default): every external dependency (Stacks, xReserve, Yellow Card)
 * is simulated inside this process. The real Sprint 5 v1 API, state machine,
 * guards, actions, evidence recorders and receipt generator run unmodified;
 * only the ledger and the external world are simulated, and every trace is
 * labelled DEMO / (simulated).
 *
 * SANDBOX_MODE (--mode=sandbox): evaluates the per-leg credential matrix. With
 * no credentials it reports each missing leg and exits 2 without running.
 *
 * Exit codes: 0 = DEMO success; 2 = SANDBOX incomplete; 1 = unexpected error.
 */

import { createServer as createNetServer } from 'node:net';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

const args = process.argv.slice(2);
function argValue(name, dflt) {
  const hit = args.find((a) => a.startsWith(`--${name}=`)) || args.find((a) => a === `--${name}`);
  if (!hit) return dflt;
  const eq = hit.indexOf('=');
  return eq >= 0 ? hit.slice(eq + 1) : args[args.indexOf(hit) + 1] || dflt;
}
const MODE = String(argValue('mode', 'demo')).toLowerCase();
const OUTPUT_DIR = argValue('output-dir', join(REPO_ROOT, 'demo-output'));

const BANNER_LINE = '===============================================================================';

function fail(msg, code = 1) {
  console.error(`[demo] ${msg}`);
  process.exitCode = code;
}

function resolveCreds() {
  const e = process.env;
  const yellowCardEnv = e.YELLOW_CARD_ENV;
  const rows = [
    ['stacks', 'PAYOUT_TX_SIGNING_KEY', !!(e.PAYOUT_TX_SIGNING_KEY && String(e.PAYOUT_TX_SIGNING_KEY).length)],
    ['xreserve', 'XRESERVE_PROTOCOL_CONTRACT', !!(e.XRESERVE_PROTOCOL_CONTRACT && String(e.XRESERVE_PROTOCOL_CONTRACT).length)],
    ['yellowcard', 'YELLOW_CARD_API_KEY', !!(e.YELLOW_CARD_API_KEY && String(e.YELLOW_CARD_API_KEY).length)],
    ['yellowcard', 'YELLOW_CARD_SECRET_KEY', !!(e.YELLOW_CARD_SECRET_KEY && String(e.YELLOW_CARD_SECRET_KEY).length)],
    ['yellowcard', 'YELLOW_CARD_ENV (=sandbox)', String(yellowCardEnv || '').toLowerCase() === 'sandbox'],
  ];
  const missingLegs = [...new Set(rows.filter(([, , ok]) => !ok).map(([leg]) => leg))];
  const productionLeg = String(yellowCardEnv || '').toLowerCase() === 'production';
  return { rows, missingLegs, productionLeg, yellowCardEnv };
}

function runSandboxMatrix() {
  console.log(BANNER_LINE);
  console.log(' PAYOUT RAIL — SANDBOX MODE (real sandbox services)');
  console.log(BANNER_LINE);
  const { rows, missingLegs, productionLeg, yellowCardEnv } = resolveCreds();
  console.log('');
  console.log(' leg         credential                    present?');
  for (const [leg, name, ok] of rows) {
    console.log(` ${leg.padEnd(11)} ${name.padEnd(30)} ${ok ? 'YES' : 'NO'}`);
  }
  console.log('');
  if (productionLeg) {
    console.log(` refusing to run: YELLOW_CARD_ENV=${String(yellowCardEnv || '').toUpperCase()} — SANDBOX_MODE never runs against production Yellow Card.`);
  }
  console.log(` verification cannot be reported for: ${missingLegs.join(', ') || '(none)'}`);
  console.log(' SANDBOX_MODE requires sandbox credentials that are not present —');
  console.log(' nothing was run; success was not fabricated');
  process.exitCode = 2;
}

if (MODE === 'sandbox') {
  const { missingLegs, productionLeg } = resolveCreds();
  if (missingLegs.length === 0 && !productionLeg) {
    fail('live sandbox execution is out of scope in this runner (G-20 blocks live Yellow Card verification); nothing was run');
  } else {
    runSandboxMatrix();
  }
  process.exit(2);
}

if (MODE !== 'demo') {
  fail(`unknown mode '${MODE}' (expected demo or sandbox)`);
  process.exit(1);
}

const DEMO_TOKEN = 'demo-token-0123456789abcdef';
const DEMO_BODY = {
  source_reference: 'demo-ngn-001',
  source_application: 'demo-runner',
  amount_usd: 25,
  amount_usdcx: 25_000_000,
  creator_address: 'SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7',
  creator_btc_address: 'bc1qexample000000000000000000000000000000000',
  recipient_bank_account: '0123456789',
  recipient_bank_code: '044',
  ngn_recipient: { bankCode: '044', accountNumber: '0123456789' },
};

function isoNow() {
  return new Date().toISOString();
}

async function probeLoopbackPort() {
  return new Promise((resolve, reject) => {
    const srv = createNetServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      const port = String(address && address.port || 0);
      srv.close(() => resolve(port));
    });
  });
}

const tables = new Map();
const ids = new Map();

function ensureTable(name) {
  if (!tables.has(name)) tables.set(name, []);
  return tables.get(name);
}

function registerColumns(name, cols) {
  if (!tables.has(name) || !tables.get(name).schema) {
    ensureTable(name);
    tables.get(name).schema = new Set();
  }
  const schema = tables.get(name).schema;
  for (const c of cols) schema.add(c);
}

function nextId(name) {
  const current = ids.get(name) || 0;
  ids.set(name, current + 1);
  return current + 1;
}

function fillDefaults(name, cols, row) {
  const schema = tables.get(name) && tables.get(name).schema;
  if (!schema) return row;
  for (const c of schema) {
    if (row[c] === undefined) {
      row[c] = null;
    }
  }
  return row;
}

function seed(name, rows) {
  const table = ensureTable(name);
  registerColumns(name, Object.keys(rows[0] || {}));
  for (const row of rows) {
    const copy = { ...row };
    if (copy.id === undefined) copy.id = nextId(name);
    table.push(fillDefaults(name, Object.keys(copy), copy));
  }
  ids.set(name, Math.max(...table.map((r) => Number(r.id) || 0)));
}

function unquoteIdent(ident) {
  return ident.replace(/^"|"$/g, '').replace(/\bd\.(?=[A-Za-z_])/g, '');
}

function stripOuterParens(str) {
  const s = str.trim();
  if (!s.startsWith('(')) return s;
  let depth = 0;
  let inQuote = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === "'" || ch === '"') inQuote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0 && i !== s.length - 1) return s;
    }
  }
  return s.slice(1, -1).trim();
}

function splitTopLevel(str, sepChar) {
  const out = [];
  let depth = 0;
  let inQuote = null;
  let cur = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (inQuote) {
      cur += ch;
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      inQuote = ch;
      cur += ch;
    } else if (ch === '(') {
      depth++;
      cur += ch;
    } else if (ch === ')') {
      depth--;
      cur += ch;
    } else if (depth === 0 && ch === sepChar) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function splitTopLevelAnd(str) {
  const out = [];
  let depth = 0;
  let inQuote = null;
  let cur = '';
  for (let i = 0; i < str.length; i++) {
    let ch = str[i];
    if (inQuote) {
      cur += ch;
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      inQuote = ch;
      cur += ch;
    } else if (ch === '(') {
      depth++;
      cur += ch;
    } else if (ch === ')') {
      depth--;
      cur += ch;
    } else if (depth === 0 && /[Aa][Nn][Dd]/.test(str.slice(i, i + 3))) {
      const before = str.slice(0, i);
      const isWord = !/[A-Za-z0-9_]/.test(before[before.length - 1] || ' ');
      if (isWord) {
        out.push(cur);
        cur = '';
        i += 2;
      } else {
        cur += ch;
      }
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function findTopLevelKeyword(str, words) {
  let depth = 0;
  let inQuote = null;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      inQuote = ch;
      continue;
    }
    if (ch === '(') {
      depth++;
      continue;
    }
    if (ch === ')') {
      depth--;
      continue;
    }
    if (depth !== 0) continue;
    for (const w of words) {
      if (str.slice(i, i + w.length).toLowerCase() === w) {
        const before = str[i - 1];
        const after = str[i + w.length];
        if (!/[A-Za-z0-9_]/.test(before || ' ') && !/[A-Za-z0-9_]/.test(after || ' ')) {
          return i;
        }
      }
    }
  }
  return -1;
}

function extractTableParenList(str, keywordIndex) {
  const head = str.slice(keywordIndex).replace(/^\s+/i, '');
  const open = str.indexOf('(', keywordIndex);
  if (open < 0) return null;
  const depthCount = { open: 0, close: 0 };
  let close = -1;
  let inQuote = null;
  for (let i = open; i < str.length; i++) {
    const ch = str[i];
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === "'" || ch === '"') inQuote = ch;
    else if (ch === '(') depthCount.open++;
    else if (ch === ')') {
      depthCount.close++;
      if (depthCount.open === depthCount.close) {
        close = i;
        break;
      }
    }
  }
  if (close < 0) return null;
  return str.slice(open + 1, close);
}

function splitStatements(sql) {
  const out = [];
  let depth = 0;
  let inQuote = null;
  let cur = '';
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (inQuote) {
      cur += ch;
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      inQuote = ch;
      cur += ch;
    } else if (ch === '(') {
      depth++;
      cur += ch;
    } else if (ch === ')') {
      depth--;
      cur += ch;
    } else if (ch === ';' && depth === 0) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function normalizeStatement(stmt) {
  return stmt
    .replace(/\$(\d+)/g, '?')
    .replace(/"(?!\s*$)/g, '')
    .replace(/\b(d)\.(?=[A-Za-z_])/g, '$1.')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveExpr(expr, params, ctx) {
  const e = String(expr).trim();
  if (e === '?') return params.shift();
  if (e === 'NULL') return null;
  if (e === 'TRUE') return true;
  if (e === 'FALSE') return false;
  if (e === 'NOW()') return isoNow();
  const intervalM = e.match(/^NOW\(\)\s*([+-])\s*INTERVAL\s*'(\d+)\s+(\w+)'$/i);
  if (intervalM) {
    const sign = intervalM[1] === '-' ? -1 : 1;
    const n = Number(intervalM[2]);
    const unit = intervalM[3].toLowerCase().replace(/s$/, '');
    const mult = unit === 'day' ? 86400e3 : unit === 'hour' ? 3600e3 : unit === 'minute' ? 60e3 : unit === 'second' ? 1e3 : 1e3;
    return new Date(Date.now() + sign * n * mult).toISOString();
  }
  const mStr = e.match(/^'((?:[^']|'')*)'$/);
  if (mStr) return mStr[1].replace(/''/g, "'");
  if (/^-?\d+(\.\d+)?$/.test(e)) return Number(e);
  if (e.toUpperCase().startsWith('(SELECT')) {
    const inner = stripOuterParens(e);
    const stmt = parseExecute(inner, []);
    const row = stmt.rows[0];
    if (!row) return null;
    const keys = Object.keys(row);
    return keys.length ? row[keys[0]] : null;
  }
  throw new Error(`unsupported expression: ${e}`);
}

function resolvePredicate(seg, params) {
  const s = stripOuterParens(seg).trim();
  const isNullM = s.match(/^([A-Za-z0-9_.]+)\s+(IS\s+NOT\s+NULL|IS\s+NULL)$/i);
  if (isNullM) {
    return {
      col: unquoteIdent(isNullM[1]),
      op: isNullM[2].toUpperCase().replace(/\s+/g, ' ') === 'IS NULL' ? 'IS NULL' : 'IS NOT NULL',
      rhs: null,
    };
  }
  const notInM = s.match(/^([A-Za-z0-9_.]+)\s+NOT\s+IN\s*\((.*)\)$/i);
  if (notInM) {
    const inner = splitTopLevel(notInM[2], ',').map((x) => x.trim()).filter(Boolean);
    const list = inner.map((x) => (x === '?' ? resolveExpr(x, params, {}) : parseLiteral(x)));
    return { col: unquoteIdent(notInM[1]), op: 'NOT IN', rhs: list };
  }
  const inM = s.match(/^([A-Za-z0-9_.]+)\s+IN\s*\((.*)\)$/i);
  if (inM) {
    const inner = splitTopLevel(inM[2], ',').map((x) => x.trim()).filter(Boolean);
    const list = inner.map((x) => (x === '?' ? resolveExpr(x, params, {}) : parseLiteral(x)));
    return { col: unquoteIdent(inM[1]), op: 'IN', rhs: list };
  }
  const opM = s.match(/^([A-Za-z0-9_.]+)\s*(<>|!=|>=|<=|=|>|<)\s*(.*)$/i);
  if (!opM) throw new Error(`unsupported predicate: ${s}`);
  const rhsExpr = opM[3].trim();
  const rhs = rhsExpr === '?' ? params.shift() : resolveExpr(rhsExpr, params, {});
  return { col: unquoteIdent(opM[1]), op: opM[2], rhs };
}

function parseLiteral(x) {
  const e = String(x).trim();
  if (e === 'NULL') return null;
  const mStr = e.match(/^'((?:[^']|'')*)'$/);
  if (mStr) return mStr[1].replace(/''/g, "'");
  if (/^-?\d+(\.\d+)?$/.test(e)) return Number(e);
  return e;
}

function evalPred(row, pred) {
  let lhs = row[pred.col];
  const { op, rhs } = pred;
  const eq = (a, b) => {
    if (a === null || a === undefined || b === null || b === undefined) return a === b;
    if (typeof a === 'number' && typeof b === 'number') return a === b;
    return String(a) === String(b);
  };
  const numeric = (v) => {
    if (v === null || v === undefined) return NaN;
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return new Date(v).getTime();
    const n = Number(v);
    return Number.isNaN(n) ? NaN : n;
  };
  const cmp = (a, b) => {
    const na = numeric(a);
    const nb = numeric(b);
    if (Number.isNaN(na) || Number.isNaN(nb)) return null;
    return na - nb;
  };
  switch (op) {
    case 'IS NULL': return lhs === null || lhs === undefined;
    case 'IS NOT NULL': return lhs !== null && lhs !== undefined;
    case 'IN': return rhs.some((v) => eq(lhs, v));
    case 'NOT IN': return !rhs.some((v) => eq(lhs, v));
    case '=': return eq(lhs, rhs);
    case '<>':
    case '!=': return !eq(lhs, rhs);
    case '>': { const d = cmp(lhs, rhs); return d !== null && d > 0; }
    case '>=': { const d = cmp(lhs, rhs); return d !== null && d >= 0; }
    case '<': { const d = cmp(lhs, rhs); return d !== null && d < 0; }
    case '<=': { const d = cmp(lhs, rhs); return d !== null && d <= 0; }
    default: return false;
  }
}

function parseOrderBy(orderStr) {
  const items = splitTopLevel(orderStr, ',').map((x) => x.trim()).filter(Boolean);
  return items.map((item) => {
    const parts = item.split(/\s+/);
    const col = unquoteIdent(parts[0]);
    const dir = String(parts[1] || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    return { col, dir };
  });
}

function sortRows(rows, orderBy) {
  if (!orderBy || !orderBy.length) return rows;
  const list = rows.slice();
  list.sort((a, b) => {
    for (const { col, dir } of orderBy) {
      const av = a[col];
      const bv = b[col];
      let cmp = 0;
      if (av === bv) cmp = 0;
      else if (av === null || av === undefined) cmp = -1;
      else if (bv === null || bv === undefined) cmp = 1;
      else if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
      else cmp = String(av) < String(bv) ? -1 : String(av) > String(bv) ? 1 : 0;
      if (dir === 'DESC') cmp = -cmp;
      if (cmp !== 0) return cmp;
    }
    return 0;
  });
  return list;
}

function parseSelectItems(selStr) {
  const items = splitTopLevel(selStr, ',').map((x) => x.trim()).filter(Boolean);
  return items.map((raw) => {
    if (raw === '*' || raw === 'd.*') return { all: true, alias: null };
    const agg = raw.match(/^(COUNT\(\s*\*\s*\)|SUM\(([A-Za-z0-9_.]+)\)|COALESCE\(\s*SUM\(([A-Za-z0-9_.]+)\)\s*,\s*([0-9-]+)\s*\))\s*(?:AS\s+)?([A-Za-z0-9_]+)?$/i);
    if (agg) {
      const isCount = /^COUNT/.test(agg[1]);
      const col = agg[2] || agg[3] || null;
      const dflt = agg[4] !== undefined ? Number(agg[4]) : 0;
      return { agg: isCount ? 'count' : 'sum', col, dflt, alias: agg[5] || null };
    }
    const asM = raw.match(/^([A-Za-z0-9_.]+)\s+(?:AS\s+)?([A-Za-z0-9_]+)$/i);
    if (asM) return { col: unquoteIdent(asM[1]), alias: asM[2] };
    return { col: unquoteIdent(raw), alias: null };
  });
}

function executeSelect(stmt, parsed) {
  const table = ensureTable(stmt.table);
  let rows = table.slice();
  for (const pred of stmt.resolvedPredicates || []) rows = rows.filter((r) => evalPred(r, pred));
  if (parsed.orderBy && parsed.orderBy.length) rows = sortRows(rows, parsed.orderBy);
  const limit = parsed.limit !== undefined ? Number(parsed.limit) : null;
  const offset = parsed.offset !== undefined ? Number(parsed.offset) : 0;
  if (limit !== null) rows = rows.slice(offset, offset + limit);
  else if (offset) rows = rows.slice(offset);

  const isAgg = stmt.selectItems.some((it) => it.agg);
  if (isAgg) {
    const row = {};
    for (const it of stmt.selectItems) {
      const alias = it.alias || (it.col ? it.col : 'total');
      if (it.agg === 'count') row[alias] = rows.length;
      else if (it.agg === 'sum') {
        const sum = rows.reduce((acc, r) => {
          const v = r[it.col];
          return typeof v === 'number' ? acc + v : acc;
        }, 0);
        row[alias] = it.dflt !== undefined && sum === 0 && rows.length === 0 ? it.dflt : sum;
      } else {
        const first = rows[0];
        row[alias] = first ? first[it.col] : null;
      }
    }
    return { rows: [row] };
  }

  const schema = (tables.get(stmt.table) || {}).schema;
  const mapped = rows.map((r) => {
    if (stmt.selectItems.some((it) => it.all)) {
      const out = {};
      if (schema) for (const c of schema) out[c] = r[c];
      else Object.assign(out, r);
      return out;
    }
    const out = {};
    for (const it of stmt.selectItems) {
      if (it.agg) continue;
      const value = r[it.col];
      if (it.alias) out[it.alias] = value;
      else out[it.col] = value;
    }
    return out;
  });
  return { rows: mapped };
}

function findConflictKey(stmt) {
  if (stmt.conflictCols && stmt.conflictCols.length) return stmt.conflictCols;
  return stmt.insertCols.includes('idempotency_key') ? ['idempotency_key'] : ['id'];
}

function parseUpdateSet(setStr) {
  const items = splitTopLevel(setStr, ',').map((x) => x.trim()).filter(Boolean);
  return items.map((item) => {
    const eqIdx = item.indexOf('=');
    const col = unquoteIdent(item.slice(0, eqIdx).trim());
    const raw = item.slice(eqIdx + 1).trim();
    const arith = raw.match(/^([a-z0-9_.]+)\s*\+\s*(\d+)$/i);
    if (arith) return { col, expr: { arith: true, col: unquoteIdent(arith[1]), add: Number(arith[2]) } };
    const mergeM = raw.match(/^([a-z0-9_.]+)\.([a-z0-9_]+)\s*\|\|\s*EXCLUDED\.([a-z0-9_]+)$/i);
    if (mergeM) return { col, expr: { merge: true, leftCol: mergeM[2], rightCol: mergeM[3] } };
    if (/^EXCLUDED\./.test(raw)) return { col, expr: { excluded: unquoteIdent(raw.replace(/^EXCLUDED\./, '')) } };
    return { col, expr: { raw } };
  });
}

function asJson(val) {
  if (val === null || val === undefined) return {};
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return {}; }
}

function mergeJson(existing, expr, incoming) {
  const base = asJson(existing[expr.leftCol]);
  const patch = asJson(incoming[expr.rightCol]);
  return Object.assign({}, base, patch);
}

function parseStatement(normalizedSql) {
  const lower = normalizedSql.toLowerCase();
  const stmt = { type: null, table: null, sql: normalizedSql };
  if (lower.startsWith('create table')) {
    stmt.type = 'CREATE';
    const m = normalizedSql.match(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_]+)\s*\((.*)\)\s*$/is);
    stmt.table = m ? m[1] : null;
    const body = m ? m[2] : '';
    const rawCols = splitTopLevel(body, ',').map((x) => x.trim()).filter(Boolean);
    const cols = [];
    for (const raw of rawCols) {
      const keyM = raw.match(/^PRIMARY\s+KEY\s*\((.*)\)$/i);
      if (keyM) continue;
      const nameM = raw.match(/^([A-Za-z0-9_]+)/i);
      if (nameM) cols.push(nameM[1]);
    }
    stmt.columns = cols;
    return stmt;
  }
  if (lower.startsWith('insert into')) {
    stmt.type = 'INSERT';
    const conflictIdx = findTopLevelKeyword(normalizedSql, ['on conflict']);
    const base = conflictIdx >= 0 ? normalizedSql.slice(0, conflictIdx) : normalizedSql;
    const im = base.match(/^INSERT\s+INTO\s+([A-Za-z0-9_]+)\s*\((.*?)\)\s*VALUES\s*\((.*)\)\s*$/is);
    if (!im) throw new Error(`unsupported INSERT: ${normalizedSql}`);
    stmt.table = im[1];
    stmt.insertCols = splitTopLevel(im[2], ',').map((x) => unquoteIdent(x.trim())).filter(Boolean);
    stmt.valueExprs = splitTopLevel(im[3], ',').map((x) => x.trim()).filter(Boolean);
    const onConflict = conflictIdx >= 0 ? normalizedSql.slice(conflictIdx) : '';
    if (/DO\s+NOTHING/i.test(onConflict)) stmt.conflictAction = 'nothing';
    else if (/DO\s+UPDATE/i.test(onConflict)) stmt.conflictAction = 'update';
    const ck = onConflict.match(/ON\s+CONFLICT\s*\(([^)]*)\)/i);
    if (ck) stmt.conflictCols = splitTopLevel(ck[1], ',').map((x) => unquoteIdent(x.trim())).filter(Boolean);
    if (stmt.conflictAction === 'update') {
      const setIdx = findTopLevelKeyword(onConflict, ['set']);
      if (setIdx >= 0) {
        const setStr = onConflict.slice(setIdx + 3).trim();
        stmt.conflictSets = parseUpdateSet(setStr);
      }
    }
    return stmt;
  }
  if (lower.startsWith('update')) {
    stmt.type = 'UPDATE';
    const setIdx = findTopLevelKeyword(normalizedSql, ['set']);
    if (setIdx < 0) throw new Error(`unsupported UPDATE: ${normalizedSql}`);
    const tableMatch = normalizedSql.match(/^UPDATE\s+([A-Za-z0-9_]+)\s+(?:SET|D?\.?)/i) || normalizedSql.match(/^UPDATE\s+([A-Za-z0-9_]+)\s/i);
    stmt.table = tableMatch ? tableMatch[1] : null;
    const whereIdx = findTopLevelKeyword(normalizedSql, ['where', 'returning']);
    const setEnd = whereIdx >= 0 ? whereIdx : normalizedSql.length;
    stmt.sets = parseUpdateSet(normalizedSql.slice(setIdx + 3, setEnd));
    if (whereIdx >= 0 && /^where\b/i.test(normalizedSql.slice(whereIdx))) {
      const retIdx = normalizedSql.toLowerCase().indexOf(' returning ', whereIdx);
      const whereStr = normalizedSql.slice(whereIdx + 5, retIdx >= 0 ? retIdx : normalizedSql.length);
      stmt.setsPredicates = splitTopLevelAnd(whereStr).map((x) => x.trim()).filter(Boolean);
    }
    return stmt;
  }
  if (lower.startsWith('delete')) {
    stmt.type = 'DELETE';
    stmt.table = (normalizedSql.match(/^DELETE\s+FROM\s+([A-Za-z0-9_]+)/i) || [])[1] || null;
    return stmt;
  }
  stmt.type = 'SELECT';
  const fromIdx = findTopLevelKeyword(normalizedSql, ['from']);
  if (fromIdx < 0) throw new Error(`unsupported statement: ${normalizedSql}`);
  stmt.selectRaw = normalizedSql.slice('select'.length, fromIdx).trim();
  if (/^distinct\b/i.test(stmt.selectRaw)) {
    stmt.distinct = true;
    stmt.selectRaw = stmt.selectRaw.replace(/^distinct\s+/i, '');
  }
  const tableM = normalizedSql.slice(fromIdx + 4).match(/^\s*([A-Za-z0-9_]+)/i);
  stmt.table = tableM ? tableM[1] : null;
  let tail = normalizedSql.slice(fromIdx + 4 + (tableM ? tableM[1].length : 0));
  const whereIdx = findTopLevelKeyword(tail, ['where']);
  let orderIdx = -1;
  if (whereIdx >= 0) orderIdx = findTopLevelKeyword(tail.slice(whereIdx), ['order', 'limit', 'offset']);
  const limitIdx = findTopLevelKeyword(tail, ['limit']);
  const offsetIdx = findTopLevelKeyword(tail, ['offset']);
  let whereStr = '';
  const searchFrom = whereIdx >= 0 ? whereIdx : 0;
  const endOfWhere = orderIdx >= 0 ? whereIdx + orderIdx : tail.length;
  if (whereIdx >= 0) whereStr = tail.slice(whereIdx + 5, Math.min(orderIdx >= 0 ? whereIdx + orderIdx : tail.length, limitIdx >= 0 ? limitIdx : tail.length, offsetIdx >= 0 ? offsetIdx : tail.length));
  stmt.wherePredicates = splitTopLevelAnd(whereStr).map((x) => (x || '').trim()).filter(Boolean);
  const orderM = tail.match(/ORDER\s+BY\s+([A-Za-z0-9_.,\s]+?)(?:\s+LIMIT|\s+OFFSET|$)/i);
  if (orderM) stmt.orderBy = parseOrderBy(orderM[1]);
  const limM = tail.match(/LIMIT\s+(\d+)(?:\s+OFFSET\s+(\d+))?/i);
  if (limM) {
    stmt.limit = Number(limM[1]);
    if (limM[2]) stmt.offset = Number(limM[2]);
  }
  stmt.selectItems = parseSelectItems(stmt.selectRaw);
  return stmt;
}

function resolveCaseExpr(set, bound) {
  const raw = set.expr.raw;
  const m = raw.match(/^CASE\s+WHEN\s+([A-Za-z0-9_."?]+)\s*=\s*([A-Za-z0-9_."?]+)\s+THEN\s+([A-Za-z0-9_.]+)\s*\+\s*(\d+)\s+ELSE\s+([A-Za-z0-9_.]+)\s+END$/i);
  if (!m) return false;
  const lhsRaw = m[1].trim();
  const rhsRaw = m[2].trim();
  set.expr.caseWhen = {
    lhsCol: lhsRaw === '?' ? null : unquoteIdent(lhsRaw),
    lhsParam: lhsRaw === '?' ? bound.shift() : undefined,
    rhsParam: rhsRaw === '?' ? bound.shift() : (rhsRaw === 'NULL' ? null : rhsRaw),
    thenCol: unquoteIdent(m[3]),
    add: Number(m[4]),
    elseCol: unquoteIdent(m[5]),
  };
  set.expr.caseRaw = true;
  return true;
}

function parseAndResolve(stmt, params) {
  const bound = [...(stmt.boundValues || params)];
  if (stmt.type === 'INSERT') {
    stmt.valueResolved = stmt.valueExprs.map((e) => resolveExpr(e, bound, {}));
    return;
  }
  if (stmt.type === 'UPDATE') {
    for (let i = 0; i < stmt.sets.length; i++) {
      const set = stmt.sets[i];
      if (set.expr.raw === '?') set.expr.resolvedParam = bound.shift();
      else if (set.expr.raw !== undefined && !set.expr.arith && !set.expr.merge && !set.expr.excluded) {
        resolveCaseExpr(set, bound);
      }
    }
    stmt.resolvedSetsPredicates = (stmt.setsPredicates || []).map((seg) => resolvePredicate(seg, bound));
    return;
  }
  if (stmt.type === 'SELECT') {
    stmt.resolvedPredicates = (stmt.wherePredicates || []).map((seg) => resolvePredicate(seg, bound));
    return;
  }
}

function executeStatement(stmt, params) {
  parseAndResolve(stmt, params);
  switch (stmt.type) {
    case 'CREATE':
      ensureTable(stmt.table);
      registerColumns(stmt.table, stmt.columns || []);
      return { changes: 0, rows: [] };
    case 'INSERT': {
      const table = ensureTable(stmt.table);
      registerColumns(stmt.table, stmt.insertCols);
      const row = {};
      stmt.insertCols.forEach((col, i) => {
        if (i < stmt.valueResolved.length) row[col] = stmt.valueResolved[i];
      });
      if (row.id === undefined || row.id === null) row.id = nextId(stmt.table);
      if (row.created_at === undefined) row.created_at = isoNow();
      if (row.updated_at === undefined) row.updated_at = isoNow();
      if (stmt.conflictCols) {
        const conflictKey = findConflictKey(stmt);
        const existing = table.find((r) => conflictKey.every((k) => String(r[k]) === String(row[k])));
        if (existing) {
          if (stmt.conflictAction === 'update') {
            registerColumns(stmt.table, (stmt.conflictSets || []).map((s) => s.col));
            for (const { col, expr } of stmt.conflictSets || []) {
              if (expr.raw === 'NOW()') existing[col] = isoNow();
              else if (expr.merge) existing[col] = mergeJson(existing, expr, row);
              else if (expr.excluded) existing[col] = row[expr.excluded];
              else if (expr.raw === '?') existing[col] = expr.resolvedParam;
              else existing[col] = parseLiteral(expr.raw);
            }
          }
          return { changes: 0, rows: [] };
        }
      }
      table.push(fillDefaults(stmt.table, Object.keys(row), row));
      if (Number(row.id) > (ids.get(stmt.table) || 0)) ids.set(stmt.table, Number(row.id));
      return { changes: 1, rows: [row] };
    }
    case 'UPDATE': {
      const table = ensureTable(stmt.table);
      registerColumns(stmt.table, stmt.sets.map((s) => s.col));
      const targets = table.filter((r) => (stmt.resolvedSetsPredicates || []).every((p) => evalPred(r, p)));
      let changes = 0;
      for (const row of targets) {
        for (const { col, expr } of stmt.sets) {
          let v;
          if (expr.caseRaw) {
            const cw = expr.caseWhen;
            const lhs = cw.lhsCol !== null ? String(row[cw.lhsCol] === undefined ? '' : row[cw.lhsCol]) : String(cw.lhsParam === undefined ? '' : cw.lhsParam);
            const rhs = cw.rhsParam === null ? null : String(cw.rhsParam === undefined ? '' : cw.rhsParam);
            v = (lhs === rhs) ? (Number(row[cw.thenCol]) || 0) + cw.add : row[cw.elseCol];
          }
          else if (expr.arith) v = (Number(row[expr.col]) || 0) + expr.add;
          else if (expr.raw === 'NOW()') v = isoNow();
          else if (expr.raw === 'NULL') v = null;
          else if (expr.raw === '?') v = expr.resolvedParam;
          else if (expr.resolved !== undefined) v = expr.resolved;
          else v = parseLiteral(expr.raw);
          row[col] = v;
        }
        changes++;
      }
      return { changes, rows: targets };
    }
    case 'DELETE': {
      const table = ensureTable(stmt.table);
      const before = table.length;
      const kept = table.filter((r) => !(stmt.resolvedSetsPredicates || []).every((p) => evalPred(r, p)));
      const changed = before - kept.length;
      tables.set(stmt.table, kept);
      return { changes: changed, rows: [] };
    }
    case 'SELECT':
      return executeSelect(stmt, stmt);
    default:
      throw new Error(`unsupported statement type: ${stmt.type}`);
  }
}

function parseExecute(sql, params) {
  const text = String(sql);
  const paramRefs = [];
  for (const m of text.matchAll(/\$(\d+)/g)) paramRefs.push(Number(m[1]));
  const boundValues =
    paramRefs.length > 0 && Math.max(...paramRefs) > params.length
      ? [...new Set(paramRefs)].sort((a, b) => a - b).map(() => params.shift())
      : paramRefs.map((n) => params[n - 1]);
  const statements = splitStatements(normalizeStatement(text)).filter(Boolean);
  if (statements.length === 0) return { changes: 0, rows: [] };
  let last;
  for (const raw of statements) {
    const stmt = parseStatement(raw);
    stmt.boundValues = boundValues.slice();
    last = executeStatement(stmt, params);
  }
  return last;
}

const db = {
  async get(sql, params = []) {
    const result = parseExecute(sql, params);
    return result.rows[0] ?? undefined;
  },
  async all(sql, params = []) {
    const result = parseExecute(sql, params);
    return result.rows || [];
  },
  async run(sql, params = []) {
    const result = parseExecute(sql, params);
    return { changes: result.changes || 0, affectedRows: result.changes || 0, rows: result.rows || [] };
  },
  release() {},
};

function seedExchangeRates() {
  const now = isoNow();
  seed('exchange_rates', [{
    id: 1,
    pair: 'USDCx/NGN',
    base_currency: 'USDCx',
    quote_currency: 'NGN',
    rate: 1650,
    source: 'seed',
    updated_at: now,
    created_at: now,
  }]);
}

function seedCircuitBreaker() {
  const now = isoNow();
  seed('circuit_breaker_state', [{
    id: 1,
    state: 'closed',
    updated_at: now,
    created_at: now,
    opened_at: null,
    opened_reason: null,
    opened_by: null,
  }]);
}

function seedEscrowMarker() {
  const now = isoNow();
  seed('disbursements', [{
    id: '10000000-0000-4000-8000-000000000001',
    idempotency_key: 'escrow-demo-ngn-001',
    source_reference: 'demo-ngn-001',
    source_application: 'demo-runner',
    amount_usd: 25,
    amount_usdcx: 0,
    amount_ngn_expected: 4_125_000,
    status: 'settled',
    retry_count: 0,
    max_retries: 3,
    created_at: now,
    updated_at: now,
  }]);
}

function makeLogger(name) {
  const noop = () => {};
  const logger = { child: (c) => makeLogger(c || name), info: noop, warn: noop, error: noop, debug: noop, trace: noop, fatal: noop };
  logger.name = name;
  return logger;
}

function makeAdapters(dbRef) {
  return {
    stacks: {
      healthy: true,
      getHealth: async () => ({ healthy: true, status: 'ok' }),
      async burnUsdcx({ amount }) {
        if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) throw new Error('burnUsdcx: invalid amount');
        return '0x' + 'b0'.repeat(30) + '01';
      },
      async getTransactionStatus(/* txid */) {
        return { tx_status: 'success', block_height: 1000, message: 'confirmed (DEMO)' };
      },
    },
    xreserve: {
      healthy: true,
      getHealth: async () => ({ healthy: true, status: 'ok' }),
      async requestAttestation() {
        return { attestation_id: 'att-mock-1' };
      },
      async getAttestationStatus() {
        return { status: 'confirmed' };
      },
      async observeDestinationRelease() {
        return {
          release_status: 'observed_confirmed',
          source: 'DEMO',
          evidence: { attestation_id: 'att-mock-1', destination: 'NGN', leg: 'simulated' },
          observed_at: isoNow(),
        };
      },
    },
    yellowcard: {
      healthy: true,
      getHealth: async () => ({ healthy: true, status: 'ok' }),
      async submitSend() {
        return { send_id: 'yc-mock-1', id: 'yc-mock-1', status: 'ok', reference: 'YC-REF-1', data: {} };
      },
      async lookupSend() {
        return { send_id: 'yc-mock-1', status: 'completed', reference: 'YC-REF-1', data: { reference: 'YC-REF-1', id: 'yc-mock-1' } };
      },
    },
  };
}

async function createContext() {
  const adapters = makeAdapters();
  let emitEvent = null;
  const { createRecipientRegistry } = await import('../src/services/bos/RecipientRegistry.js');
  const ctx = {
    getDb: () => db,
    adapters,
    recipientRegistry: createRecipientRegistry('permissive'),
    emitEvent: (event) => emitEvent(event),
    getLogger: (name) => makeLogger(name),
  };
  emitEvent = async (event) => {
    try {
      await db.run(
        `INSERT INTO disbursement_audit (disbursement_id, old_status, new_status, action, details, triggered_by) VALUES ($1, $2, $3, $4, $5, $6)`,
        [event.disbursement_id, event.old_status, event.new_status, event.action, event.details || {}, event.triggered_by || 'demo']
      );
    } catch (err) {
      console.error('[demo] emitEvent failed (swallowed)', err.message);
    }
  };
  return ctx;
}

async function runDemo() {
  const port = await probeLoopbackPort();
  process.env.PAYOUT_API_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.PAYOUT_NETWORK = 'testnet';
  process.env.STACKS_NETWORK = 'testnet';
  process.env.BOS_API_TOKEN = DEMO_TOKEN;
  process.env.BOS_MAX_PER_DISBURSEMENT_USD = '1000';
  process.env.BOS_DAILY_PAYOUT_CAP_USD = '10000';
  process.env.DEFAULT_USDCX_NGN_RATE = '1650';
  process.env.BOS_RECIPIENT_REGISTRY = 'permissive';
  delete process.env.BOS_ALLOW_UNAUTHENTICATED_DEV;

  seedExchangeRates();
  seedCircuitBreaker();
  seedEscrowMarker();

  const [{ init }, router, ctx] = await Promise.all([
    import('../src/services/bos/disbursementService.js'),
    import('../src/routes/disbursementsV1.js'),
    createContext(),
  ]);

  await init(ctx);

  const app = express();
  app.use(express.json());
  app.use('/api/v1/disbursements', router.default || router);

  const server = await new Promise((resolve, reject) => {
    const srv = app.listen(port, '127.0.0.1', () => resolve(srv));
    srv.on('error', reject);
  });

  try {
    const { createPayout, advancePayout, getReceipt, ApiError } = await import('../examples/simple-payout-client/client.js');

    async function getDisbursement(id) {
      const res = await fetch(`${process.env.PAYOUT_API_BASE_URL}/api/v1/disbursements/${encodeURIComponent(id)}`, {
        headers: { authorization: `Bearer ${DEMO_TOKEN}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new ApiError(res.status, body.error_code, body.error, body.details);
      }
      return body.disbursement;
    }

    const created = await createPayout(DEMO_BODY);
    const id = created.disbursement.id;
    const idempotencyKey = created.disbursement.idempotency_key;

    const advanceResults = [];
    for (let i = 0; i < 10; i++) {
      const step = await advancePayout(id, 1);
      advanceResults.push(step);
      if (!step.result || step.result.success !== true) {
        throw new Error(`advance step ${i + 1} did not succeed (${JSON.stringify(step.result || step)})`);
      }
    }

    const detail = await getDisbursement(id);
    const receipt = await getReceipt(id);

    if (!receipt || typeof receipt !== 'object' || !receipt.receipt || !receipt.receipt.final_status) {
      throw new Error('receipt envelope missing final_status');
    }
    if (receipt.receipt.receipt_version === undefined) {
      throw new Error('receipt envelope missing receipt_version');
    }

    const gaps = receipt.receipt.gaps || [];
    const finalStatus = receipt.receipt.final_status;

    if (finalStatus !== 'settled') {
      throw new Error(`final_status is '${finalStatus}', expected 'settled'`);
    }
    if (gaps.length !== 0) {
      throw new Error(`receipt has evidence gaps: ${JSON.stringify(gaps)}`);
    }

    mkdirSync(OUTPUT_DIR, { recursive: true });
    const receiptFile = join(OUTPUT_DIR, `receipt-${id}.json`);
    writeFileSync(receiptFile, JSON.stringify(receipt, null, 2) + '\n', 'utf8');

    let events = (Array.isArray(detail.audit_log) && detail.audit_log.length > 0)
      ? detail.audit_log
      : (Array.isArray(detail.audit) && detail.audit.length > 0 ? detail.audit : []);
    if (events.length === 0) {
      events = await db.all(
        `SELECT * FROM disbursement_audit WHERE disbursement_id = $1 ORDER BY id ASC`, [id]
      );
    }

    const externalRefs = db.allSync ? [] : await db.all(
      `SELECT * FROM external_refs WHERE disbursement_id = $1 ORDER BY id ASC`, [id]
    );

    let refIdx = 0;
    const refFor = (eventTime) => {
      while (refIdx < externalRefs.length && new Date(externalRefs[refIdx].created_at).getTime() < new Date(eventTime).getTime()) {
        refIdx++;
      }
      const ref = externalRefs[refIdx];
      if (!ref) return 'none (internal)';
      const idVal = ref.identifier_value || '';
      let label = `${ref.external_system} ${idVal}`;
      if (ref.identifier_type === 'payout_id') label = `yc send ${idVal}`;
      else if (ref.external_system === 'stacks' && ref.identifier_type === 'tx_id') label = `stacks tx ${String(idVal).slice(0, 12)}…`;
      else if (ref.external_system === 'xreserve') label = `xreserve ${idVal}`;
      return `${label} (simulated)`;
    };

    const banner = [
      BANNER_LINE,
      ' PAYOUT RAIL — NIGERIA (NGN) PAYOUT DEMONSTRATION',
      ' mode                 : DEMO_MODE — all external events are simulated',
      ' corridor             : NGN',
      ` amount               : 25.00 USD → 25,000,000 USDCx → ${Number(detail.amount_ngn_expected || created.disbursement.amount_ngn_expected || 0).toLocaleString('en-US')} NGN (minor units)`,
      ` disbursement id      : ${id}`,
      ` idempotency key      : ${String(idempotencyKey).slice(0, 'disbursement:'.length + 14)}…`,
      ' settle target        : settled',
      BANNER_LINE,
    ];
    for (const line of banner) console.log(line);
    console.log('');

    console.log('#   timestamp                    transition                    source   evidence ref');
    events.forEach((ev, i) => {
      const num = String(i + 1).padStart(2, '0');
      const t = String(ev.created_at || ev.srcOffsetAt || '');
      const oldS = ev.old_status ?? ev.from_state ?? null;
      const newS = ev.new_status ?? ev.to_state ?? '?';
      const trans = oldS === null || oldS === undefined ? `(created) → ${newS}` : `${oldS} → ${newS}`;
      const src = 'DEMO';
      const ref = refFor(ev.created_at || ev.captured_at || '');
      console.log(`${num}  ${(t || '').padEnd(28)} ${trans.padEnd(28)} ${src.padEnd(7)} ${ref}`);
    });

    console.log('');
    console.log(BANNER_LINE);
    console.log(' SETTLEMENT RECEIPT');
    console.log(` file        : ${receiptFile}`);
    console.log(` final_status: ${finalStatus}`);
    console.log(` gaps        : ${JSON.stringify(gaps)}`);
    console.log(' conclusions :');
    for (const key of Object.keys(receipt.receipt)) {
      if (key === 'final_status' || key === 'receipt_version' || key === 'gaps') continue;
      const value = receipt.receipt[key];
      if (typeof value === 'object' && value !== null) {
        console.log(`   ${key}: ${JSON.stringify(value)}`);
      }
    }
    console.log(' NOTE        : DEMO_MODE — all external events are simulated. This is not a live');
    console.log('               settlement; no external service was contacted for this run.');
    console.log(BANNER_LINE);
    console.log('');
    console.log('This is not a live settlement.');
    console.log(`Receipt written to ${receiptFile}`);
    return 0;
  } finally {
    server.close();
  }
}

runDemo().then((code) => {
  process.exitCode = code;
}).catch((err) => {
  console.error('[demo] unexpected error:', err && err.stack || err);
  process.exitCode = 1;
});