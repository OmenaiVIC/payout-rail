import test from 'node:test';
import assert from 'node:assert/strict';

import { createTestCtx } from '../helpers/ctx.js';
import { buildTimeline, formatTimelineText, STATE_LABELS } from '../../src/services/bos/auditTimeline.js';

test('G-14: auditTimeline module imports cleanly under ESM', () => {
  assert.equal(typeof buildTimeline, 'function');
  assert.equal(typeof formatTimelineText, 'function');
  assert.ok(STATE_LABELS['burn_confirmed']?.label.length > 0);
});

test('G-14: buildTimeline renders a chronological, labelled timeline', async () => {
  const ctx = createTestCtx();
  const now = new Date('2026-09-21T10:00:00Z');
  const audit = [
    { from_state: null, to_state: 'disbursement_initiated', reason: null, metadata: {}, created_at: new Date(now.getTime() + 0).toISOString() },
    { from_state: 'disbursement_initiated', to_state: 'preflight_check', reason: null, metadata: {}, created_at: new Date(now.getTime() + 1000).toISOString() },
  ];
  ctx.db.when(/FROM disbursement_audit/, () => audit);
  ctx.db.when(/FROM external_status_snapshots/, () => [
    { source: 'xreserve', status: 'confirmed', raw_response: {}, captured_at: new Date(now.getTime() + 1000).toISOString() },
  ]);
  ctx.db.when(/FROM disbursement_evidence/, () => []);

  const { timeline, summary } = await buildTimeline({ db: ctx.db, disbursementId: 'd-1' });

  assert.equal(timeline.length, 2);
  assert.equal(timeline[0].state, 'disbursement_initiated');
  assert.equal(timeline[1].label, STATE_LABELS.preflight_check.label);
  assert.equal(timeline[1].externalStatuses.length, 1, 'snapshot near the preflight event is attached');
  assert.equal(timeline[1].externalStatuses[0].system, 'xreserve');
  assert.equal(timeline[1].externalStatuses[0].status, 'confirmed');
  assert.equal(summary.currentState, 'preflight_check');
  assert.equal(summary.totalEvents, 2);
  assert.equal(summary.totalSnapshots, 1);
});

test('G-14: formatTimelineText joins entries into a readable string', async () => {
  const ctx = createTestCtx();
  ctx.db.when(/FROM disbursement_audit/, () => [
    { from_state: null, to_state: 'disbursement_initiated', reason: null, metadata: {}, created_at: new Date('2026-09-21T10:00:00Z').toISOString() },
  ]);
  ctx.db.when(/FROM external_status_snapshots/, () => []);
  ctx.db.when(/FROM disbursement_evidence/, () => []);

  const { timeline } = await buildTimeline({ db: ctx.db, disbursementId: 'd-1' });
  const text = formatTimelineText(timeline);

  assert.match(text, /Disbursement created/);
  assert.ok(!text.includes('undefined'));
});

test('G-14: snapshot joins only attach rows within one minute of the event', async () => {
  const ctx = createTestCtx();
  ctx.db.when(/FROM disbursement_audit/, () => [
    { from_state: null, to_state: 'disbursement_initiated', reason: null, metadata: {}, created_at: '2026-09-21T10:00:00Z' },
  ]);
  ctx.db.when(/FROM external_status_snapshots/, () => [
    { source: 'stacks', status: 'success', raw_response: {}, captured_at: '2026-09-21T12:00:00Z' }, // hours away → not attached
  ]);
  ctx.db.when(/FROM disbursement_evidence/, () => []);

  const { timeline } = await buildTimeline({ db: ctx.db, disbursementId: 'd-1' });

  assert.equal(timeline[0].externalStatuses, undefined, 'distant snapshot is not attached');
});