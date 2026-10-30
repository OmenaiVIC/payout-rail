/**
 * Test ctx builder.
 *
 * Mirrors the exact `bosCtx` object assembled by ensureInit() in
 * src/index.js: { getDb, adapters, payoutProvider, getPayoutAdapter,
 * recipientRegistry, emitEvent, getLogger }.
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
  payoutProvider = 'yellowcard',
  recipientRegistry = createRecipientRegistry('permissive'),
  logger = createSilentLogger(),
  emitEvent,
} = {}) {
  const events = [];
  const ctx = {
    getDb: () => db,
    adapters,
    payoutProvider,
    // No silent fallback: a test that names a provider must inject its adapter,
    // or the seam is not actually being exercised.
    getPayoutAdapter: () => {
      const adapter = adapters[payoutProvider];
      if (!adapter) throw new Error(`createTestCtx: no adapter "${payoutProvider}" in injected adapters`);
      return adapter;
    },
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
