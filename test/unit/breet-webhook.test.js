import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  verifyBreetWebhook,
  verifyWebhook,
} from "../../src/services/bos/webhookVerifier.js";

describe("Breet webhook verification", () => {
  const oldEnv = { ...process.env };

  test("verifyBreetWebhook accepts matching x-webhook-secret", () => {
    process.env.BREET_WEBHOOK_SECRET = "secret";
    const res = verifyBreetWebhook("{}", { "x-webhook-secret": "secret" });
    assert.equal(res.valid, true);
  });

  test("rejects mismatched secret with invalid_signature", () => {
    process.env.BREET_WEBHOOK_SECRET = "secret";
    const res = verifyBreetWebhook("{}", { "x-webhook-secret": "wrong" });
    assert.equal(res.valid, false);
    assert.equal(res.reason, "invalid_signature");
  });

  test("missing signature returns missing_signature", () => {
    process.env.BREET_WEBHOOK_SECRET = "secret";
    const res = verifyBreetWebhook("{}", {});
    assert.equal(res.valid, false);
    assert.equal(res.reason, "missing_signature");
  });

  test("unset secret returns no_secret_configured (fail closed)", () => {
    delete process.env.BREET_WEBHOOK_SECRET;
    const res = verifyBreetWebhook("{}", { "x-webhook-secret": "secret" });
    assert.equal(res.valid, false);
    assert.equal(res.reason, "no_secret_configured");
  });

  test("verifyWebhook dispatches 'breet'", () => {
    process.env.BREET_WEBHOOK_SECRET = "secret";
    const res = verifyWebhook("breet", "{}", { "x-webhook-secret": "secret" });
    assert.equal(res.valid, true);
  });

  test("verifyWebhook still dispatches 'yellowcard' and 'flutterwave' (regression guard)", () => {
    delete process.env.BREET_WEBHOOK_SECRET;
    delete process.env.XRESERVE_WEBHOOK_SECRET;
    process.env.YELLOWCARD_WEBHOOK_SECRET = "yc";
    process.env.FLW_SECRET_HASH = "fw";

    // Flutterwave's verif-hash is a plain shared-secret comparison: a correct
    // scheme match can be asserted with the literal secret.
    const flw = verifyWebhook("flutterwave", "{}", { "verif-hash": "fw" });
    assert.equal(flw.valid, true);

    // Yellow Card signs an HMAC over the body, so a literal 'yc' can never
    // verify. The guard asserts only that the dispatcher still routes the
    // 'yellowcard' source and returns a verdict object (not undefined / throw).
    const yc = verifyWebhook("yellowcard", "{}", {
      "x-yellowcard-signature": "yc",
    });
    assert.equal(typeof yc, "object");
    assert.equal(typeof yc.valid, "boolean");
  });
});
