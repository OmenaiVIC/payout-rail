/**
 * FakeDb — an in-memory test double for the production PgClient
 * (src/database.js).
 *
 * It deliberately does NOT execute SQL. SQL is opaque to this double: it
 * records every (method, sql, params) call and answers from handlers that a
 * test registers. That keeps assertions honest — a test can assert that an
 * INSERT carried the right columns and values (the G-02 failure mode) without
 * pretending to be PostgreSQL. Behaviour that truly depends on the database is
 * covered by the Postgres-gated integration suite (test/integration/).
 *
 * Surface parity with PgClient:
 *   get(sql, params) -> row | null
 *   all(sql, params) -> rows[]
 *   run(sql, params) -> { lastInsertRowid, changes, rows }
 *   release()        -> void
 */

export class FakeDb {
  constructor({ fallback = null } = {}) {
    this.calls = [];
    this._handlers = [];
    this._tables = new Map();
    this._fallback = fallback;
  }

  /**
   * Seed an in-memory table. Returned rows are shallow copies so a handler can
   * mutate them without touching the seed literal.
   */
  seed(table, rows = []) {
    this._tables.set(table, rows.map((r) => ({ ...r })));
    return this;
  }

  /** Get (or lazily create) an in-memory table's backing array. */
  table(name) {
    if (!this._tables.has(name)) this._tables.set(name, []);
    return this._tables.get(name);
  }

  /**
   * Register a handler for any SQL matching `pattern` (a non-global RegExp).
   * Handlers run in registration order; the first match wins.
   *
   * handler receives { sql, params, db, method, call } and returns either a
   * row (for get), an array of rows (for all), or a run() result.
   */
  when(pattern, handler) {
    if (pattern.global) {
      throw new Error('FakeDb.when() requires a non-global RegExp (lastIndex is stateful)');
    }
    this._handlers.push({ pattern, handler });
    return this;
  }

  _dispatch(method, sql, params) {
    const call = { method, sql, params: params || [] };
    this.calls.push(call);
    for (const { pattern, handler } of this._handlers) {
      if (pattern.test(sql)) {
        return handler({ sql, params: call.params, db: this, method, call });
      }
    }
    return this._fallback;
  }

  async get(sql, params = []) {
    const out = await this._dispatch('get', sql, params);
    if (Array.isArray(out)) return out[0] || null;
    return out == null ? null : out;
  }

  async all(sql, params = []) {
    const out = await this._dispatch('all', sql, params);
    if (Array.isArray(out)) return out;
    return out == null ? [] : [out];
  }

  async run(sql, params = []) {
    const out = await this._dispatch('run', sql, params);
    if (out && typeof out === 'object' && 'changes' in out) return out;
    const rows = Array.isArray(out) ? out : (out == null ? [] : [out]);
    return {
      lastInsertRowid: rows[0]?.id ?? null,
      changes: rows.length,
      rows,
    };
  }

  release() {}

  // ── Assertion helpers ────────────────────────────────────────────────────

  /** First recorded call whose SQL matches `pattern`, or null. */
  findCall(pattern) {
    return this.calls.find((c) => pattern.test(c.sql)) || null;
  }

  /** All recorded calls whose SQL matches `pattern`. */
  callsMatching(pattern) {
    return this.calls.filter((c) => pattern.test(c.sql));
  }

  /** How many recorded calls matched `pattern`. */
  countMatching(pattern) {
    return this.callsMatching(pattern).length;
  }
}

export function createFakeDb(opts) {
  return new FakeDb(opts);
}

export default FakeDb;
