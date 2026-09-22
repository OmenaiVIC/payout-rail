import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RUNNER = join(REPO_ROOT, 'scripts', 'demo-payout-ngn.js');
const RUN_TIMEOUT_MS = 120_000;

function runRunner(args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [RUNNER, ...args], { cwd: REPO_ROOT });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`runner timed out after ${RUN_TIMEOUT_MS}ms\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, RUN_TIMEOUT_MS);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise({ code, stdout, stderr });
    });
  });
}

let outDir;
let run;

before(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'demo-runner-'));
  run = await runRunner([`--output-dir=${outDir}`]);
});

after(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

test('demo runner walks the whole lifecycle to settled with no evidence gaps', () => {
  assert.equal(run.code, 0, `expected exit 0, got ${run.code}\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`);
  assert.match(run.stdout, /mode\s+: DEMO_MODE/);
  assert.match(run.stdout, /final_status: settled/);
  assert.match(run.stdout, /gaps        : \[\]/);
  assert.match(run.stdout, /\(created\) → disbursement_initiated/);
  assert.match(run.stdout, /disbursement_initiated → preflight_check/);
  assert.match(run.stdout, /preflight_check → burn_submitted/);
  assert.match(run.stdout, /yellowcard_payout_confirmed → settled/);
  assert.match(run.stdout, /This is not a live settlement\./);
});

test('demo runner writes a receipt file asserting settled and no gaps', () => {
  const files = [];
  if (run) {
    const m = run.stdout.match(/Receipt written to (.+)/);
    if (m) files.push(m[1]);
  }
  assert.ok(files.length > 0, `no receipt path in stdout:\n${run && run.stdout}`);
  for (const f of files) {
    const parsed = JSON.parse(readFileSync(f, 'utf8'));
    assert.equal(parsed.receipt.final_status, 'settled');
    assert.deepEqual(parsed.receipt.gaps, []);
    assert.ok(parsed.receipt.timeline.initiated_at);
    assert.ok(parsed.receipt.timeline.settled_at);
    assert.ok(parsed.receipt.settlement_reference.external_settlement_reference, 'YC-REF-1');
  }
});

test('sandbox mode fails closed (exit 2) when no credentials are present', async () => {
  const sandbox = await runRunner(['--mode=sandbox']);
  assert.equal(sandbox.code, 2, `expected exit 2, got ${sandbox.code}\nstdout:\n${sandbox.stdout}`);
  assert.match(sandbox.stdout, / PAYOUT RAIL — SANDBOX MODE \(real sandbox services\)/);
  assert.match(sandbox.stdout, /verification cannot be reported for: stacks, xreserve, yellowcard|verification cannot be reported for:/);
  assert.match(sandbox.stdout, /nothing was run; success was not fabricated/);
});