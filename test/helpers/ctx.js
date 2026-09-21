/**
 * Test ctx builder.
 *
 * Mirrors the exact `bosCtx` object assembled by ensureInit() in
 * src/index.js: { getDb, adapters, recipientRegistry, emitEvent, getLogger }.
 *
 * Production builds adapters via the factory and a shared module-level pool.
 * Here every collaborator is injected so a test can run the pipeline fully
 * in-memory.
 */

import { createFakeDb } from './fakeDb.js';
import { createMockAdapters } from './mockAdapters.js';
import { createRecipientRegistry } from '../../src/services/bos/RecipientRegistry.js';

/** A logger that discards output, so test runs stay quiet. */
export function createSilentLogger() {
  const noop = () => {};
  return {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
  };
}

export function createTestCtx({
  db = createFakeDb(),
  adapters = createMockAdapters(),
  recipientRegistry = createRecipientRegistry('permissive'),
  logger = createSilentLogger(),
  emitEvent,
} = {}) {
  const events = [];
  const ctx = {
    getDb: () => db,
    adapters,
    recipientRegistry,
    emitEvent: emitEvent || (async (event) => { events.push(event); }),
    getLogger: () => logger,
    // test affordances
    db,
    events,
  };
  return ctx;
}

export default createTestCtx;
