import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bosMonitoringRouter from './routes/bosMonitoring.js';
import webhooksRouter from './routes/webhooks.js';
import disbursementsRouter from './routes/disbursements.js';
import { initDb, getDb } from './database.js';
import { getXReserveAdapter, getStacksAdapter, getYellowCardAdapter } from './services/bos/bridgeAdapterFactory.js';
import monitorJob from './services/bos/monitoring/monitorJob.js';
import * as stuckReaper from './services/bos/stuckStateReaper.js';
import * as reconciliationWorker from './services/bos/reconciliationWorker.js';
import * as disbursementService from './services/bos/disbursementService.js';
import * as pipelineWorker from './services/bos/pipelineWorker.js';
import { createRecipientRegistry } from './services/bos/RecipientRegistry.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : '*', credentials: true }));
// Capture the raw body BEFORE parsing so webhook HMACs verify over the exact bytes sent.
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.get('/warmup', (req, res) => {
  res.json({ status: 'ok', message: 'Backend warm' });
});

let _initialized = false;
async function ensureInit() {
  if (_initialized) return;
  _initialized = true;

  await initDb();

  const adapters = {
    stacks: getStacksAdapter(),
    xreserve: getXReserveAdapter(),
    yellowcard: getYellowCardAdapter(),
  };

  const recipientRegistry = createRecipientRegistry(process.env.BOS_RECIPIENT_REGISTRY);

  const bosCtx = {
    getDb: () => getDb(),
    adapters,
    recipientRegistry,
    emitEvent: async (event) => {
      let db;
      try {
        db = await getDb();
        await db.run(
          `INSERT INTO disbursement_audit (disbursement_id, old_status, new_status, action, details, triggered_by, from_state, to_state)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [event.disbursement_id, event.old_status, event.new_status, event.action,
           JSON.stringify(event.details || {}), event.triggered_by, event.old_status, event.new_status]
        );
      } catch (err) {
        console.error('[bos] Failed to emit audit event:', err.message);
      } finally {
        if (db) db.release();
      }
    },
    getLogger: (component) => ({
      info:  (obj, msg) => console.log(`[${component}]`, msg || '', obj || ''),
      warn:  (obj, msg) => console.warn(`[${component}]`, msg || '', obj || ''),
      error: (obj, msg) => console.error(`[${component}]`, msg || '', obj || ''),
      debug: (obj, msg) => {},
    }),
  };

  await disbursementService.init(bosCtx);
  stuckReaper.init(bosCtx);
  reconciliationWorker.init(bosCtx);
  pipelineWorker.init(bosCtx);

  // Start workers
  monitorJob.start();
  stuckReaper.start();          // 60s interval — flags stuck disbursements
  reconciliationWorker.start(); // 5min interval — reconciles unrecorded burns/payouts
  pipelineWorker.start();       // 30s interval — scans and advances all actionable disbursements
  console.log('✅ Pipeline worker started');
}

// Vercel: wait for init BEFORE any routes to avoid cold-start race conditions
const initPromise = ensureInit().catch(err => {
  console.error('[init] Failed:', err.message);
});
if (process.env.VERCEL) {
  app.use((_req, _res, next) => {
    initPromise.then(() => next()).catch(next);
  });
}

app.use('/api/bos/monitoring', bosMonitoringRouter);
app.use('/api/bos/webhooks', webhooksRouter);
app.use('/api/disbursements', disbursementsRouter);

app.use((err, req, res, next) => {
  const msg = (err && err.message) ? err.message : String(err);
  const stack = (err && err.stack) ? err.stack.split('\n').slice(0, 5).join(' | ') : '(no stack)';
  console.error('[express] Unhandled error:', msg);
  console.error('[express] Stack:', stack);
  res.status(500).json({ error: msg });
});

// Graceful shutdown
function shutdown() {
  console.log('[shutdown] Stopping BOS workers...');
  monitorJob.stop();
  stuckReaper.stop();
  reconciliationWorker.stop();
  pipelineWorker.stop();
  if (process.env.VERCEL) return;
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Local dev: init + listen
if (!process.env.VERCEL) {
  ensureInit().then(() => {
    app.listen(PORT, () => {
      console.log(`BOS backend running on http://localhost:${PORT}`);
    });
  });
}

export default app;