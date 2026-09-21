export class TwoPersonApproval {
  constructor(options = {}) {
    this.amountThresholdUsd = options.amountThresholdUsd || 1000;
    this.approvalWindowMs = options.approvalWindowMs || 24 * 60 * 60 * 1000;
  }

  async isRequired(disbursement, _ctx) {
    const amountUsd = Number(disbursement.amount_usd);
    return amountUsd >= this.amountThresholdUsd;
  }

  async requestApproval(disbursement, ctx, approverAddress) {
    const db = ctx.getDb();

    const existing = await db.get(
      `SELECT id FROM two_person_approvals WHERE disbursement_id = $1 AND approver_address = $2`,
      [disbursement.id, approverAddress]
    );

    if (!existing) {
      await db.run(
        `INSERT INTO two_person_approvals (disbursement_id, approver_address, approved_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (disbursement_id, approver_address) DO NOTHING`,
        [disbursement.id, approverAddress]
      );
    }

    const approvals = await db.get(
      `SELECT COUNT(*) as cnt FROM two_person_approvals WHERE disbursement_id = $1`,
      [disbursement.id]
    );

    const approvalsReceived = Number(approvals?.cnt || 0);

    return {
      approval_id: existing?.id || null,
      approvals_needed: 2,
      approvals_received: approvalsReceived,
    };
  }

  async approve(disbursementId, approverAddress, ctx) {
    const db = ctx.getDb();

    const existing = await db.get(
      `SELECT id FROM two_person_approvals WHERE disbursement_id = $1 AND approver_address = $2`,
      [disbursementId, approverAddress]
    );

    if (!existing) {
      await db.run(
        `INSERT INTO two_person_approvals (disbursement_id, approver_address, approved_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (disbursement_id, approver_address) DO NOTHING`,
        [disbursementId, approverAddress]
      );
    }

    const approvals = await db.get(
      `SELECT COUNT(*) as cnt FROM two_person_approvals WHERE disbursement_id = $1`,
      [disbursementId]
    );

    const approvalsReceived = Number(approvals?.cnt || 0);

    return {
      approved: approvalsReceived >= 2,
      approvals_received: approvalsReceived,
      approvals_needed: 2,
    };
  }

  async check(disbursement, ctx) {
    const required = await this.isRequired(disbursement, ctx);
    if (!required) {
      return { ok: true, details: { two_person_required: false, amount_usd: disbursement.amount_usd } };
    }

    const db = ctx.getDb();

    const earliestApproval = await db.get(
      `SELECT MIN(approved_at) as earliest FROM two_person_approvals WHERE disbursement_id = $1`,
      [disbursement.id]
    );

    if (earliestApproval?.earliest) {
      const elapsed = Date.now() - new Date(earliestApproval.earliest).getTime();
      if (elapsed > this.approvalWindowMs) {
        return {
          ok: false,
          error_code: 'u8251',
          reason: `Two-person approval window expired (${Math.round(elapsed / 1000)}s ago)`,
          details: { two_person_required: true, window_expired: true },
        };
      }
    }

    const approvals = await db.get(
      `SELECT COUNT(*) as cnt FROM two_person_approvals WHERE disbursement_id = $1`,
      [disbursement.id]
    );

    const approvalsReceived = Number(approvals?.cnt || 0);

    if (approvalsReceived < 2) {
      return {
        ok: false,
        error_code: 'u8251',
        reason: `Two-person approval pending: ${approvalsReceived}/2 approvals received`,
        details: { two_person_required: true, approvals_received: approvalsReceived, approvals_needed: 2 },
      };
    }

    return {
      ok: true,
      details: { two_person_required: true, approvals_received: approvalsReceived, approvals_needed: 2 },
    };
  }
}
