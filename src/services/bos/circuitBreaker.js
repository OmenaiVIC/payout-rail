export class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 5;
    this.cooldownMs = options.cooldownMs || 30 * 60 * 1000;
    this.halfOpenMax = options.halfOpenMax || 3;
  }

  async getState(ctx) {
    const db = ctx.getDb();
    const row = await db.get(`SELECT * FROM circuit_breaker_state ORDER BY id ASC LIMIT 1`);
    if (!row) {
      await db.run(`INSERT INTO circuit_breaker_state (state) VALUES ('closed')`);
      return { state: 'closed', failure_count: 0, last_failure_at: null, last_success_at: null, tripped_at: null };
    }
    return {
      state: row.state,
      failure_count: row.failure_count,
      last_failure_at: row.last_failure_at,
      last_success_at: row.last_success_at,
      tripped_at: row.tripped_at,
      trip_reason: row.trip_reason,
    };
  }

  async recordFailure(ctx, reason) {
    const db = ctx.getDb();
    const current = await this.getState(ctx);

    const newCount = current.failure_count + 1;
    const shouldTrip = current.state === 'closed' && newCount >= this.failureThreshold;

    if (shouldTrip) {
      await db.run(
        `UPDATE circuit_breaker_state
         SET state = 'open', failure_count = $1, last_failure_at = NOW(), tripped_at = NOW(), trip_reason = $2, updated_at = NOW()
         WHERE id = (SELECT id FROM circuit_breaker_state ORDER BY id ASC LIMIT 1)`,
        [newCount, reason || 'failure_threshold_exceeded']
      );
      ctx.getLogger('circuitBreaker')?.warn({ failure_count: newCount, reason }, 'Circuit breaker TRIPPED (open)');
    } else {
      await db.run(
        `UPDATE circuit_breaker_state
         SET failure_count = $1, last_failure_at = NOW(), updated_at = NOW()
         WHERE id = (SELECT id FROM circuit_breaker_state ORDER BY id ASC LIMIT 1)`,
        [newCount]
      );
    }

    return { state: shouldTrip ? 'open' : current.state, failure_count: newCount };
  }

  async recordSuccess(ctx) {
    const db = ctx.getDb();
    const current = await this.getState(ctx);

    if (current.state === 'half_open') {
      await db.run(
        `UPDATE circuit_breaker_state
         SET state = 'closed', failure_count = 0, last_success_at = NOW(), tripped_at = NULL, trip_reason = NULL, updated_at = NOW()
         WHERE id = (SELECT id FROM circuit_breaker_state ORDER BY id ASC LIMIT 1)`
      );
      ctx.getLogger('circuitBreaker')?.info('Circuit breaker CLOSED (success in half_open)');
      return { state: 'closed', failure_count: 0 };
    }

    if (current.state === 'open') {
      return { state: 'open', failure_count: current.failure_count };
    }

    await db.run(
      `UPDATE circuit_breaker_state
       SET failure_count = 0, last_success_at = NOW(), updated_at = NOW()
       WHERE id = (SELECT id FROM circuit_breaker_state ORDER BY id ASC LIMIT 1)`
    );

    return { state: 'closed', failure_count: 0 };
  }

  async trip(ctx, reason) {
    const db = ctx.getDb();
    await db.run(
      `UPDATE circuit_breaker_state
       SET state = 'open', tripped_at = NOW(), trip_reason = $1, updated_at = NOW()
       WHERE id = (SELECT id FROM circuit_breaker_state ORDER BY id ASC LIMIT 1)`,
      [reason || 'manual_trip']
    );
    ctx.getLogger('circuitBreaker')?.warn({ reason }, 'Circuit breaker manually TRIPPED');
    return { state: 'open' };
  }

  async reset(ctx) {
    const db = ctx.getDb();
    await db.run(
      `UPDATE circuit_breaker_state
       SET state = 'closed', failure_count = 0, tripped_at = NULL, trip_reason = NULL, updated_at = NOW()
       WHERE id = (SELECT id FROM circuit_breaker_state ORDER BY id ASC LIMIT 1)`
    );
    ctx.getLogger('circuitBreaker')?.info('Circuit breaker manually RESET');
    return { state: 'closed', failure_count: 0 };
  }

  async check(_disbursement, ctx) {
    const current = await this.getState(ctx);

    if (current.state === 'closed') {
      return { ok: true, details: { circuit_state: 'closed', failure_count: current.failure_count } };
    }

    if (current.state === 'open') {
      if (current.tripped_at) {
        const elapsed = Date.now() - new Date(current.tripped_at).getTime();
        if (elapsed >= this.cooldownMs) {
          const db = ctx.getDb();
          await db.run(
            `UPDATE circuit_breaker_state
             SET state = 'half_open', updated_at = NOW()
             WHERE id = (SELECT id FROM circuit_breaker_state ORDER BY id ASC LIMIT 1)`
          );
          ctx.getLogger('circuitBreaker')?.info('Circuit breaker → HALF_OPEN (cooldown elapsed)');
          return { ok: true, details: { circuit_state: 'half_open', cooldown_elapsed_ms: elapsed } };
        }
      }

      return {
        ok: false,
        error_code: 'u8250',
        reason: `Circuit breaker OPEN — cooldown ${Math.round((this.cooldownMs - (current.tripped_at ? Date.now() - new Date(current.tripped_at).getTime() : 0)) / 1000)}s remaining`,
        details: { circuit_state: 'open', tripped_at: current.tripped_at },
      };
    }

    if (current.state === 'half_open') {
      const db = ctx.getDb();
      const probes = await db.get(
        `SELECT COUNT(*) as cnt FROM payout_gates WHERE gate_name = 'circuit_breaker_half_open_probe' AND created_at > $1`,
        [current.tripped_at]
      );

      if ((probes?.cnt || 0) >= this.halfOpenMax) {
        return {
          ok: false,
          error_code: 'u8250',
          reason: `Circuit breaker HALF_OPEN — probe limit ${this.halfOpenMax} reached`,
          details: { circuit_state: 'half_open', probes: probes?.cnt || 0 },
        };
      }

      await db.run(
        `INSERT INTO payout_gates (disbursement_id, gate_name, passed, details, created_at)
         VALUES ($1, 'circuit_breaker_half_open_probe', true, '{}', NOW())`,
        [_disbursement.id]
      );

      return { ok: true, details: { circuit_state: 'half_open', probe: (probes?.cnt || 0) + 1 } };
    }

    return { ok: true, details: { circuit_state: current.state } };
  }
}
